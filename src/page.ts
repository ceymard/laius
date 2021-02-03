
import fs from 'fs'
import path from 'path'
import util from 'util'
import m from 'markdown-it'

import type { Site, Generation } from './site'
import { Parser, BlockFn } from './parser'

export type InitFn = ($: Page) => any

// Hang on... I need the language parts to be able to reference each other...
export interface GenerateOpts {
  lang: string
  rooturl?: string // if not given, then the paths will be relative.
}

/**
 * A page that can exist as many versions
 */
export class PageSource {

  inits: InitFn[] = []
  _mtime!: number // the last mtime, used for cache checking

  constructor(
    public site: Site,
    public folder_base: string,
    public path: string,
    public mtime: number,
  ) {
    this.parse()
  }

  blocks!: {[name: string]: BlockFn}

  parse() {
    var fname = path.join(this.folder_base, this.path)
    var src = fs.readFileSync(fname, 'utf-8')
    const parser = new Parser(src, this.path)
    const dirs = this.site.get_dirs(this.path)

    this.inits.push(parser.getInitFunction())
    parser.parse()
    // console.log(parser.getBlockDefinitions())
    const blocks = parser.getCreatorFunction()
    this.blocks = blocks
    console.log(blocks.toString())
  }

  getPage(data: any) {
    const np = new Page()
    for (var x in data) {
      (np as any)[x] = data[x]
    }
    np[sym_source] = this
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
export const sym_source = Symbol('source')
export const sym_inits = Symbol('inits')
export const sym_repeats = Symbol('repeats')


export class Page {
  [sym_inits]: (() => any)[] = [];
  [sym_repeats]: (() => any)[] = [];

  // Stuff that needs to be defined by the Page source
  [sym_source]!: PageSource

  /** The blocks. Given generally once the value of $template is known. */
  [sym_blocks]!: {[name: string]: BlockFn}

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
        arg = `<span class='laius-error'>${pos ? `${pos.path} ${pos.line}:` : ''} ${e.message}</span>`
      }
    }
    return (arg ?? '').toString()
  }

  get_main_block(): string {
    const self = this as any
    return self['βmain'](this)
  }

  /**
   * Get a block by its name
   */
  get_block(name: string): string {
    const self = this as any
    if (!self[name]) throw new Error(`block ${name} does not exist`)
    return self[name](this)
  }

  datetime_numeric = (dt: any) => {

  }

  datetime_long = (dt: any) => {

  }

  date_numeric = (dt: any) => {

  }

  date_long = (dt: any) => {
    const lang = this.lang
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
  file_static(fname: string, outpath?: string) { }

  /** Transform an image. Uses sharp. */
  file_image(fname: string, opts?: { transform?: any[], output?: string }) { }

  /** */
  file_sass() { }

  /** */
  file_stylus() { }

  /** Read a file's content */
  get_file(fname: string) { }

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
