
import fs from 'fs'
import pth from 'path'
import c from 'colors'
// import util from 'util'
import { Remarkable } from 'remarkable'

import type { Site, Generation } from './site'
import { Parser, BlockFn, CreatorFn, InitFn } from './parser'

export type Blocks = {[name: string]: BlockFn}

// Hang on... I need the language parts to be able to reference each other...
export interface GenerateOpts {
  lang: string
  rooturl?: string // if not given, then the paths will be relative.
}

// const markdown = m({linkify: true, html: true})

/**
 * A page that can exist as many versions
 */
export class PageSource {

  constructor(
    public site: Site,
    /** root of the file */
    public path_root: string,
    /** path of the file inside the root */
    public path: string,
    public mtime: number,
  ) {
    this.parse()
  }

  is_dir(): boolean {
    return this.path_basename === '__dir__.tpl'
  }

  // inits: InitFn[] = []
  _mtime!: number // the last mtime, used for cache checking

  path_dir = pth.dirname(this.path)
  path_absolute = pth.join(this.path_root, this.path)
  path_absolute_dir = pth.dirname(this.path_absolute)
  path_extension = pth.extname(this.path)
  path_basename = pth.basename(this.path)
  path_naked_name = this.path_basename.replace(/\..*$/, '')

  // The init functions
  init!: InitFn
  block_creator!: CreatorFn

  // the same with the directories
  all_inits: InitFn[] = []
  all_block_creators: CreatorFn[] = []

  default_template?: string

  /**
   * Get all init functions recursively.
   * Look into the cache first -- should we stat all the time ?
   */
  get_dirs(): PageSource[] {
    // console.log(path)
    let files: string[] = []
    let root = this.path_root
    let dir = this.path
    while (dir && dir !== '.' && dir !== '/') {
      // console.log(dir)
      dir = pth.dirname(dir)
      files.push(pth.join(dir, '__dir__.tpl'))
    }

    let res: PageSource[] = []
    while (files.length) {
      let fname = files.pop()!
      let thedir = this.site.get_page_source(root, fname)
      if (thedir) res.push(thedir)
    }

    return res
  }

  parse() {
    var src = fs.readFileSync(this.path_absolute, 'utf-8')
    const parser = new Parser(src, this.path)

    this.init = parser.getInitFunction()
    parser.parse()
    this.default_template = parser.extends
    this.block_creator = parser.getCreatorFunction(!this.is_dir())

    if (!this.is_dir()) {
      // get_dirs gives the parent directory pages ordered by furthest parent first.
      const dirs = this.get_dirs()
      for (const d of dirs) {
        this.all_inits.push(d.init)
        this.all_block_creators.push(d.block_creator)
      }
    }
    this.all_inits.push(this.init)
    this.all_block_creators.push(this.block_creator)
  }

  getPage(data: any) {
    const np = new Page()
    np[sym_source] = this
    np.page_path = data.page_path ?? this.path
    // MISSING PATH AND STUFF

    for (var x in data) {
      (np as any)[x] = data[x]
    }

    for (const i of this.all_inits) {
      i(np)
    }
    const post_init = np[sym_inits]
    while (post_init.length) {
      // the post init functions are executed in reverse order ; first this page, its parent and then the root's post.
      const p = post_init.pop()
      p?.()
    }

    // Now figure out if it has a $template defined or not.
    const parent = np.$template ?? this.default_template
    let post: null | ((v: string) => string) = null // FIXME this is where we say we will do some markdown
    if (this.path_extension === '.md') {
      const md = new Remarkable('full', { html: true })
      post = (str: string): string => {
        // return str
        // return markdown.render(str)
        return md.render(str)
      }
    }

    // If there is a parent defined, then we want to get it
    if (parent) {
      let parpage_source = this.site.get_page_source(this.path_root, parent)
      if (!parpage_source) throw new Error(`cannot find parent template '${parent}'`)
      let parpage = parpage_source!.getPage({...data, page: data.page ?? np, page_path: data.page_path ?? this.path})
      np[sym_blocks] = parpage[sym_blocks]
      np[sym_parent] = parpage
    } else {
      np[sym_blocks] = {}
    }

    for (let c of this.all_block_creators) {
      c(np, np[sym_blocks], post)
    }

    return np
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

const long_dates: {[lang: string]: Intl.DateTimeFormat} = {}

export const sym_blocks = Symbol('blocks')
export const sym_set_block = Symbol('set-blocks')
export const sym_source = Symbol('source')
export const sym_inits = Symbol('inits')
export const sym_repeats = Symbol('repeats')
export const sym_parent = Symbol('parent')


export class Page {
  [sym_inits]: (() => any)[] = [];
  [sym_repeats]: (() => any)[] = [];
  [sym_parent]?: Page

  // Stuff that needs to be defined by the Page source
  [sym_source]!: PageSource

  /** The blocks. Given generally once the value of $template is known. */
  [sym_blocks]!: Blocks
  [sym_set_block](blocks: Blocks) {
    this[sym_blocks] = blocks
    this[sym_parent]?.[sym_set_block](blocks)
  }

  $path!: string
  $slug!: string

  $template?: string = undefined
  $markdown_options?: any = undefined

  // Repeating stuff !
  $repeat?: any[] = undefined
  iter?: any = undefined

  this_path!: string
  page_path!: string
  lang!: string

  /**
   *
   */
  $on_repeat(fn: () => any) {
    const $caller_path = this.this_path
    this[sym_repeats].push(() => {
      const $path_backup = this.this_path
      this.this_path = $caller_path
      fn()
      this.this_path = $path_backup
    })
  }

  /**
   *
   */
  $on_post_init(fn: () => any) {
    const $caller_path = this.this_path
    this[sym_inits].push(() => {
      const $path_backup = this.this_path
      this.this_path = $caller_path
      fn()
      this.this_path = $path_backup
    })
  }

  /**
   * The omega function is in charge of error reporting
   */
  ω(arg: any, pos?: {line: number, path: string}): string {
    if (typeof arg === 'function') {
      try {
        arg = arg()
      } catch (e) {
        const msg = e.message.replace(/λ\./g, '')
        console.log(` ${c.red('!')} ${c.gray(this.this_path)}${pos ? c.green(' '+pos.line) : ''}: ${c.gray(msg)}`)
        arg = `<span class='laius-error'>${pos ? `${pos.path} ${pos.line}:` : ''} ${msg}</span>`
      }
    }
    return (arg ?? '').toString()
  }

  get_main_block(): string {
    return this[sym_blocks]['βmain']()
  }

  has_block(name: string): boolean {
    return !!this[sym_blocks][name]
  }

  /**
   * Get a block by its name
   */
  get_block(name: string): string {
    const blk = this[sym_blocks]
    if (!blk[name]) throw new Error(`block ${name} does not exist`)
    return blk[name]()
  }

  datetime_numeric = (dt: any) => {

  }

  datetime_long = (dt: any) => {

  }

  date_numeric = (dt: any) => {

  }

  upper(val: string) {
    return (val ?? '').toString().toLocaleUpperCase(this.lang)
  }

  lower(val: string) {
    return (val ?? '').toString().toLocaleLowerCase(this.lang)
  }

  capitalize(val: string) {
    var str = (val ?? '').toString()
    if (str.length === 0) return str
    return str[0].toLocaleUpperCase(this.lang) + str.slice(1)
  }

  slugify(val: string) {

  }

  date_long(dt: any) {
    const lang = this.lang
    // console.log(lang, dt)
    const fmt = long_dates[lang] = long_dates[lang] ?? Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric' })
    return fmt.format(new Date(dt))
  }

  iif(cond: boolean, then: any, otherwise: any = null) {
    return cond ? then : otherwise
  }

  iflang(...args: any[]): any {
    for (let i = 0, l = args.length; i < l; i += 2) {

    }
    return 'IFLANG'
  }

  coalesce(...args: any[]): null {
    for (let a of args) {
      if (a != null) return a
    }
    return null
  }

  dump_raw(value: any): string { return '' }

  dump_html(value: any): string { return '' }

  /** Pass a string through some markdown */
  markdown(value: string) { }


  /////////////////////////////////////////////////////////////////////////////////////////////////////

  /** Get a static file and add it to the output */
  static_file(fname: string, outpath?: string) {
    // console.log(this.this_path, this.page_path)
    return fname
  }

  /** Transform an image. Uses sharp. */
  image(fname: string, opts?: { transform?: any[], output?: string }) { }

  /** */
  sass() { }

  /** Read a file's content */
  file_contents(fname: string) { }

  /** get a page */
  import(fname: string) {
    const src = this[sym_source]
    const imp = src.site.get_page_source(src.path_root, fname)
    return imp?.getPage({lang: this.lang})
  }

  /** Get a page from self */
  get_page(fname: string, data = '__render__', block = '__render__') {  }

  /** What about pages that repeat ? */
  get_page_data(fname: string, init_data = {}) { }

  /** Get a json from self */
  get_json(fname: string): any { }

  /** Get a yaml from self */
  get_yaml(fname: string): any { }

  /** Get a toml from self */
  get_toml(fname: string): any { }

  /** Query an SQlite database from self */
  query(fname: string, query: string): any { }
}
