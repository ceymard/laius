import { init_timer } from './helpers'

export const __global_timer = init_timer()
import c from 'colors'
import sh from 'shelljs'

import util from 'util'
import * as path from 'path'

import fs from 'fs'

import { PageSource, Page, } from './page'
import { FilePath } from './path'
import { I } from './optimports'

const cache_bust = '?'+ (+new Date).toString(16).slice(0, 6)

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


export class Generation {
  site!: Site
  lang!: string
  base_url!: string
  out_dir!: string
  generation_name!: string
  assets_out_dir!: string
  assets_url!: string

  constructor (values: {
    site: Site
    lang: string
    base_url: string
    out_dir: string
    generation_name: string
    assets_out_dir: string
    assets_url: string
  }) { Object.assign(this, values) }

  copy_file(asker: FilePath, src: FilePath | string, dest: string, on_copy?: (output: string) => any) {
    let output = path.join(this.assets_out_dir, dest)
    let output_url = path.join(this.assets_url, dest) + cache_bust
    let fsrc = typeof src === 'string'? FilePath.fromFile(this.site, src) : src

    if (!fsrc) {
      console.log(c.red('!'), src, 'does not exist')
      return output_url
    }

    this.site.addDep(asker.absolute_path, fsrc.absolute_path)

    if (fs.existsSync(output)) {
      let st = fs.statSync(output)
      if (fsrc.stats.mtimeMs <= st.mtimeMs) {
        // no need to copy
        return output_url
      }
    }
    sh.mkdir('-p', path.dirname(output))
    sh.cp(fsrc.absolute_path, output)
    console.log(` ${c.bold(c.blue('>'))} ${c.grey(dest)} - ${output}`)
    if (on_copy) {
      this.site.jobs.set(output, () => on_copy(output))
    }

    return output_url
  }

  process_file(asker: FilePath, src: FilePath, dest: string, job: (outpath: string) => any) {
    let output = path.join(this.assets_out_dir, dest)
    let output_url = path.join(this.assets_url, dest) + cache_bust

    this.site.addDep(asker.absolute_path, src.absolute_path)

    if (fs.existsSync(output)) {
      let st = fs.statSync(output)
      if (src.stats.mtimeMs <= st.mtimeMs) {
        // no need to copy
        return output_url
      }
    }

    sh.mkdir('-p', path.dirname(output))
    let j = this.site.jobs
    j.set(output, async () => {
      await job(output)
      console.log(c.blue.bold(' >'), c.grey(dest))
    })
    return output_url
  }


}

/**
 * Site holds a list of files of interest (that are about to be generated) as well as a reference
 * to all the __init__.tpl files that it encounters -- although it does not process them until
 * they're actually needed
 */
export class Site {

  default_language = 'en'
  extensions = new Set(['.md', '.html'])
  main_path: string = ''
  include_drafts = false

  path: string[] = []
  generations = new Map<string, Generation>()

  urls = new Set<string>()

  ;[util.inspect.custom]() {
    return `<Site:${this.main_path}>`
  }

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

  // file that depends on the following paths
  depends_on = new Map<string, Set<string>>()
  // file that is depended upon
  depended_upon = new Map<string, Set<string>>()

  /**
   * Jobs contains a list of files to be generated / handled, along with the callback that contains the function that will do the processing.
   * Adding a job with the same name is an error.
   *
   * This is a queue of sorts. If working in serve mode, the server waits for the job queue to be clear *before* queuing new jobs.
   */
  jobs = new Map<string, () => any>()
  next_jobs = new Map<string, () => any>()
  errors = []

  constructor() { }

  is_watching = false

  addDep(file: string, upon: string) {
    if (!this.is_watching) return

    // console.log(`${file} depends on ${upon}`)
    if (!this.depended_upon.has(upon)) {
      this.depended_upon.set(upon, new Set())
    }
    this.depended_upon.get(upon)!.add(file)

    if (!this.depends_on.has(file)) {
      this.depends_on.set(file, new Set())
    }
    this.depends_on.get(file)!.add(upon)
  }

  removeDep(file: string) {
    let upon = this.depended_upon.get(file)
    if (!upon) return
    this.depended_upon.delete(file)
    for (let u of upon) {
      this.depends_on.get(u)?.delete(file)
    }
  }

  get_page_source(asker: FilePath | null, p: FilePath): PageSource {
    let abs = p.absolute_path
    if (asker) {
      this.addDep(asker.absolute_path, p.absolute_path)
    }

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
    const ps = this.get_page_source(null, p)
    if (!ps) throw new Error(`unexpected error`)
    this.cache.set(p.absolute_path, ps)

    if (ps.has_errors) return

    let page = ps.get_page(gen)
    if (!page.skip)
      page.$$generate()

    // now we know the slug and the path, compute the destination directory
    // const url = pth + '/' + _slug + '.html'

    // var final_path = fname
  }

  last_assets_dir?: string
  last_assets_url?: string
  addGeneration(name: string, opts: { lang: string, out_dir: string, base_url: string, assets_url?: string, assets_dir?: string }) {
    this.last_assets_url = opts.assets_url ?? this.last_assets_url
    this.last_assets_dir = opts.assets_dir ?? this.last_assets_dir ?? opts.out_dir
    this.generations.set(name, new Generation({
      site: this,
      lang: opts.lang,
      generation_name: name,
      out_dir: opts.out_dir,
      base_url: opts.base_url,
      assets_url: opts.assets_url ?? this.last_assets_url ?? opts.base_url,
      assets_out_dir: opts.assets_dir ?? this.last_assets_dir ?? opts.out_dir,
    }))
    // console.log(name, this.generations.get(name), opts)
  }

  listFiles(root: string, subpath: string = '/'): FilePath[] {
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
          files.push(new FilePath(this, root, local_name, st))
        }
      }
    }

    if (!fs.statSync(root).isDirectory()) {
      throw new Error(`${root} is not a directory`)
    }

    handle_dir(subpath)
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
    console.log(` .. starting process ${__global_timer()}`)
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
    console.log(` .. total ${__global_timer()}`)
    // console.log(this.urls)
  }

  /**
   * Setup watching
   */
  watch() {
    I.watch(this.path, {
      persistent: true,
      awaitWriteFinish: true,
      atomic: 250,
      alwaysStat: true,
    }).on('all', (evt, path, stat) => {

      // When receiving an event, we check all the "jobs" that depend on the path in question.
    })
  }

}
