import fs from 'fs'
import pth from 'path'
import util from 'util'
import sh from 'shelljs'
import { I, Iteration } from './env'
import c from 'colors'

import { FilePath } from './path'
import { init_timer } from './helpers'
import type { Site, Generation } from './site'
import { Creator, CreatorFunction, Parser } from './parser'
import { create_env, Environment, cache_bust } from './env'

export type PostprocessFn = (str: string) => string

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
  base_creator!: CreatorFunction
  inits: PageSource[] = []

  parser!: Parser
  has_errors = false

  /**
   * Get all init functions recursively.
   * Look into the cache first -- should we stat all the time ?
   */
  get_init_tpls(): PageSource[] {
    if (this.path.isDirFile()) return []
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
    this.parser = parser
    parser.parse()

    this.has_errors = parser.errors.length > 0
    if (parser.errors.length > 0) {
      for (let e of parser.errors) {
        this.path.error({}, e.range.start.line+1, e.message)
      }
      // console.log(parser.blocks)
      return
    }

    this.base_creator = parser.getCreatorFunction()
    this.inits = this.get_init_tpls()
  }

  create(env: Environment) {
    env.__lang = env.__params.lang
    let page = new Page(this, env)
    env.__current = env.θ = env.$ = page
    let creat = this.base_creator(env)

    let inits = this.inits
    let creators: Creator[] = []
    for (let i of inits) {
      // copy the environment
      let e2 = i === this ? env : {...env}
      let current = new Page(i, e2)
      e2.__current = current

      let b = i.base_creator(e2)
      creators.push(b)
    }

    return {
      repeat: creat.repeat ? function repeat() {
        for (let c of creators) { c.init() }
        for (let c of creators.reverse()) { c.postinit() }
        return creat.repeat!()
      } : null,
      init() {
        for (let c of creators) { c.init() }
        creat.init()
        creat.postinit()
        for (let c of creators.reverse()) { c.postinit() }
      },
      page
    }
  }

  cached_pages = new Map<string, Page>()

  get_page(gen: Generation): Page {
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

    let env = create_env({ __params: gen })
    let c = this.create(env)
    page = c.page

    let repeat = c.repeat
    if (repeat) {
      // let env = new Env(this.path, p, gen, this.site)
      page.$$repetitions = new Map()
      let res = repeat()

      let __entries = (typeof res === 'object' ? Object.entries(res) : res.entries())
      let __iters: Iteration[] = []
      let i = 0
      for (let [k, v] of __entries) {
        let iter: Iteration = {
          index: i,
          value: v,
          key: k,
          page: undefined!,
          is_first: i === 0,
          is_last: i >= __entries.length - 1,
          count: __entries.length
        }
        __iters.push(iter)
        let env_sub = create_env({__params: gen, __iter: iter, __key: k, __value: v})
        let c = this.create(env_sub)
        iter.page = c.page
        if (post && typeof c.page.$postprocess === 'undefined') c.page.$postprocess = post

        if (i > 0) {
          let pev = __iters[i - 1]
          pev.next = iter
          iter.prev = pev
        }

        page.$$repetitions.set(k, c.page)
        c.init()
        i++
        // inst.$$generate_single()
      }
    } else {
      // console.log(this.path, this.kls)
      if (post && typeof env.$postprocess === 'undefined') env.$postprocess = post
      // let env = new Env(this.path, page, gen, this.site)
      c.init()
      page = env.θ
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
    public __env: Environment,
  ) { }

  $$params = this.__env.__params;

  [util.inspect.custom]() {
    return `<Page:${this.path.absolute_path}:${this.$$params.generation_name}>`
  }

  blocks: {[name: string]: (p?: Page) => string} = {}

  path = this.$$source.path
  // Stuff that needs to be defined by the Page source
  $$repetitions?: Map<any, Page>

  // Repeating stuff !
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
    let outname = this.slug + (this.__env.__iter?.key && this.slug === this.base_slug ? '-' + this.__env.__iter.key : '') + '.html'
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
      if (this.url) this.__env.__params.site.urls.add(this.url)
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
