import fs from 'fs'
import pth from 'path'
import c from 'colors'
import util from 'util'
import sh from 'shelljs'
import { I } from './optimports'

import { FilePath } from './path'
import { init_timer } from './helpers'
import type { Site, Generation } from './site'
import { Parser, BlockFn, BlockCreatorFn, InitFn, } from './parser'

const cache_bust = '?'+ (+new Date).toString(16).slice(0, 6)

export type Blocks = {[name: string]: BlockFn}
export type PostprocessFn = (str: string) => string

const roerror = function () { throw new Error(`object is read-only`) }
const read_only_target: ProxyHandler<any> = {
  get(target, prop) {
    var targeted = target[prop]
    return targeted //targeted != null ? read_only_proxy(target[prop]) : targeted
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

  [util.inspect.custom]() {
    return `<PageSource:${this.path.absolute_path}>`
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

    parser.parse()

    this.has_errors = parser.errors.length > 0
    if (parser.errors.length > 0) {
      for (let e of parser.errors) {
        this.path.error({}, e.range.start.line+1, e.message)
      }
      // console.log(parser.blocks)
      return
    }

    this.self_init = parser.init_emitter.toSingleFunction(this.path)
    this.self_postinit = parser.postinit_emitter.toSingleFunction(this.path)
    this.repeat_fn = parser.repeat_emitter.toSingleFunction(this.path)

    this.self_block_creator = parser.getCreatorFunction()
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

    this.init_fn = function (this: Page) {
      for (let i of all_inits) {
        i.call(this)
      }
      for (let i of all_postinits) {
        i.call(this)
      }
    }

    class PageInstance extends Page {

      constructor(
        public $$source: PageSource,
        public $$params: Generation,
      ) {
        super($$source, $$params)
      }

    }

    for (let c of all_creators) {
      c(PageInstance.prototype)
    }

    this.kls = PageInstance
  }

  cached_pages = new Map<string, Page>()

  get_page(gen: Generation) {
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

    let repeat = this.repeat_fn
    let ro_gen = read_only_proxy(gen)
    if (repeat) {
      let p = new Page(this, ro_gen)
      p.$$repetitions = new Map()
      let res = repeat.call(p)

      let prev: Page | undefined
      let prev_iter: any
      let prev_iter_key: any
      for (let [k, v] of (typeof res === 'object' ? Object.entries(res) : res.entries())) {
        let inst = new this.kls(this, ro_gen)
        if (post && typeof inst.$postprocess === 'undefined') inst.$postprocess = post
        inst.iter = v
        inst.iter_prev = prev_iter
        inst.iter_prev_key = prev_iter_key

        inst.iter_key = k
        inst.iter_prev_page = prev
        if (prev) {
          prev.iter_next_page = inst
          prev.iter_next = v
          prev.iter_next_key = k
        }
        prev = inst
        prev_iter = v
        p.$$repetitions.set(k, inst)
        // inst.$$generate_single()
      }
      for (let pg of p.$$repetitions.values()) {
        this.init_fn.call(pg)
      }

      page = p
    } else {
      // console.log(this.path, this.kls)
      page = new this.kls(this, ro_gen)
      if (post && typeof page.$postprocess === 'undefined') page.$postprocess = post
      this.init_fn.call(page)
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
export const render_in_page = Symbol('render_in_page')

export class Page {

  constructor(
    public $$source: PageSource,
    public $$params: Generation,
  ) {
  }

  $$current_block?: string
  $$site = this.$$source.site
  $$line!: number
  path = this.$$source.path
  __path_current?: FilePath
  $$lang = this.$$params.lang
  // Stuff that needs to be defined by the Page source
  $$repetitions?: Map<any, Page>

  get current_path() {
    return this.__path_current ?? this.path
  }

  get page_path(): FilePath {
    if (this.page)
      return this.page.page_path
    return this.current_path
  }

  // Repeating stuff !
  $markdown_options?: any
  $postprocess?: PostprocessFn
  $parent?: Page
  $out_full_name?: string
  $out_dir = this.path.local_dir
  $base_slug = this.path.basename.replace(/\..*$/, '')
  $slug = this.$base_slug // set by PageSource
  $skip = false

  page?: Page
  iter?: any
  iter_key?: any
  iter_next?: any
  iter_prev?: any
  iter_prev_key?: any
  iter_next_key?: any
  iter_prev_page?: Page
  iter_next_page?: Page

  get $output_name() {
    let outname = this.$slug + (this.iter_key && this.$slug === this.$base_slug ? '-' + this.iter_key : '') + '.html'
    return outname
  }

  get url(): string {
    if (this.$skip) {
      this.$$warn(`requested url of a page that is skipped`)
    }
    if (this.page) return this.page.url
    let res: string
    if (this.$out_full_name)
      res = pth.join(this.$$params.base_url, this.$out_full_name) + cache_bust
    else
      res = pth.join(this.$$params.base_url, this.$out_dir, this.$output_name) + cache_bust
    return res// .replace(/\.html(?=\?)?/, '')
  }

  get $final_output_path() {
    if (this.$out_full_name)
      return pth.join(this.$$params.out_dir, this.$out_full_name)
    return pth.join(this.$$params.out_dir, this.$out_dir, this.$output_name)
  }

  $$render(): string {
    if (this.$parent) {
      this.$parent.page = this.page ?? this
      return this.$parent.$$render()
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
      // console.log(out)
      this.path.info(this.$$params, '->', c.green(this.$output_name), tim())
      this.$$site.urls.add(this.url)
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

  $$log(...a: any[]) {
    let more = ''
    if (this.path.filename !== this.current_path.filename) more = c.grey(`(in ${this.current_path.filename})`)
    this.path.log(this.$$params, this.$$line, more, ...a)
  }

  $$warn(...a: any[]) {
    let more = ''
    if (this.path.filename !== this.current_path.filename) more = c.grey(`(in ${this.current_path.filename})`)
    this.path.warn(this.$$params, this.$$line, more, ...a)
  }

  $$error(...a: any[]) {
    let more = ''
    if (this.path.filename !== this.current_path.filename) more = c.grey(`(in ${this.current_path.filename})`)
    this.path.error(this.$$params, this.$$line, more, ...a)
  }

  /**
   * The omega function is in charge of error reporting
   */
  ω(arg: any): string {
    if (typeof arg === 'function') {
      try {
        arg = arg()
      } catch (e) {
        let pth = this.current_path.filename
        console.log(` ${c.red('!')} ${c.gray(pth)} ${c.green('' + (this.$$line + 1))}: ${c.gray(e.message)}`)
        if (process.env.DEBUG) {
          console.log(c.grey(e.stack))
          console.log(c.grey(arg.toString()))
        }
        arg = `<span class='laius-error'>${pth} ${this.$$line + 1} ${e.message}</span>`
      }
    }
    let r = arg ?? ''
    if (r[render_in_page]) return r[render_in_page]()
    if (Array.isArray(arg)) return arg.map(a => this.ω(a)).join('')
    return r.toString()
  }

  has_block(name: string): boolean {
    if (this.page) {
      if (this.page.has_block(name))
        return true
    }
    let self = this as any
    return !!self[`β${name}`]
  }

  __call_block(name: string, data?: any) {
    let self = this as any
    let backup = {} as any
    if (data) {
      for (let x in data) {
        if (x in self) {
          backup[x] = self[x]
          self[x] = data[x]
        }
      }
    }
    let res = self[name]()
    if (data) {
      for (let x in data) {
        self[x] = backup[x]
      }
    }
    return res
  }

  get_parent_block(data?: any): string | null {
    let bname = this.$$current_block
    if (!bname || !this.$parent) return null
    let iter: any = this.$parent
    do {
      if (iter[bname])
        return iter.__call_block(bname, data)
      iter = iter.$parent
    } while (iter)
    return null
  }

  /**
   * Get a block by its name
   */
  get_block(name: string, data?: any): string | null {
    let bname = `β${name}`
    let pg: Page | undefined = this
    while (pg.page) { pg = pg.page }
    do {
      let _pg: any = pg
      if (_pg[bname]) return _pg.__call_block(bname, data)
      pg = pg.$parent
    } while (pg)
    return null
  }

  datetime_numeric(dt: any) {

  }

  datetime_long(dt: any) {

  }

  date_numeric(dt: any) {

  }

  order_by<T>(val: T[], ...args: (keyof T | ((a: T) => any))[]) {
    let mods: (1 | -1)[] = []
    args = args.map(a => {
      if (typeof a === 'string' && a[0] === '-') {
        mods.push(-1)
        return a.slice(1) as any
      }
      mods.push(1)
      return a
    })
    let len = args.length
    let order_fn = (a: T, b: T) => {
      for (var i = 0; i < len; i++) {
        let arg = args[i]
        let mod = mods[i]
        let va = typeof arg === 'string' ? a[arg] : (arg as any)(a)
        let vb = typeof arg === 'string' ? b[arg] : (arg as any)(b)
        if (va < vb) return -1 * mod
        if (va > vb) return 1 * mod
      }
      return 0
    }
    return val.slice().sort(order_fn)
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
    return (val??'').toString().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
      .replace(/[\s']+/g, '-') // Replace spaces with -
      .replace(/[^\w\-]+/g, '') // Remove all non-word characters
      .replace(/\-\-+/g, '-') // Replace multiple - with single -
      .replace(/^-+/, '') // Trim - from start of text
      .replace(/-+$/, '') // Trim - from end of text
  }

  date_long(dt: any) {
    const lang = this.$$lang
    // console.log(lang, dt)
    const fmt = long_dates[lang] = long_dates[lang] ?? Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric' })
    return fmt.format(new Date(dt))
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

  typographic_nbsp(value: string): string {
    if (typeof (value as any) !== 'string') value = (value ?? '').toString()
    return value
      .replace(/\s*\?/g, '&nbsp;?')
      .replace(/\s*\!/g, '&nbsp;!')
      .replace(/\s*\:\s*/g, '&nbsp: ')
      .replace(/«\s*/g, '«&nbsp;')
      .replace(/\s*»/g, '&nbsp;»')
      .replace(/\s*–\s*/g, '&nbsp;–&nbsp;')
  }

  /** Pass a string through some markdown */
  markdown(value: string) {
    return I.md.render(value)
  }


  /////////////////////////////////////////////////////////////////////////////////////////////////////

  lookup(...fnames: (string | FilePath)[]): FilePath | null {
    for (let f of fnames) {
      if (f instanceof FilePath) return f
      if (f === '@') return this.page_path
      if (f === ".") return this.current_path
      // Should change the logic of path_current to the whole child thing...
      let p = f.startsWith('@/') ? this.page_path : this.current_path
      f = f.replace(/^@\/?/, '')
        .replace(/%%/g, p.basename)
        .replace(/%/g, p.noext_basename)
      let res = p.lookup(f)
      if (res != null) return res
    }
    return null
  }

  lookup_file(...fnames: (string | FilePath)[]): FilePath {
    let res = this.lookup(...fnames)
    if (!res) throw new Error(`could not find file for '${fnames.join(', ')}'`)
    this.$$site.addDep(this.current_path.absolute_path, res.absolute_path)
    return res
  }

  /**
   * Get a static file and add its path to the output.
   * Static files are looked relative to the current page, or if fname starts with '@/' relative to the current *page*.
   * Their output is the same file in the output directory of $$path_current / page_path, always relative to the ASSET ROOT, which is generally the same as the OUT ROOT.
   *
   */
  static_file(fname: string | FilePath, outpath?: string) {
    let look = fname instanceof FilePath ? fname : this.lookup_file(fname)
    return this.$$params.copy_file(this.current_path, look, outpath ?? look.filename)
  }

  /** Transform an image. Uses sharp. */
  image(fname: string, opts?: { transform?: any[], output?: string }) {

  }

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

    let curpath = this.current_path
    this.$$site.jobs.set(copy_path, () => {
      for (let [orig, copy] of to_copy.entries()) {
        let or = this.lookup(orig)
        if (!or) continue
        this.$$params.copy_file(curpath, or, copy)
        // copy_file(orig, copy)
      }
    })

    return url + cache_bust
  }

  /** */
  sass(fname: string) {
    // sass.renderSync()
    let look = this.lookup_file(fname)

    let curpath = this.current_path
    let dest_fname = look.filename.replace(/\.s[ac]ss$/, '.css')
    return this.$$params.process_file(curpath, look, dest_fname, outfile => {
      let r = I.sass.renderSync({file: look.absolute_path, outFile: outfile})
      fs.writeFileSync(outfile, r.css)
      // FIXME : add a dependency to the included files !
      for (let dep of r.stats.includedFiles) {
        // console.log(look.absolute_path, dep)
        this.$$site.addDep(this.current_path.absolute_path, dep)
      }
      console.log(` ${c.magenta(c.bold('>'))} ${outfile} ${c.green(r.stats.duration.toString())}ms`)

      const re_imports = /@import ("[^"?]+"|'[^'?]+')|url\(("[^"?]+"|'[^'?]+'|[^'"?\)]+)\)/g
      let match: RegExpMatchArray | null = null
      let css = r.css.toString('utf-8')
      while ((match = re_imports.exec(css))) {
        var referenced = (match[1] ?? match[2])//.slice(1, -1)
        if (referenced[0] === '"' || referenced[0] === "'") referenced = referenced.slice(1, -1)
        let path_to_add = pth.join(look.absolute_dir, referenced)
        let copy_to_add = pth.join(pth.dirname(dest_fname), referenced)
        this.$$params.compy_file(curpath, path_to_add, copy_to_add)
      }
    })
  }

  /** Read a file's content and outputs it as is */
  file_contents(fname: string) {
    let look = this.lookup_file(fname)
    return fs.readFileSync(look.absolute_path, 'utf-8')
  }

  get_files(name: string): FilePath[] {
    let re = new RegExp(name)

    let files = this.$$site.listFiles(this.current_path.root, this.current_path.local_dir)
    files = files.filter(f => re.test(f.filename))

    return files
  }

  /**
   * Get pages matching a path. Unlike get_page, get_pages only performs path searches
   * relative to the current page.
   */
  get_pages(name: string | RegExp, gen_key?: string): Page[] {
    let matcher = name instanceof RegExp ? name : new RegExp(name)
    let gen = gen_key != null ? this.$$site.generations.get(gen_key) : this.$$params
    if (gen == null) throw new Error(`no such generation name '${gen_key}'`)

    let files = this.$$site.listFiles(this.current_path.root, this.current_path.local_dir)
      .filter(f => matcher.test(f.filename))
      .map(f => this.$$site.get_page_source(this.current_path, f).get_page(gen!))

    return files
  }

  link(fpath: string, key?: string) {
    let p = this.get_page(fpath)
    if (p.$$repetitions) {
      if (key != null) {
        return p.$$repetitions.get(key)!.url
      }
      let it = p.$$repetitions.values().next()
      let pg = it.value as Page
      return pg.url
    }
    return p.url
  }

  get_current_page_in(genname: string) {
    let dest_pg = this.page ?? this
    let src = dest_pg.$$source
    let gen = src.site.generations.get(genname)
    if (!gen) throw new Error(`no generation named '${genname}'`)
    let pg = src.get_page(gen)
    if (!pg.$$repetitions) return pg
    return pg.$$repetitions?.get(dest_pg.iter_key)
  }

  /** get a page */
  get_page(fname: string, opts?: {genname?: string, key?: any}): Page {
    let look = this.lookup_file(fname)
    const imp = this.$$site.get_page_source(this.current_path, look)
    if (!imp) throw new Error(`could not find page '${fname}'`)
    const gen = opts?.genname ?? this.$$params.generation_name
    if (!this.$$site.generations.has(gen)) throw new Error(`no generation named '${gen}'`)
    let pg = imp.get_page(this.$$site.generations.get(gen)!)
    let key = opts?.key
    if (key != null) {
      let r = pg.$$repetitions?.get(key)
      if (!r) throw new Error(`no page for key ${key}`)
      return r
    }
    return pg
  }

  get_this_page_in(genname: string) {
    let self: Page = this
    while (self.page) { self = self.page }

    let iter_key = self.iter_key
    let gen = self.$$site.generations.get(genname)
    if (!gen) throw new Error(`no generation named '${genname}'`)
    let pg = self.$$source.get_page(gen)
    if (iter_key != null) return pg.$$repetitions?.get(iter_key)
    return pg
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

let proto = Page.prototype as any
proto.Map = Map
proto.Set = Set


export function register_page_plugin(name: string, plugin: (this: Page, ...args: any[]) => any) {
  proto[name] = plugin
}