
import * as fs from 'fs'
import * as path from 'path'
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
    return this._source
  }

  get data(): {[name: string]: any} {
    if (this._data != null) return this._data
    var data: {[name: string]: any} = {}
    this._data = data
    var ddata = this.dir.data

    for (var x in ddata) {
      data[x] = Object.assign({}, ddata[x])
    }

    var src = this.source
    var default_lang = this.dir.site.lang_default

    return this._data
  }

}

export class PageInstance {
  constructor(
    public source: Template,
    public lang = source.dir.site.lang_default
  ) {

  }

  dir = this.source.dir
  data = this.source.data[this.lang] ?? this.source.data[this.source.dir.site.lang_default]

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
  $$init = (scope: any) => { }

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
      console.log(p.parseFirstExpression())
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
    // Read the _data.yml of this directory and include it into the local data
    // var yml = this.__get_yaml('_data.yml')
    // for (var dt of yml) {
    //   if (!dt || dt.constructor !== Object) continue
    //   var key = dt.lang ?? this.site.lang_default
    //   data[key] = Object.assign({}, data[key], dt)
    // }

    this.data = data

    // Now figure out this directory's files and subdirectories and handle them
    const cts = fs.readdirSync(dirabspth)
    cts.sort()
    for (var f of cts) {
      var local_pth = path.join(this.path, f)
      var st = fs.statSync(path.join(this.root, local_pth))

      if (st.isDirectory()) {
        var dir = new Directory(this, this.root, local_pth, this.site)
        this.subdirs.push(dir)
      }  else if (f.endsWith('.html') || f.endsWith('.md')) {
        console.log(`   -> ${local_pth}`)
        this.addPage(local_pth)
        // console.log(p.data)
      }
    }
  }
}


export class Site {

  lang_default = 'en'
  dirs_map = new Map<string, Directory>() // maps root => Directory

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
    this.dirs_map.set(folder, dir)
  }

}
