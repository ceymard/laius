import fs from 'fs'
import pth from 'path'
import c from 'colors'
import { Remarkable } from 'remarkable'
import sass from 'sass'
import sh from 'shelljs'
import util from 'util'

import { FilePath } from './path'
import { copy_file, init_timer } from './helpers'
import type { Site, Generation } from './site'
import { Parser, BlockFn, BlockCreatorFn, InitFn } from './parser'
import sharp from 'sharp'

export type Blocks = {[name: string]: BlockFn}
export type PostprocessFn = (str: string) => string

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
  self_init?: InitFn
  self_postinit?: InitFn
  self_block_creator!: BlockCreatorFn

  // the same with the directories
  repeat_fn?: InitFn
  init_fn!: InitFn
  postinit_fn!: InitFn
  block_fn!: BlockCreatorFn
  has_errors = false


  kls!: typeof Page

  /**
   * Get all init functions recursively.
   * Look into the cache first -- should we stat all the time ?
   */
  get_dirs(): PageSource[] {
    let components = this.path.filename.split(pth.sep).slice(1) // remove the leading '/'
    let l = components.length - 1
    // for a file named /dir1/dir2/thefile.tpl we will lookup
    // first ../../__dir__.tpl  ../__dir__.tpl and __dir__.tpl
    return components.map((_, i) => {
      let look = pth.join('../'.repeat(l - i), '__dir__.tpl')
      return this.path.lookup(look, [])
    })
      .filter(c => c != null)
      .map(p => {
        this.site.addDep(this.path.absolute_path, p!.absolute_path)
        return this.site.get_page_source(p!)
      })
  }

  parse() {
    var src = fs.readFileSync(this.path.absolute_path, 'utf-8')
    const parser = new Parser(src)

    parser.parse()

    this.has_errors = parser.errors.length > 0
    if (parser.errors.length > 0) {
      for (let e of parser.errors) {
        this.path.error({}, e.message)
      }
      return
    }

    this.self_init = parser.init_emitter.toSingleFunction(this.path)
    this.self_postinit = parser.postinit_emitter.toSingleFunction(this.path)
    this.repeat_fn = parser.repeat_emitter.toSingleFunction(this.path)

    let post: null | PostprocessFn = null // FIXME this is where we say we will do some markdown
    if (this.path.extension === 'md') {
      const md = new Remarkable('full', { html: true })
      post = (str: string): string => {
        return md.render(str)
      }
    }
    this.self_block_creator = parser.getCreatorFunction(this.path, post)
    //parser.getCreatorFunction(this.path)

    let all_inits: InitFn[] = []
    let all_creators: BlockCreatorFn[] = []
    let all_postinits: InitFn[] = []
    if (!this.path.isDirFile()) {
      // get_dirs gives the parent directory pages ordered by furthest parent first.
      const dirs = this.get_dirs()
      for (const d of dirs) {
        if (d.has_errors) this.has_errors = true
        if (d.self_init) all_inits.push(d.self_init)
        if (d.self_postinit) all_postinits.unshift(d.self_postinit)
        all_creators.push(d.self_block_creator)
      }
    }
    if (this.self_init) all_inits.push(this.self_init)
    if (this.self_postinit) all_postinits.unshift(this.self_postinit)
    all_creators.push(this.self_block_creator)

    //////////// Now create the class

    class PageInstance extends Page {

      constructor(
        public $$source: PageSource,
        public $$params: Generation,
      ) {
        super($$source, $$params)
        this.$$__init__()
      }

      $$__init__() {
        for (let i of all_inits) {
          i.call(this)
        }
        for (let i of all_postinits) {
          i.call(this)
        }
      }

    }

    for (let c of all_creators) {
      c(PageInstance.prototype)
    }

    this.kls = PageInstance
  }

  cached_pages = new Map<string, Page>()

  get_page(gen: Generation, key?: any) {
    let page = this.cached_pages.get(gen.generation_name)
    if (page) return page

    let repeat = this.repeat_fn
    let ro_gen = read_only_proxy(gen)
    if (repeat) {
      let p = new Page(this, ro_gen)
      p.$$repetitions = new Map()
      let res = repeat.call(p)

      let prev: Page | undefined
      for (let [k, v] of (typeof res === 'object' ? Object.entries(res) : res.entries())) {
        let inst = new this.kls(this, ro_gen)
        inst.iter = v
        inst.iter_key = k
        inst.iter_prev_page = prev
        if (prev) prev.iter_next_page = inst
        prev = inst
        p.$$repetitions.set(k, inst)
        // inst.$$generate_single()
      }

      page = p
    } else {
      page = new this.kls(this, ro_gen)
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

const long_dates: {[lang: string]: Intl.DateTimeFormat} = {}


export class Page {

  constructor(
    public $$source: PageSource,
    public $$params: Generation,
  ) {
  }

  $$site = this.$$source.site
  $$line!: number
  $$path = this.$$source.path
  $$path_current = this.$$source.path
  $out_dir = this.$$path.local_dir
  $base_slug = this.$$path.basename.replace(/\..*$/, '')

  $slug = this.$base_slug // set by PageSource
  $$lang = this.$$params.lang
  $$__init__() { }

  ;

  // Stuff that needs to be defined by the Page source
  $$source!: PageSource
  $$repetitions?: Map<any, Page>

  /** The blocks. Given generally once the value of $template is known. */
  ;

  Map = Map
  Set = Set

  $markdown_options?: any = undefined

  $__page?: Page
  get page() {
    return this.$__page
  }
  set page(p: Page | undefined) {
    this.$__page = p
    let par = this.$parent
    if (par) {
      par.page = p
    }
  }

  iter?: any = undefined
  iter_key?: any = undefined
  iter_prev_page?: Page = undefined
  iter_next_page?: Page = undefined

  // Repeating stuff !
  $__parent?: Page
  get $parent() { return this.$__parent }
  set $parent(p: Page | undefined) {
    if (p){
      p.page = this
      this.$__parent = p
    }
  }

  $$path_current!: FilePath
  $out_full_name?: string

  get $output_name() {
    let outname = this.$slug + (this.iter_key ? '-' + this.iter_key : '') + '.html'
    return outname
  }

  get $url() {
    if (this.$out_full_name)
      return pth.join(this.$$params.base_url, this.$out_full_name)
    return pth.join(this.$$params.base_url, this.$out_dir, this.$output_name)
  }

  get $final_output_path() {
    if (this.$out_full_name)
      return pth.join(this.$$params.out_dir, this.$out_full_name)
    return pth.join(this.$$params.out_dir, this.$out_dir, this.$output_name)
  }

  $$render(): string {
    if (this.$__parent) {
      return this.$__parent.$$render()
    }
    let self = this as any
    return self[`β__main__`]()
  }

  $$generate_single() {
    try {
      let tim = init_timer()
      // console.log(this.$final_output_path)
      // Now we can get the file and put it in its output !
      let out = this.$final_output_path
      sh.mkdir('-p', pth.dirname(out))
      fs.writeFileSync(out, this.$$render(), { encoding: 'utf-8' })
      this.$$path.info(this.$$params, '->', c.green(this.$output_name), tim())
      this.$$site.urls.add(this.$url)
    } catch (e) {
      this.$$path.error(this.$$params, c.grey(e.message))
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

  $$log(...a: any[]) {
    let more = ''
    if (this.$$path.filename !== this.$$path_current.filename) more = c.grey(`(in ${this.$$path_current.filename})`)
    this.$$path.log(this.$$params, more, ...a)
  }

  $$warn(...a: any[]) {
    let more = ''
    if (this.$$path.filename !== this.$$path_current.filename) more = c.grey(`(in ${this.$$path_current.filename})`)
    this.$$path.warn(this.$$params, more, ...a)
  }

  $$error(...a: any[]) {
    let more = ''
    if (this.$$path.filename !== this.$$path_current.filename) more = c.grey(`(in ${this.$$path_current.filename})`)
    this.$$path.error(this.$$params, more, ...a)
  }

  /**
   * The omega function is in charge of error reporting
   */
  ω(arg: any): string {
    if (typeof arg === 'function') {
      try {
        arg = arg()
      } catch (e) {
        let pth = this.$$path_current.filename
        console.log(` ${c.red('!')} ${c.gray(pth)} ${c.green('' + (this.$$line + 1))}: ${c.gray(e.message)}`)
        arg = `<span class='laius-error'>${pth} ${this.$$line + 1} ${e.message}</span>`
      }
    }
    return (arg ?? '').toString()
  }

  has_block(name: string): boolean {
    if (this.page) {
      if (this.page.has_block(name))
        return true
    }
    let self = this as any
    return !!self[`β${name}`]
  }

  /**
   * Get a block by its name
   */
  get_block(name: string): string | null {
    if (this.page) {
      let r = this.page.get_block(name)
      if (r != null) return r
    }
    let self = this as any
    let bname = `β${name}`
    return self[bname]?.()
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
    let p = fname[0] === '@' ? this.$$path : this.$$path_current
    let res = p.lookup(fname, this.$$source.site.path)
    if (!res) throw new Error(`could not find '${fname}'`)
    this.$$site.addDep(p.absolute_path, res.absolute_path)
    return res
  }

  /**
   * Get a static file and add its path to the output.
   * Static files are looked relative to the current page, or if fname starts with '@/' relative to the current *page*.
   * Their output is the same file in the output directory of $$path_current / page_path, always relative to the ASSET ROOT, which is generally the same as the OUT ROOT.
   *
   */
  static_file(fname: string, outpath?: string) {
    let look = this.lookup_file(fname)
    // console.log(this.$$assets_url, this.$$assets_out_dir)
    let url = pth.join(this.$$params.assets_url, look.filename)
    let copy_path = pth.join(this.$$params.assets_out_dir, look.filename)

    this.$$site.jobs.set(copy_path, () => {
      copy_file(look!.absolute_path, copy_path)
    })

    return url
  }

  /** Transform an image. Uses sharp. */
  image(fname: string, opts?: { transform?: any[], output?: string }) { }

  css(fname: string) {
    let look = this.lookup_file(fname)

    let url = pth.join(this.$$params.assets_url, fname)
    let copy_path = pth.join(this.$$params.assets_out_dir, fname)
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
    let url = pth.join(this.$$params.assets_url, dest_fname)
    let copy_path = pth.join(this.$$params.assets_out_dir, dest_fname)

    let st = fs.existsSync(copy_path) ? fs.statSync(copy_path) : null
    if (this.$$site.jobs.has(copy_path) || st?.mtimeMs! >= look.stats.mtimeMs) return url

    this.$$site.jobs.set(copy_path, () => {
      let r = sass.renderSync({file: look.absolute_path, outFile: copy_path})
      let dir = pth.dirname(copy_path)
      sh.mkdir('-p', dir)
      fs.writeFileSync(copy_path, r.css)
      // FIXME : add a dependency to the included files !
      for (let dep of r.stats.includedFiles) {
        console.log(look.absolute_path, dep)
        this.$$site.addDep(this.$$path_current.absolute_path, dep)
      }
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
  get_page(fname: string, opts?: {genname?: string, key?: any}) {
    let look = this.lookup_file(fname)
    const imp = this.$$site.get_page_source(look)
    if (!imp) throw new Error(`could not find page '${fname}'`)
    const gen = opts?.genname ?? this.$$params.generation_name
    if (!this.$$site.generations.has(gen)) throw new Error(`no generation named '${gen}'`)
    return imp.get_page(this.$$site.generations.get(gen)!, opts?.key)
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
