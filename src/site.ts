import * as path from 'path'
import { performance } from 'perf_hooks'

import fs from 'fs'
import c from 'colors/safe'
import sh from 'shelljs'
import match from 'micromatch'
import { watch } from 'chokidar'

import { PageSource, PageInstance } from './page'

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

/**
 * Site holds a list of files of interest (that are about to be generated) as well as a reference
 * to all the __dir__.tpl files that it encounters -- although it does not process them until
 * they're actually needed
 */
export class Site {

  default_language = 'en'
  extensions = new Set(['.md', '.html'])
  main_path: string = ''
  paths: string[] = []

  /**
   * Cache the page sources.
   * There should be some
   */
  cache = new Map<string, PageSource>()

  // is that useful ?
  generated_cache = new Map<string, PageInstance>()

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

  /**
   * Get another page
   */
  get_page(requester: PageSource, fname: string): PageInstance {

  }

  /**
   * Returns true if the file should be added to the list of page sources
   */
  shouldProcess(fname: string): boolean {
    if (!this.extensions.has(path.extname(fname))
      || fname[0] === '_'
      || fname.match(/\b\.draft\b/) // <-- should change if I'm in draft mode
    )
      return false
    return true
  }

  /**
   * Add a folder to the lookup path of the site. get_pages, get_static & al
   * all use the lookup path when doing static lookups (but not when doing
   * relative lookups)
   *
   * Only the first given folder is traversed recursively to make sure
   */
  processFolder(root: string, outdir: string) {
    if (!this.main_path) this.main_path = root

    // When a file is found, it is added to a list

    // Process the folder recursively
    const handle_dir = (dir_path: string) => {
      const cts = fs.readdirSync(dir_path)
      for (let file of cts) {
        if (file[0] === '_') continue
        let fpath = path.join(dir_path, file)
        const st = fs.statSync(fpath)
        if (st.isDirectory()) {
          handle_dir(fpath)
        } else if (this.shouldProcess(file)) {
          // try to get the cached version first
          const src = new PageSource(this, dir_path, file, st.mtimeMs)
        }
      }
    }

    if (!fs.statSync(root).isDirectory()) {
      throw new Error(`${root} is not a directory`)
    }
    handle_dir(root)
  }

  generate(lang = this.default_language, out: string) {
    if (!this.main_path) throw new Error(`no main directory to generate`)
    for (var p of this.main_dir.all_page_sources) {
      if (!p.generate) continue
      // FIXME should change to the slug

      const output_path = path.join(path.dirname(p.path), path.basename(p.path, path.extname(p.path)) + '.html')
      const full_output_path = path.join(out, output_path)
      const dirname = path.dirname(full_output_path)

      // create the output directory if it didn't exist
      sh.mkdir('-p', dirname)

      var perf = performance.now()
      const inst = p.getInstance(lang)
      try {
        // console.log(inst.source._parser.getCreatorFunction().toString())
        const res = inst.get_block('__render__')
        for (let err of p._parser.errors) {
          console.error(`${c.red(p.path)} ${c.green(''+(err.range.start.line+1))}: ${c.grey(err.message)}`)
        }
        fs.writeFileSync(full_output_path, res, { encoding: 'utf-8' })
        console.error(` ${c.green('*')} ${output_path} ${c.green(`${Math.round(100 * (performance.now() - perf))/100}ms`)}`)
      } catch (e) {
        console.error(` ${c.bold(c.red('!'))} ${p.path} ${e.message}`)
      }
    }
  }

  /**
   * Setup watching
   */
  watch() {
    watch(this.paths, {
      persistent: true,
      awaitWriteFinish: true,
      atomic: 250,
      alwaysStat: true,
    }).on('all', (evt, path, stat) => {
      // When receiving an event, we check all the "jobs" that depend on the path in question.
    })
  }

}
