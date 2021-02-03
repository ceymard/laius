
import fs from 'fs'
import pth from 'path'
import c from 'colors'
// import util from 'util'
// import m from 'markdown-it'

import type { Site, Generation } from './site'
import { Parser, BlockFn, CreatorFn, InitFn } from './parser'

type Blocks = {[name: string]: BlockFn}

// Hang on... I need the language parts to be able to reference each other...
export interface GenerateOpts {
  lang: string
  rooturl?: string // if not given, then the paths will be relative.
}

/**
 * A page that can exist as many versions
 */
export class PageSource {

  // inits: InitFn[] = []
  init!: InitFn
  inits!: InitFn[]
  _mtime!: number // the last mtime, used for cache checking

  constructor(
    public site: Site,
    /** root of the file */
    public path_root: string,
    /** path of the file inside the root */
    public path: string,
    public mtime: number,
  ) {
    this.parse()
    // console.log(this.path_basename)
    // console.log(this.path_naked_name)
  }

  path_dir = pth.dirname(this.path)
  path_absolute = pth.join(this.path_root, this.path)
  path_absolute_dir = pth.dirname(this.path_absolute)
  path_extension = pth.extname(this.path)
  path_basename = pth.basename(this.path)
  path_naked_name = this.path_basename.replace(/\..*$/, '')

  is_dir(): boolean {
    return this.path_basename === '__dir__.tpl'
  }

  blocks!: string
  block_creator!: CreatorFn
  default_template?: string

  parse() {
    var src = fs.readFileSync(this.path_absolute, 'utf-8')
    const parser = new Parser(src, this.path)

    // get_dirs gives the parent directory pages ordered by furthest parent first.
    const dirs = this.is_dir() ? [] : this.site.get_dirs(this)

    this.init = parser.getInitFunction()
    // The init functions are ordered by `root -> ...parents -> this page's init`
    this.inits = dirs.map(d => d.init)
    this.inits.push(this.init)

    parser.parse()
    this.blocks = parser.getBlockDefinitions(false) // get the blocks besides main
    const creator = parser.getCreatorFunction(dirs.map(d => d.blocks))
    this.block_creator = creator
    this.default_template = parser.extends
    // console.log(creator.toString())
  }

  getPage(data: any) {
    const np = new Page()
    np[sym_source] = this
    // MISSING PATH AND STUFF

    for (var x in data) {
      (np as any)[x] = data[x]
    }

    for (const i of this.inits) {
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
    const post = undefined // FIXME this is where we say we will do some markdown
    // If there is a parent defined, then we want to get it
    if (parent) {
      let parpage_source = this.site.get_page_source(this.path_root, parent)
      if (!parpage_source) throw new Error(`cannot find parent template '${parent}'`)
      let parpage = parpage_source!.getPage({...data, page: np})
      np[sym_parent] = parpage
      np[sym_set_block](this.block_creator(np, parpage[sym_blocks], post))
    } else {
      np[sym_blocks] = this.block_creator(np, null, post)
    }

    // if it does, get its page source

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
    const fmt = long_dates[lang] = long_dates[lang] ?? Intl.DateTimeFormat(lang)
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
  static_file(fname: string, outpath?: string) { }

  /** Transform an image. Uses sharp. */
  image(fname: string, opts?: { transform?: any[], output?: string }) { }

  /** */
  sass() { }

  /** */
  stylus() { }

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
