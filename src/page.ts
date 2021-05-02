import fs from 'fs'
import pth from 'path'
import util from 'util'
import sh from 'shelljs'
import { I } from './optimports'
import c from 'colors'

import { FilePath } from './path'
import { init_timer } from './helpers'
import type { Site, Generation } from './site'
import { Parser, BlockFn, InitFn, } from './parser'
import { Env, cache_bust } from './env'
// import { env } from './env'

export type Blocks = {[name: string]: BlockFn}
export type PostprocessFn = (str: string) => string

const roerror = function () { throw new Error(`object is read-only`) }
const read_only_target: ProxyHandler<any> = {
  get(target, prop) {
    var targeted = target[prop]
    return targeted //targeted != null ? read_only_proxy(target[prop]) : targeted
  },
  set: roerror,
  deleteProperty: roerror,
  defineProperty: roerror,
  setPrototypeOf: roerror,
}

function read_only_proxy<T>(obj: T): Readonly<T> {
  if (obj == null || util.types.isProxy(obj) || typeof obj !== 'object') return obj
  let res = new Proxy(obj, read_only_target)
  return res
}

// const markdown = m({linkify: true, html: true})

/**
 * A page that can exist as many versions
 */
export class PageSource {

  constructor(
    public site: Site,
    public path: FilePath,
  ) {
    this.parse()
  }

  [util.inspect.custom]() {
    return `<PageSource:${this.path.absolute_path}>`
  }

  // inits: InitFn[] = []
  _mtime!: number // the last mtime, used for cache checking

  // the same with the directories
  repeat_fn?: (env: Env) => any
  create_fn!: (env: Env, next?: (env: Env) => any) => void
  has_errors = false

  /**
   * Get all init functions recursively.
   * Look into the cache first -- should we stat all the time ?
   */
  get_init_tpls(): PageSource[] {
    let components = this.path.filename.split(pth.sep).slice(1) // remove the leading '/'
    let l = components.length - 1
    // for a file named /dir1/dir2/thefile.tpl we will lookup
    // first ../../__init__.tpl  ../__init__.tpl and __init__.tpl
    return components.map((_, i) => {
      let look = pth.join('../'.repeat(l - i), '__init__.tpl')
      return this.path.lookup(look)
    })
      .filter(c => c != null)
      .map(p => {
        this.site.addDep(this.path.absolute_path, p!.absolute_path)
        return this.site.get_page_source(this.path, p!)
      })
  }

  parse() {
    var src = fs.readFileSync(this.path.absolute_path, 'utf-8')
    const parser = new Parser(src)

    parser.parse()

    this.has_errors = parser.errors.length > 0
    if (parser.errors.length > 0) {
      for (let e of parser.errors) {
        this.path.error({}, e.range.start.line+1, e.message)
      }
      // console.log(parser.blocks)
      return
    }

    this.repeat_fn = parser.getRepeat()
    this.create_fn = parser.getIniter()

    if (!this.path.isDirFile()) {
      // get_dirs gives the parent directory pages ordered by furthest parent first.
      const dirs = this.get_init_tpls()
      let c: any = this.create_fn
      const hld = (i: number): any => {
        if (i > dirs.length - 1) return c
        let creat = dirs[i].create_fn
        let next = hld(i+1)
        return (env: Env) => creat(env, next)
      }
      if (dirs.length) {
        this.create_fn = hld(0)
      }
    }
  }

  cached_pages = new Map<string, Page>()

  get_page(gen: Generation) {
    let page = this.cached_pages.get(gen.generation_name)
    if (page) {
      return page
    }

    let post: PostprocessFn | undefined
    if (this.path.extension === 'md') {
      post = (str: string): string => {
        return I.md.render(str)
      }
    }

    let repeat = this.repeat_fn
    let ro_gen = read_only_proxy(gen)
    if (repeat) {
      let p = new Page(this, ro_gen)
      let env = new Env(this.path, p, gen, this.site)
      p.$$repetitions = new Map()
      let res = repeat(env)

      let prev: Page | undefined
      let prev_iter: any
      let prev_iter_key: any
      let envs = new Map<Page, Env>()
      for (let [k, v] of (typeof res === 'object' ? Object.entries(res) : res.entries())) {
        let inst = new Page(this, ro_gen)
        let ev = new Env(this.path, inst, gen, this.site)
        envs.set(inst, ev)
        if (post && typeof inst.$postprocess === 'undefined') inst.$postprocess = post
        ev.__iter = v
        ev.__iter_prev = prev_iter
        ev.__iter_prev_key = prev_iter_key

        ev.__iter_key = k
        ev.__iter_prev_page = prev
        if (prev) {
          let pev = envs.get(prev)!
          pev.__iter_next_page = inst
          pev.__iter_next = v
          pev.__iter_next_key = k
        }
        prev = inst
        prev_iter = v
        p.$$repetitions.set(k, inst)
        // inst.$$generate_single()
      }
      for (let pg of p.$$repetitions.values()) {
        this.create_fn(envs.get(pg)!)
      }

      page = p
    } else {
      // console.log(this.path, this.kls)
      page = new Page(this, ro_gen)
      if (post && typeof page.$postprocess === 'undefined') page.$postprocess = post
      let env = new Env(this.path, page, gen, this.site)
      this.create_fn(env)
    }

    this.cached_pages.set(gen.generation_name, page)
    return page
  }

}

/*
  There is a need to have pages that "know" from where they were created when doing
  relative imports / get_

  Code needs to be emitted so that whenever a block changes, a variable (thisfile ?)
  is backuped and restored around the block change.

  Beginning of each block should start by doing
    let $$prev_path = $[thispath]
    $[thispath] = $$path

    ...

    $[thispath] = $$prev_path // at the end of the block
*/

export class Page {

  constructor(
    public $$source: PageSource,
    public $$params: Generation,
  ) { }

  [util.inspect.custom]() {
    return `<Page:${this.path.absolute_path}:${this.$$params.generation_name}>`
  }

  env!: Env
  blocks: {[name: string]: (p?: Page) => string} = {}

  $$current_block?: string
  path = this.$$source.path
  __path_current?: FilePath
  __lang = this.$$params.lang
  // Stuff that needs to be defined by the Page source
  $$repetitions?: Map<any, Page>

  get current_path() {
    return this.__path_current ?? this.path
  }

  // Repeating stuff !
  $markdown_options?: any
  $postprocess?: PostprocessFn
  parent?: Page
  out_full_name?: string
  out_dir = this.path.local_dir
  base_slug = this.path.basename.replace(/\..*$/, '')
  slug = this.base_slug // set by PageSource
  skip = false

  get_block(name: string) {
    return this.blocks[name]?.(this) ?? ''
  }

  get $output_name() {
    let outname = this.slug + (this.env.__iter_key && this.slug === this.base_slug ? '-' + this.env.__iter_key : '') + '.html'
    return outname
  }

  get url(): string | undefined {
    if (this.skip) {
      return undefined
      // this.$$warn(`requested url of a page that is skipped`)
    }
    let res: string
    if (this.out_full_name)
      res = pth.join(this.$$params.base_url, this.out_full_name) + cache_bust
    else
      res = pth.join(this.$$params.base_url, this.out_dir, this.$output_name) + cache_bust
    return res// .replace(/\.html(?=\?)?/, '')
  }

  get $final_output_path() {
    if (this.out_full_name)
      return pth.join(this.$$params.out_dir, this.out_full_name)
    return pth.join(this.$$params.out_dir, this.out_dir, this.$output_name)
  }

  $$generate_single() {
    try {
      let tim = init_timer()
      // console.log(this.$final_output_path)
      // Now we can get the file and put it in its output !
      let out = this.$final_output_path
      sh.mkdir('-p', pth.dirname(out))
      fs.writeFileSync(out, this.blocks.__render__(this), { encoding: 'utf-8' })
      // console.log(out)
      this.path.info(this.$$params, '->', c.green(this.$output_name), tim())
      if (this.url) this.env.site.urls.add(this.url)
    } catch (e) {
      this.path.error(this.$$params, c.grey(e.message))
      // console.log(e.stack)
    }
  }

  $$generate() {

    let reps = this.$$repetitions
    if (reps) {
      for (let pg of reps.values()) {
        pg.$$generate_single()
      }
    } else {
      this.$$generate_single()
    }
  }

}

let proto = Page.prototype as any
proto.Map = Map
proto.Set = Set
