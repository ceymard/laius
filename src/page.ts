
import * as fs from 'fs'
import * as path from 'path'
import * as util from 'util'
import { Parser } from './parser'

// memoize the results of an accessor
// function memo(inst: any, prop: string, desc: PropertyDescriptor) {
//   const orig = desc.get
//   var sym = Symbol('memo-' + prop)
//   desc.get = function (this: any) {
//     var prev = this[sym]
//     if (this[sym]) return prev
//     this[sym] = orig!.apply(this, arguments as any)
//   }
// }

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
export class Template {

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

  getInstance(lang: string = this.dir.site.default_language) {
    return new PageInstance(this, lang)
  }

}

export class PageInstance {
  constructor(
    public source: Template,
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
  data = { $lang: this.lang, $page: this as any, $this: this as any }

  // data = this.source.data[this.lang] ?? this.source.data[this.source.dir.site.lang_default]

  _content?: string
  get content(): string {
    // Get
    return ''
  }
}

/**
 * A directory that holds pages and that can be traversed
 */
export class Directory {

  pages: Template[] = []
  subdirs: Directory[] = []
  index: Template | null = null
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

  addPage(path: string): Template {
    var p = new Template(this.root, path, this)
    this.pages.push(p)
    // p.getInstance().data
    return p
  }

  get all_pages(): Template[] {
    var res: Template[] = this.pages.slice()
    for (let d of this.subdirs) {
      res = [...res, ...d.all_pages]
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
        this.subdirs.push(dir)
      }  else if (this.site.extensions.has(ext)) {
        console.log(`   -> ${local_pth}`)
        this.addPage(local_pth)
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

  get_page(fname: string): Template | null {
    return null
  }

  get_dir(fname: string): Directory | null {
    return null
  }

  process_content_directory(dir: string, parent_data: any) {
    // _data is broadcast to all the directory children
  }

  addFolder(folder: string) {
    var dir = new Directory(null, folder, '', this)
    this.main_dir = this.main_dir ?? dir
    this.dirs_map.set(folder, dir)
  }

  generate(lang = this.default_language) {
    if (!this.main_dir) throw new Error(`no main directory to generate`)
    for (var p of this.main_dir.all_pages) {
      // if (!p.generate) continue
      const inst = p.getInstance(lang)
      console.log(`\n\n--- ${p.path}:\n\n`)
      const fn = inst.source._parser.getCreatorFunction()
      try {
        const build = new Function('parent', fn)
        const more = build(Base)
        const test = new more()
        test.__main__(inst.data, $)
        console.log('')
      } catch (e) {
        console.error(e)
        console.log(fn)
      }

      // console.log(inst.source._parser.emitters)
      // console.log(inst.data)
    }
  }

}


class Base {

}

function $(arg: any) {
  arg = typeof arg === 'function' ? arg() : arg
  process.stderr.write((arg ?? '').toString())
  // console.log('=>', arg)
}