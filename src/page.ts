
import fs from 'fs'
import path from 'path'
import util from 'util'
import m from 'markdown-it'

import { Parser, BlockFn } from './parser'
import { Data } from './data'
import type { Site } from './site'

export type InitFn = (dt: Data) => any

// Hang on... I need the language parts to be able to reference each other...
export interface GenerateOpts {
  lang: string
  rooturl?: string // if not given, then the paths will be relative.
}

/**
 * A page that can exist as many versions
 */
export class PageSource {

  _source?: string
  _$$inits: InitFn[] = []
  _$$init = (dt: any): any => { }
  _parser!: Parser
  _mtime!: number // the last mtime, used for cache checking

  constructor(
    public site: Site,
    public folder_base: string,
    public path: string,
    public mtime: number,
  ) {

  }

  get source(): string {
    if (this._source != null) return this._source
    var fname = path.join(this.folder_base, this.path)
    var src = fs.readFileSync(fname, 'utf-8')
    this._source = src
    this._parser = new Parser(src, this.path)
    this._$$init = this._parser.getInitFunction()
    return this._source
  }

  get $$init(): (dt: any) => any {
    this.source // trigger the source parsing
    return this._$$init
  }

  getInstance(lang: string = this.site.default_language) {
    const np = new PageInstance(this, lang)
    return np
  }

}

export class PageInstance {
  constructor(
    public source: PageSource,
    public lang = source.site.default_language
  ) {
    // Initialize the data of the page instance
    const post_init: (() => any)[] = []
    this.data.$post_init = (fn: () => any) => {
      if (typeof fn !== 'function') throw new Error(`$post_init must receive a function`)
      post_init.push(fn)
    }
    for (let init of this.source._$$inits) {
      init(this.data)
    }
    for (let p of post_init.reverse()) {
      p()
    }
  }

  [util.inspect.custom]() {
    return `<PageInstance '${this.path}'>`
  }

  path = this.source.path
  data = new Data(this, this, this.lang)

  isIgnored() {
    return false
  }

  __blocks?: {[name: string]: BlockFn}
  get blocks() {
    if (!this.__blocks) {
      this.__blocks = {}
      const tpl = this.source._parser.extends ?? this.data.$template
      const parent = tpl ? this.source.site.get_page(tpl) : null
      var parent_blocks = null
      if (parent) {
        parent.data.page = this
        parent.data.self = parent
        parent_blocks = parent.blocks
      }

      var pp: undefined | ((str: string) => string)
      if (path.extname(this.path) === '.md') {
        var opts: m.Options = Object.assign({
          html: true,
          linkify: true,
        }, this.data.$markdown_options)
        const md = new m(opts)
        pp = (str: string) => md.render(str)
      }

      const blocks = this.source._parser.getCreatorFunction()(
        parent_blocks,
        this.data,
        pp,
      )

      this.__blocks = blocks
      // for (var x in blocks){
      //   console.log(blocks[x].toString())
      // }
      // console.log(blocks)
    }
    return this.__blocks
  }

  import(name: string): any {
    const inst = this.source.site.get_page(name, this.lang)
    return inst.data
  }

  has_block(name: string): boolean {
    return !!this.blocks[name]
  }

  /**
   * Get a static file relative to this page and copy it to the output.
   * Returns a link relative to the current page.
   */
  static_file(name: string): string {
    // compute the path relative to the target page
    const page_diff = path.relative(this.data.page.dir.path, name)
    // and add the relative path to this particular file to the list of files to copy
    // this._included_static_files.push(path.relative(this.dir.path, name))
    return page_diff
  }

  /**
   * Get a block by its name
   */
  get_block(name: string): string {
    if (!this.blocks[name])
      throw new Error(`block '${name}' does not exist`)

    return this.blocks[name]()
  }

  /**
   * Alias to get_page.get_block('__render__')
   */
  include(path: string, name: string = '__render__') {
    const p = this.source.site.get_page(path)
    return p.get_block(name)
  }

  contents() {
    return this.get_block('__main__')
  }
}
