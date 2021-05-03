import * as pth from 'path'
import * as fs from 'fs'

import c from 'colors'

import { Generation, Site } from './site'
import type { Page } from './page'
import { FilePath } from './path'
import { I } from './optimports'

export const cache_bust = '?'+ (+new Date).toString(16).slice(0, 6)

const long_dates: {[lang: string]: Intl.DateTimeFormat} = {}

export class Env {

  static register<Args extends any[], Res>(name: string, fn: (this: Env, ...args: Args) => Res): (...a: Args) => Res
  static register<Args extends any[], Res>(fn: (this: Env, ...args: Args) => Res): (...a: Args) => Res
  static register<Args extends any[], Res>(name: any, fn?: any): (...a: Args) => Res {
    (Env.prototype as any)[typeof name === 'function' ? name.name : name] = typeof name === 'string' ? fn : name
    return fn as any
  }

  static names() {
    return Object.getOwnPropertyNames(Env.prototype).filter(p => p !== 'constructor')
  }

  constructor (
    public filepath: FilePath,
    public page: Page,
    public generation: Generation,
    public site: Site,
  ) {
    page.env = this
  }
  line = 0

  __current!: Page
  __lang = this.generation.lang
  __iter: any
  __iter_key: any
  __iter_next: any
  __iter_prev: any
  __iter_prev_key: any
  __iter_next_key: any
  __iter_prev_page: any
  __iter_next_page: any


  $$log(...a: any[]) {
    let more = ''
    if (this.filepath.filename !== this.page.path.filename) more = c.grey(`(in ${this.filepath.filename})`)
    this.filepath.log(this.generation, this.line, more, ...a)
  }

  $$warn(...a: any[]) {
    let more = ''
    if (this.filepath.filename !== this.page.path.filename) more = c.grey(`(in ${this.filepath.filename})`)
    this.filepath.warn(this.generation, this.line, more, ...a)
  }

  $$error(...a: any[]) {
    let more = ''
    if (this.filepath.filename !== this.page.path.filename) more = c.grey(`(in ${this.filepath.filename})`)
    this.filepath.error(this.generation, this.line, more, ...a)
  }


  lookup(...fnames: (string | FilePath)[]): FilePath | null {
    for (let f of fnames) {
      if (f instanceof FilePath) return f
      if (f === '@') return this.page.path
      if (f === ".") return this.filepath
      // Should change the logic of path_current to the whole child thing...
      let p = f.startsWith('@/') ? this.page.path : this.filepath
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
    this.site.addDep(this.filepath.absolute_path, res.absolute_path)
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
    return this.generation.copy_file(this.filepath, look, outpath ?? look.filename)
  }

  css(fname: string) {
    let look = this.lookup_file(fname)

    let url = pth.join(this.generation.assets_url, fname)
    let copy_path = pth.join(this.generation.assets_out_dir, fname)
    let to_copy = new Map<string, string>()
    to_copy.set(look.absolute_path, copy_path)

    // Do not retry to process the file if it is already in a job.
    if (this.site.jobs.has(copy_path)) return url

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

    let curpath = this.filepath
    this.site.jobs.set(copy_path, () => {
      for (let [orig, copy] of to_copy.entries()) {
        let or = this.lookup(orig)
        if (!or) continue
        this.generation.copy_file(curpath, or, copy)
        // copy_file(orig, copy)
      }
    })

    return url + cache_bust
  }

  /** */
  sass(fname: string) {
    // sass.renderSync()
    let look = this.lookup_file(fname)

    let curpath = this.filepath
    let dest_fname = look.filename.replace(/\.s[ac]ss$/, '.css')
    return this.generation.process_file(curpath, look, dest_fname, outfile => {
      let r = I.sass.renderSync({file: look.absolute_path, outFile: outfile})
      fs.writeFileSync(outfile, r.css)
      // FIXME : add a dependency to the included files !
      for (let dep of r.stats.includedFiles) {
        // console.log(look.absolute_path, dep)
        this.site.addDep(this.filepath.absolute_path, dep)
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
        this.generation.copy_file(curpath, path_to_add, copy_to_add)
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

    let files = this.site.listFiles(this.filepath.root, this.filepath.local_dir)
    files = files.filter(f => re.test(f.filename))

    return files
  }

  /**
   * Get pages matching a path. Unlike get_page, get_pages only performs path searches
   * relative to the current page.
   */
  get_pages(name: string | RegExp, gen_key?: string): Page[] {
    let matcher = name instanceof RegExp ? name : new RegExp(name)
    let gen = gen_key != null ? this.site.generations.get(gen_key) : this.generation
    if (gen == null) throw new Error(`no such generation name '${gen_key}'`)

    let files = this.site.listFiles(this.filepath.root, this.filepath.local_dir)
      .filter(f => matcher.test(f.filename))
      .map(f => this.site.get_page_source(this.filepath, f).get_page(gen!))

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
    // if (p.$skip) return undefined
    return p.url
  }

  get_current_page_in(genname: string) {
    let dest_pg = this.__current
    let src = dest_pg.$$source
    let gen = src.site.generations.get(genname)
    if (!gen) throw new Error(`no generation named '${genname}'`)
    let pg = src.get_page(gen)
    if (!pg.$$repetitions) return pg
    return pg.$$repetitions?.get(dest_pg.env.__iter_key)
  }

  /** get a page */
  get_page(fname: string, opts?: {genname?: string, key?: any}): Page {
    let look = this.lookup_file(fname)
    const imp = this.site.get_page_source(this.filepath, look)
    if (!imp) throw new Error(`could not find page '${fname}'`)
    const gen = opts?.genname ?? this.generation.generation_name
    if (!this.site.generations.has(gen)) throw new Error(`no generation named '${gen}'`)
    let pg = imp.get_page(this.site.generations.get(gen)!)
    let key = opts?.key
    if (key != null) {
      let r = pg.$$repetitions?.get(key)
      if (!r) throw new Error(`no page for key ${key}`)
      return r
    }
    return pg
  }

  get_this_page_in(genname: string) {
    let self: Page = this.__current

    let iter_key = self.env.__iter_key
    let gen = self.env.site.generations.get(genname)
    if (!gen) throw new Error(`no generation named '${genname}'`)
    let pg = self.$$source.get_page(gen)
    if (iter_key != null) return pg.$$repetitions?.get(iter_key)
    return pg
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
    return (val ?? '').toString().toLocaleUpperCase(this.__lang)
  }

  lower(val: string) {
    return (val ?? '').toString().toLocaleLowerCase(this.__lang)
  }

  capitalize(val: string) {
    var str = (val ?? '').toString()
    if (str.length === 0) return str
    return str[0].toLocaleUpperCase(this.__lang) + str.slice(1)
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
    const lang = this.__lang
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
      if (args[i] === this.__lang) {
        return args[i + 1]
      }
    }
    if (with_def)
      return args[0]
    return `NO VALUE FOR LANG '${this.__lang}'`
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

  /** Get a json from self */
  get_json(fname: string): any { }

  /** Get a yaml from self */
  get_yaml(fname: string): any { }

  /** Get a toml from self */
  get_toml(fname: string): any { }

  /** Query an SQlite database from self */
  query(fname: string, query: string): any { }

}

Object.assign(Env.prototype, {
  __lang: undefined,
  __iter: undefined,
  __iter_key: undefined,
  __iter_next: undefined,
  __iter_prev: undefined,
  __iter_prev_key: undefined,
  __iter_next_key: undefined,
  __iter_prev_page: undefined,
  __iter_next_page: undefined,
  FilePath: FilePath,
  $$env: process.env,
})