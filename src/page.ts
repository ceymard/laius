
import * as fs from 'fs'
import * as path from 'path'
import * as util from 'util'
import * as c from 'colors/safe'
// import * as sh from 'shelljs'

import { Parser } from './parser'
import { performance } from 'perf_hooks'


export type Writer = (val: any) => any
export type BlockFn = (w: Writer) => any

export interface DirectoryData {
  title?: string
  slug?: string
  date?: Date
  page_template?: string
  dir_template?: string
  generate?: boolean
}

export class Paginator {

}

interface Data {
  // default: any
  [name: string]: any
}

/**
 * A page that can exist as many versions
 */
export class PageSource {

  _data_source?: string
  _source?: string
  _data?: Data
  _$$init = (dt: any): any => { }
  _parser!: Parser

  get generate(): boolean {
    var bs = path.basename(this.path)
    var ext = path.extname(this.path)
    return !!bs && bs[0] !== '_' && ['.md', '.html'].includes(ext)
  }

  constructor(
    public root: string,
    public path: string,
    public dir: Directory,
  ) {

  }

  get source(): string {
    if (this._source != null) return this._source
    var fname = path.join(this.root, this.path)
    var src = fs.readFileSync(fname, 'utf-8')
    this._source = src
    this._parser = new Parser(src)
    this._$$init = this._parser.getInitFunction()
    return this._source
  }

  get $$init(): (dt: any) => any {
    this.source // trigger the source parsing
    return this._$$init!
  }

  // _instances = new Map<string, PageInstance>()
  getInstance(lang: string = this.dir.site.default_language) {
    // const p = this._instances.get(lang)
    // if (p) return p

    const np = new PageInstance(this, lang)
    // this._instances.set(lang, np)
    return np
  }

}

export class PageInstance {
  constructor(
    public source: PageSource,
    public lang = source.dir.site.default_language
  ) {
    this.__init_data()
  }

  [util.inspect.custom]() {
    return `<PageInstance '${this.path}'>`
  }

  path = this.source.path

  __init_data() {
    const handle_dir = (dir: Directory) => {
      if (dir.parent) handle_dir(dir.parent)
      // this.data.$this = this.dir
      dir.$$init(this.data)
    }
    // console.log(this.source.$$init)
    handle_dir(this.dir)
    // this.data.$this = this
    this.source.$$init(this.data)
  }

  dir = this.source.dir
  data: { $lang: string, $page: PageInstance, $template?: string, $this: PageInstance } = { $lang: this.lang, $page: this, $this: this }

  // data = this.source.data[this.lang] ?? this.source.data[this.source.dir.site.lang_default]

  __blocks?: {[name: string]: BlockFn}
  get blocks() {
    if (!this.__blocks) {
      this.__blocks = {}
      const tpl = this.source._parser.extends ?? this.data.$template
      const parent = tpl ? this.source.dir.get_page(tpl) : null
      var parent_blocks = null
      if (parent) {
        parent.data.$page = this
        parent.data.$this = parent
        parent_blocks = parent.blocks
      }

      const blocks = this.source._parser.getCreatorFunction()(
        parent_blocks,
        this.data,
        this.path
      )

      this.__blocks = blocks
    }
    return this.__blocks
  }

  /**
   * Get a block by its name
   */
  get_block(name: string) {

  }

  contents() {
    return this.get_block('__main__')
  }
}

/**
 * A directory that holds pages and that can be traversed
 */
export class Directory {

  sources = new Map<string, PageSource>()
  subdirs = new Map<string, Directory>()
  index: PageSource | null = null
  data: Data = {}

  /**
   * This will most likely be overriden by the contents of __dir__.laius
   */
  $$init = (scope: any): any => { }

  constructor(
    public parent: Directory | null,
    public root: string,
    public path: string, // path is the local path
    public site: Site,
  ) {
    this.__process()
  }

  __addPage(fname: string): PageSource {
    const local_pth = path.join(this.path, fname)
    var p = new PageSource(this.root, local_pth, this)
    this.sources.set(fname, p)
    return p
  }

  get_page_source_from_path(paths: string[]): PageSource | null {
    while (paths[0] === '.')
      paths = paths.slice(1)
    if (paths.length === 0) return null
    if (paths.length === 1) {
      const p = this.sources.get(paths[0])
      if (!p) return null
      return p
    }
    if (paths[0] === '') {
      return this.site.get_page_source_from_path(paths.slice(1))
    }
    const d = this.subdirs.get(paths[0])
    if (!d) return null
    return d.get_page_source_from_path(paths.slice(1))
  }

  get_page(fname: string, lang: string = this.site.default_language) {
    const src = this.get_page_source(fname)
    if (!src) throw new Error(`page '${fname}' not found`)
    return src.getInstance(lang)
  }

  get_page_source(fname: string) {
    const parts = fname.replace(/\/+$/, '').split(/\//g)
    return this.get_page_source_from_path(parts)
  }

  get all_page_sources(): PageSource[] {
    var res: PageSource[] = [...this.sources.values()]
    for (let d of this.subdirs.values()) {
      res = [...res, ...d.all_page_sources]
    }
    return res
  }

  private __get_dirfile() {
    var abpath = path.join(this.root, this.path, '__dir__.laius')

    if (fs.existsSync(abpath) && fs.statSync(abpath).isFile()) {
      var cts = fs.readFileSync(abpath, 'utf-8')
      var p = new Parser(cts)
      this.$$init = p.getInitFunction()
    }
  }

  /**
   * Read the directory to get the files we need to process as well
   * as the __dir__.laius files that contain some data that will be forwarded
   * in all the descendent pages.
   */
  private __process() {
    var dirabspth = path.join(this.root, this.path)

    var data: {[name: string]: any} = {}
    // include the data of the parent directory into our own
    if (this.parent) {
      var old = this.parent.data
      for (var x in old) {
        data[x] = Object.assign({}, old[x])
      }
    }

    this.__get_dirfile()
    this.data = data

    // Now figure out this directory's files and subdirectories and handle them
    const cts = fs.readdirSync(dirabspth)
    cts.sort()
    for (var f of cts) {
      var local_pth = path.join(this.path, f)
      var st = fs.statSync(path.join(this.root, local_pth))
      var ext = path.extname(local_pth)

      if (st.isDirectory()) {
        var dir = new Directory(this, this.root, local_pth, this.site)
        this.subdirs.set(f, dir)
      }  else if (this.site.extensions.has(ext)) {
        console.log(`   -> ${local_pth}`)
        this.__addPage(f)
        // console.log(p.data)
      }
    }
  }
}


export class Site {

  default_language = 'en'
  dirs_map = new Map<string, Directory>() // maps root => Directory
  main_dir!: Directory
  extensions = new Set(['.md', '.html', '.tpl'])

  constructor() {

  }

  get_yaml(fname: string): object | null {
    return null
  }

  get_page_source_from_path(paths: string[]): PageSource | null {
    return this.main_dir.get_page_source_from_path(paths)
  }

  get_dir(fname: string): Directory | null {
    return null
  }

  process_content_directory(dir: string, parent_data: any) {
    // _data is broadcast to all the directory children
  }

  addFolder(folder: string, outdir: string) {
    var dir = new Directory(null, folder, '', this)
    this.main_dir = this.main_dir ?? dir
    this.dirs_map.set(folder, dir)
  }

  generate(lang = this.default_language) {
    if (!this.main_dir) throw new Error(`no main directory to generate`)
    for (var p of this.main_dir.all_page_sources) {
      // if (!p.generate) continue
      var perf = performance.now()
      const inst = p.getInstance(lang)
      const fn = inst.source._parser.getCreatorFunction()
      try {
        const test2 = inst.blocks
        test2.__render__($(lang))
        // console.log('')
        console.log(` ${c.green('*')} ${p.path} (${Math.round(100 * (performance.now() - perf))/100})ms`)
      } catch (e) {
        console.error(e)
        console.log(fn)
      }
      for (let err of p._parser.errors) {
        console.error(`${c.red(p.path)} ${c.green(''+(err.range.start.line+1))}: ${err.message}`)
      }

      // console.log(inst.source._parser.emitters)
      // console.log(inst.data)
    }
  }

}


class Base {

}

function $(lang: string) {

  return function $(arg: any, pos?: any) {
    if (typeof arg === 'function') {
      try {
        arg = arg()
      } catch (e) {
        arg = c.red(`<span class='laius-error'>${pos ? `${pos.path} ${pos.line}:` : ''} ${e.message}</span>`)
      }
    }
    // if (arg instanceof Date) {
    //   var d = Intl.DateTimeFormat('fr', { day: 'numeric', month: 'long', year: 'numeric' })
    //   arg = d.format(arg)
    // }
    process.stderr.write((arg ?? '').toString())
    // console.log('=>', arg)
  }
}