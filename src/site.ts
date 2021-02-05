import * as path from 'path'
import { performance } from 'perf_hooks'

import fs from 'fs'
import c from 'colors/safe'
import sh from 'shelljs'
import { watch } from 'chokidar'

import { PageSource, Page, sym_repeats } from './page'
import { FilePath } from './path'

function init_timer() {
  const now = performance.now()
  return function (): string {
    return c.bold(c.green('' + (Math.round(100 * (performance.now() - now)) / 100))) + 'ms'
  }
}

/**

When a page is added to the generation
  - track whatever it opens / uses so that it is regenerated if they change

Pages and assets have two modes :
  - Relatively linked (for local directory output)
  - Toplevel linked

Also, assets can be
  - shared amongst all
  - copied in every directory

Which means that assets should *always* have a method that computes their
real destination.

*/


export interface Generation {
  lang: string
  base_url: string
  out_dir: string
  generation_name: string
  assets_out_dir: string
  assets_url: string
}

/**
 * Site holds a list of files of interest (that are about to be generated) as well as a reference
 * to all the __dir__.tpl files that it encounters -- although it does not process them until
 * they're actually needed
 */
export class Site {

  default_language = 'en'
  extensions = new Set(['.md', '.html'])
  main_path: string = ''
  include_drafts = false

  path: string[] = []
  generations = new Map<string, Generation>()

  /**
   * Cache the page sources.
   * There should be some
   */
  cache = new Map<string, PageSource>()

  // is that useful ?
  generated_cache = new Map<string, Page>()

  /**
   * Every time a page requires an asset through get_* and that get_ is successful, the begotten element is added as a dependency.
   *
   * Dependencies are serialized once the site powers down to check if something has to be re-rendered.
   */
  dependencies = new Map<string, string[]>()

  /**
   * Jobs contains a list of files to be generated / handled, along with the callback that contains the function that will do the processing.
   * Adding a job with the same name is an error.
   *
   * This is a queue of sorts. If working in serve mode, the server waits for the job queue to be clear *before* queuing new jobs.
   */
  jobs = new Map<string, () => any>()
  next_jobs = new Map<string, () => any>()

  constructor() { }

  get_page_source(p: FilePath): PageSource {
    let abs = p.absolute_path
    let prev = this.cache.get(abs)
    if (prev && prev.path.stats.mtimeMs >= p.stats.mtimeMs) {
      return prev
    }
    let src = new PageSource(this, p)
    this.cache.set(abs, src)
    return src
  }

  /**
   * Gets the page instance from a page source
   */
  process_page(gen: Generation, p: FilePath) {

    // The output path is the directory path. The page may modify it if it chooses so
    // Compute a slug. This will be given to the page instance so that it may change it.
    // const _slug = slug(path.basename(fname).replace(/\..*$/, ''))
    const ps = this.get_page_source(p)
    if (!ps) throw new Error(`unexpected error`)
    this.cache.set(p.absolute_path, ps)

    // now we know the slug and the path, compute the destination directory
    // const url = pth + '/' + _slug + '.html'

    // var final_path = fname
    try {
      const t = init_timer()
      const page = ps.get_page(gen)
      const repeat = page.$repeat ?? [null]
      const repeat_fn = page.$repeat ? page[sym_repeats] : null

      for (let [key, iter] of repeat.entries()) {
        page.iter = iter
        page.$slug = page.$base_slug
        if (page.$repeat) page.$slug += `-${typeof key === 'number' ? key + 1 : key}`
        if (repeat_fn) {
          for (let rp of repeat_fn) {
            rp()
          }
        }

        // Start by getting the page source
        // Now we have a page instance, we can in fact process it to generate its content
        // to the destination.
        // console.log(page.$$path_target, page.$$path_target.local_dir)
        let final_path = path.join(page.$out_dir, page.$slug + '.html')
        // console.log(final_path, page.$out_dir, page.$$path_target.local_dir)
        const final_real_path = path.join(gen.out_dir, final_path)


        // Create the directory recursively where the final result will be
        // console.log(final_real_path)
        // console.log(final_real_path)
        const final_real_dir = path.dirname(final_real_path)
        sh.mkdir('-p', final_real_dir)

        // console.log(page[sym_blocks])
        // console.log(page[sym_blocks]['βrender'].toString())
        const cts = page.get_block('βrender')
        fs.writeFileSync(final_real_path, cts, { encoding: 'utf-8' })
        console.log(` ${c.green(c.bold('*'))} ${c.magenta(gen.generation_name)} ${page.$$path_this.filename} ${t()}`)
      }
    } catch (e) {
      console.error(` ${c.red('/!\\')} ${c.magenta(gen.generation_name)} ${p.filename} ${c.gray(e.message)}`)
      console.error(c.gray(e.stack))
    }

  }

  last_assets_dir?: string
  last_assets_url?: string
  addGeneration(name: string, opts: { lang: string, out_dir: string, base_url: string, assets_url?: string, assets_dir?: string }) {
    this.last_assets_url = opts.assets_url ?? this.last_assets_url
    this.last_assets_dir = opts.assets_dir ?? this.last_assets_dir ?? opts.out_dir
    this.generations.set(name, {
      lang: opts.lang,
      generation_name: name,
      out_dir: opts.out_dir,
      base_url: opts.base_url,
      assets_url: opts.assets_url ?? this.last_assets_url ?? opts.base_url,
      assets_out_dir: opts.assets_dir ?? this.last_assets_dir ?? opts.out_dir,
    })
    // console.log(name, this.generations.get(name), opts)
  }

  listFiles(root: string): FilePath[] {
    const files: FilePath[] = []
    // Process the folder recursively
    const handle_dir = (local_dir: string) => {
      const cts = fs.readdirSync(path.join(root, local_dir))
      for (let file of cts) {
        const local_name = path.join(local_dir, file)
        const full_path = path.join(root, local_name)
        const st = fs.statSync(full_path)
        if (st.isDirectory()) {
          handle_dir(local_name)
        } else {
          files.push(new FilePath(root, local_name, st))
        }
      }
    }

    if (!fs.statSync(root).isDirectory()) {
      throw new Error(`${root} is not a directory`)
    }
    handle_dir('/')
    return files
  }

  /**
   * Add a folder to the lookup path of the site. get_pages, get_static & al
   * all use the lookup path when doing static lookups (but not when doing
   * relative lookups)
   *
   * Only the first given folder is traversed recursively to make sure
   */
  process_folder(root: string) {
    if (!this.main_path) this.main_path = root
    const files = this.listFiles(root)

    let re = /\/(?!_)[^\/]+\.(md|html)$/

    for (let [name, g] of this.generations) {
      for (let f of files.filter(f => re.test(f.filename))) {
        this.jobs.set(f.filename + `-${name}`, () => this.process_page(g, f))
      }
    }

  }

  /**
   *
   */
  async process() {
    const t = init_timer()
    this.process_folder(this.path[0])
    do {
      // console.log(this.jobs)
      const jobs = this.jobs
      this.jobs = new Map()

      for (let [_, fn] of jobs) {
        // console.log(name)
        await fn()
      }
    } while (this.jobs.size)
    console.log(` .. total ${t()}`)
  }

  /**
   * Setup watching
   */
  watch() {
    watch(this.path, {
      persistent: true,
      awaitWriteFinish: true,
      atomic: 250,
      alwaysStat: true,
    }).on('all', (evt, path, stat) => {
      // When receiving an event, we check all the "jobs" that depend on the path in question.
    })
  }

}
