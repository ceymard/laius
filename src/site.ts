import * as path from 'path'
import { performance } from 'perf_hooks'

import fs from 'fs'
import c from 'colors/safe'
import sh from 'shelljs'
import slug from 'limax'
import match from 'micromatch'
import { watch } from 'chokidar'

import { PageSource, Page, sym_blocks, sym_repeats } from './page'

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
  assets_out_dir?: string
  assets_url?: string
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
  generations: Generation[] = []

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

  stat_file(root: string, fname: string) {
    let path_tries: {root: string, path: string}[] = [{root, path: fname}]
    if (fname[0] === '/') {
      path_tries = this.path.map(p => { return {root: p, path: fname} })
      // Absolute require. Several paths will be tried.
    }
    for (let p of path_tries) {
      let full_path = path.join(p.root, p.path)
      if (!fs.existsSync(full_path)) continue
      let st = fs.statSync(full_path)
      if (st.isDirectory()) continue
      return {full_path, stats: st, root: p.root, path: p.path}
    }
    return null
  }

  /**
   *
   */
  get_page_source(root: string, fname: string): PageSource | null {
    const fstat = this.stat_file(root, fname)
    if (fstat == null) return null
    let mtime = fstat.stats.mtimeMs
    let prev = this.cache.get(fstat.full_path)
    if (prev && prev.mtime >= mtime) {
      return prev
    }
    let src = new PageSource(this, fstat.root, fname, mtime)
    this.cache.set(fstat.full_path, src)
    return src
  }

  /**
   * Gets the page instance from a page source
   */
  process_page(fname: string, mtime: number) {

    // The output path is the directory path. The page may modify it if it chooses so
    const pth = path.dirname(fname)
    // Compute a slug. This will be given to the page instance so that it may change it.
    const _slug = slug(path.basename(fname).replace(/\..*$/, ''))
    const ps = new PageSource(this, this.path[0], fname, mtime)

    // now we know the slug and the path, compute the destination directory
    const url = pth + '/' + _slug + '.html'

    for (let g of this.generations) {
      var final_path = fname
      try {
        const t = init_timer()
        const page = ps.getPage(g)
        const repeat = page.$repeat ?? [null]
        const repeat_fn = page.$repeat ? page[sym_repeats] : null

        for (let [key, iter] of repeat.entries()) {
          page.iter = iter
          page.$slug = page.$base_slug + `-${typeof key === 'number' ? key + 1 : key}`
          if (repeat_fn) {
            for (let rp of repeat_fn) {
              rp()
            }
          }

          // Start by getting the page source
          // Now we have a page instance, we can in fact process it to generate its content
          // to the destination.
          // console.log(page.$path, page.$slug, g.dir_out)
          final_path = path.join(page.$path, page.$slug + '.html')
          const final_real_path = path.join(g.out_dir, final_path)


          // Create the directory recursively where the final result will be
          // console.log(final_real_path)
          const final_real_dir = path.dirname(final_real_path)
          sh.mkdir('-p', final_real_dir)

          // console.log(page[sym_blocks])
          const cts = page.get_block('βrender')
          fs.writeFileSync(final_real_path, cts, { encoding: 'utf-8' })
          console.log(` ${c.green(c.bold('*'))} ${url} ${t()}`)
        }
      } catch (e) {
        console.error(` ${c.red('/!\\')} ${final_path} ${c.gray(e.message)}`)
        console.error(c.gray(e.stack))
      }
    }


  }

  listFiles(root: string) {
    const files: string[] = []
    const stats = new Map<string, fs.Stats>()
    // Process the folder recursively
    const handle_dir = (dir_path: string, local_path: string) => {
      const cts = fs.readdirSync(dir_path)
      for (let file of cts) {
        const full_path = path.join(dir_path, file)
        const local = path.join(local_path, file)
        const st = fs.statSync(full_path)
        if (st.isDirectory()) {
          handle_dir(full_path, local)
        } else {
          stats.set(local , st)
          files.push(local)
        }
      }
    }

    if (!fs.statSync(root).isDirectory()) {
      throw new Error(`${root} is not a directory`)
    }
    handle_dir(root, '')
    return {files,stats}
  }

  /**
   * Add a folder to the lookup path of the site. get_pages, get_static & al
   * all use the lookup path when doing static lookups (but not when doing
   * relative lookups)
   *
   * Only the first given folder is traversed recursively to make sure
   */
  processFolder(root: string) {
    if (!this.main_path) this.main_path = root
    const {files, stats} = this.listFiles(root)

    const mt = this.include_drafts ? '**/!(_)*.(md|html)' : '**/!(_)*!(.draft).(md|html)'

    for (let f of match(files, mt)) {
      this.jobs.set(f, () => this.process_page(f, stats.get(f)!.mtimeMs))
    }

  }

  /**
   *
   */
  async process() {
    const t = init_timer()
    this.processFolder(this.path[0])
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
