import fs from 'fs'
import pth from 'path'
import c from 'colors'
import { Remarkable } from 'remarkable'
import sass from 'sass'
import sh from 'shelljs'
import util from 'util'

import { FilePath } from './path'
import { copy_file } from './helpers'
import type { Site, Generation } from './site'
import { Parser, BlockFn, CreatorFn, InitFn } from './parser'
import sharp from 'sharp'

export type Blocks = {[name: string]: BlockFn}

const roerror = function () { throw new Error(`object is read-only`) }
const read_only_target: ProxyHandler<any> = {
  get(target, prop) {
    var targeted = target[prop]
    return targeted != null ? read_only_proxy(target[prop]) : targeted
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

export interface PageGeneration extends Generation {
  page?: Page
  $$path_this: FilePath
  $$path_target: FilePath
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

  // inits: InitFn[] = []
  _mtime!: number // the last mtime, used for cache checking

  // The init functions
  init!: InitFn
  block_creator!: CreatorFn

  // the same with the directories
  all_inits: InitFn[] = []
  all_block_creators: CreatorFn[] = []

  /**
   * Get all init functions recursively.
   * Look into the cache first -- should we stat all the time ?
   */
  get_dirs(): PageSource[] {
    let components = this.path.filename.split(pth.sep)
    let l = components.length - 1
    // for a file named /dir1/dir2/thefile.tpl we will lookup
    // first ../../__dir__.tpl  ../__dir__.tpl and __dir__.tpl
    return components.map((_, i) => {
      let look = pth.join('../'.repeat(l - i), '__dir__.tpl')
      return this.path.lookup(look, [])
    })
      .filter(c => c != null)
      .map(p => this.site.get_page_source(p!))
  }

  parse() {
    var src = fs.readFileSync(this.path.absolute_path, 'utf-8')
    const parser = new Parser(src)

    this.init = parser.getInitFunction(this.path)
    parser.parse()
    this.block_creator = parser.getCreatorFunction(this.path)

    if (!this.path.isDirFile()) {
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

  get_page(gen: Generation & Partial<PageGeneration>) {
    const page_gen: PageGeneration = {
      ...gen,
      $$path_this: this.path,
      $$path_target: gen.$$path_target ?? this.path,
    }

    const np = new Page(this.site, page_gen)
    if (!page_gen.page) page_gen.page = read_only_proxy(np)

    np[sym_source] = this
    // MISSING PATH AND STUFF

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
    const parent = np[sym_extends]
    let post: null | ((v: string) => string) = null // FIXME this is where we say we will do some markdown
    if (this.path.extension === 'md') {
      const md = new Remarkable('full', { html: true })
      post = (str: string): string => {
        // return str
        // return markdown.render(str)
        return md.render(str)
      }
    }

    // If there is a parent defined, then we want to get it
    if (parent) {
      let resolved = this.path.lookup(parent, this.site.path)
      if (!resolved) throw new Error(`cannot find parent template '${parent}'`)
      let parpage_source = this.site.get_page_source(resolved)
      let parpage = parpage_source!.get_page(page_gen)
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
export const sym_extends = Symbol('extends')


export class Page {

  constructor(public $$site: Site, __opts__: PageGeneration) {
    const self = this as any

    for (var x in __opts__) {
      self[x] = (__opts__ as any)[x]
    }

    this.$out_dir = this.$$path_target.local_dir
    this.$base_slug = this.$$path_this.basename.replace(/\..*$/, '')
  }

  $$lang!: string // coming from Generation
  $$base_url!: string
  $$assets_url!: string
  $$out_dir!: string
  $$assets_out_dir!: string
  $$generation_name!: string

  $out_dir: string
  $base_slug: string

  page?: Page // set by Site
  $slug!: string // set by PageSource
  $$path_this!: FilePath
  $$path_target!: FilePath

  ;
  [sym_inits]: (() => any)[] = [];
  [sym_repeats]: (() => any)[] = [];
  [sym_parent]?: Page
  [sym_extends]?: string

  // Stuff that needs to be defined by the Page source
  [sym_source]!: PageSource

  /** The blocks. Given generally once the value of $template is known. */
  [sym_blocks]!: Blocks
  [sym_set_block](blocks: Blocks) {
    this[sym_blocks] = blocks
    this[sym_parent]?.[sym_set_block](blocks)
  }
  ;

  Map = Map
  Set = Set

  $markdown_options?: any = undefined
  // Repeating stuff !
  $repeat?: any[] = undefined
  iter?: any = undefined

  $extend(tpl: string) {
    if (typeof tpl !== 'string') throw new Error(`argument to $extend must be a string`)
    this[sym_extends] = tpl
  }

  /**
   *
   */
  $on_repeat(fn: () => any) {
    const caller_path = this.$$path_this
    this[sym_repeats].push(() => {
      const bkp_path = this.$$path_this
      this.$$path_this = caller_path
      try {
        fn()
      } finally {
        this.$$path_this = bkp_path
      }
    })
  }

  /**
   *
   */
  $on_post_init(fn: () => any) {
    const caller_path = this.$$path_this
    this[sym_inits].push(() => {
      const bkp_path = this.$$path_this
      this.$$path_this = caller_path
      try {
        fn()
      } finally {
        this.$$path_this = bkp_path
      }
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
        console.log(` ${c.red('!')} ${c.gray(this.$$path_this.filename)}${pos ? c.green(' '+pos.line) : ''}: ${c.gray(msg)}`)
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
    return (val ?? '').toString().toLocaleUpperCase(this.$$lang)
  }

  lower(val: string) {
    return (val ?? '').toString().toLocaleLowerCase(this.$$lang)
  }

  capitalize(val: string) {
    var str = (val ?? '').toString()
    if (str.length === 0) return str
    return str[0].toLocaleUpperCase(this.$$lang) + str.slice(1)
  }

  slugify(val: string) {

  }

  date_long(dt: any) {
    const lang = this.$$lang
    // console.log(lang, dt)
    const fmt = long_dates[lang] = long_dates[lang] ?? Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric' })
    return fmt.format(new Date(dt))
  }

  iif(cond: boolean, then: any, otherwise: any = null) {
    return cond ? then : otherwise
  }

  iflang(...args: any[]): any {
    // There is a default value
    let with_def = false
    if (args.length % 2 === 1) {
      with_def = true
    }
    for (let i = with_def ? 1 : 0, l = args.length; i < l; i += 2) {
      if (args[i] === this.$$lang) {
        return args[i + 1]
      }
    }
    if (with_def)
      return args[0]
    return `NO VALUE FOR LANG '${this.$$lang}'`
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

  lookup_file(fname: string): FilePath {
    var src = this[sym_source]
    let p = fname[0] === '@' ? this.$$path_target : this.$$path_this
    let res = p.lookup(fname, src.site.path)
    if (!res) throw new Error(`could not find '${fname}'`)
    return res
  }

  /**
   * Get a static file and add its path to the output.
   * Static files are looked relative to the current page, or if fname starts with '@/' relative to the current *page*.
   * Their output is the same file in the output directory of $$path_this / page_path, always relative to the ASSET ROOT, which is generally the same as the OUT ROOT.
   *
   */
  static_file(fname: string, outpath?: string) {
    let look = this.lookup_file(fname)
    // console.log(this.$$assets_url, this.$$assets_out_dir)
    let url = pth.join(this.$$assets_url, look.filename)
    let copy_path = pth.join(this.$$assets_out_dir, look.filename)

    this.$$site.jobs.set(copy_path, () => {
      copy_file(look!.absolute_path, copy_path)
    })

    return url
  }

  /** Transform an image. Uses sharp. */
  image(fname: string, opts?: { transform?: any[], output?: string }) { }

  css(fname: string) {
    let look = this.lookup_file(fname)

    let url = pth.join(this.$$assets_url, fname)
    let copy_path = pth.join(this.$$assets_out_dir, fname)
    let to_copy = new Map<string, string>()
    to_copy.set(look.absolute_path, copy_path)

    // Do not retry to process the file if it is already in a job.
    if (this.$$site.jobs.has(copy_path)) return url

    for (let [orig, dest] of to_copy) {
      if (pth.extname(orig) !== '.css') continue
      const src_file = fs.readFileSync(orig, 'utf-8')
      const re_imports = /@import ("[^"?]+"|'[^'?]+')|url\(("[^"?]+"|'[^'?]+'|[^'"?\)]+)\)/g
      let match: RegExpMatchArray | null = null
      while ((match = re_imports.exec(src_file))) {
        var referenced = (match[1] ?? match[2])//.slice(1, -1)
        if (referenced[0] === '"' || referenced[0] === "'") referenced = referenced.slice(1, -1)
        let path_to_add = pth.join(pth.dirname(orig), referenced)
        let copy_to_add = pth.join(pth.dirname(dest), referenced)
        to_copy.set(path_to_add, copy_to_add)
      }
    }

    this.$$site.jobs.set(copy_path, () => {
      for (let [orig, copy] of to_copy.entries()) {
        copy_file(orig, copy)
      }
    })

    return url
  }

  /** */
  sass(fname: string) {
    // sass.renderSync()
    let look = this.lookup_file(fname)

    let dest_fname = look.filename.replace(/\.s[ac]ss$/, '.css')
    let url = pth.join(this.$$assets_url, dest_fname)
    let copy_path = pth.join(this.$$assets_out_dir, dest_fname)

    let st = fs.existsSync(copy_path) ? fs.statSync(copy_path) : null
    if (this.$$site.jobs.has(copy_path) || st?.mtimeMs! >= look.stats.mtimeMs) return url

    this.$$site.jobs.set(copy_path, () => {
      let r = sass.renderSync({file: look.absolute_path, outFile: copy_path})
      let dir = pth.dirname(copy_path)
      sh.mkdir('-p', dir)
      fs.writeFileSync(copy_path, r.css)
      // FIXME : add a dependency to the included files !
      console.log(` ${c.magenta(c.bold('>'))} ${copy_path} ${c.green(r.stats.duration.toString())}ms`)

      const re_imports = /@import ("[^"?]+"|'[^'?]+')|url\(("[^"?]+"|'[^'?]+'|[^'"?\)]+)\)/g
      let match: RegExpMatchArray | null = null
      let css = r.css.toString('utf-8')
      while ((match = re_imports.exec(css))) {
        var referenced = (match[1] ?? match[2])//.slice(1, -1)
        if (referenced[0] === '"' || referenced[0] === "'") referenced = referenced.slice(1, -1)
        let path_to_add = pth.join(look.absolute_dir, referenced)
        let copy_to_add = pth.join(pth.dirname(copy_path), referenced)
        copy_file(path_to_add, copy_to_add)
      }
    })
  }

  /** Read a file's content and outputs it as is */
  file_contents(fname: string) {
    let look = this.lookup_file(fname)
    return fs.readFileSync(look.absolute_path, 'utf-8')
  }

  /** get a page */
  import(fname: string, opts?: {genname?: string, key?: string}) {
    let look = this.lookup_file(fname)
    const imp = this.$$site.get_page_source(look)
    if (!imp) throw new Error(`could not find page '${fname}'`)
    const gen = opts?.genname ?? this.$$generation_name
    if (!this.$$site.generations.has(gen)) throw new Error(`no generation named '${gen}'`)
    return imp.get_page(this.$$site.generations.get(gen)!)
  }

  /** Get a json from self */
  get_json(fname: string): any { }

  /** Get a yaml from self */
  get_yaml(fname: string): any { }

  /** Get a toml from self */
  get_toml(fname: string): any { }

  /** Query an SQlite database from self */
  query(fname: string, query: string): any { }
}
