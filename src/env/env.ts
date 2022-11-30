import * as fs from 'fs'

import c from 'colors'

import type { Generation } from '../site'
import type { Page } from '../page'
import { FilePath } from '../path'
import { I } from './optimports'

/* If an object defines this symbol, then that's what's called by laius to render it instead */
export const render_in_page = Symbol('render-in-page')
export let cache_bust = '?'+ (+new Date).toString(16).slice(-6)
export function actualizeCacheBust() {
  cache_bust = '?'+ (+new Date).toString(16).slice(-6)
}

const long_dates: {[lang: string]: Intl.DateTimeFormat} = {}

export interface Iteration {
  value: any
  key: any
  index: number
  count: number
  page: Page

  is_last: boolean
  is_first: boolean

  next?: Iteration
  prev?: Iteration
}

export interface Environment {
  // Stuff available from current generation
  __params: Generation
  __lang: string
  __iter?: Iteration
  __key?: any
  __value?: any

  θ: Page
  θparent?: Page
  $: Page
  __current: Page
  __postprocess?: (str: string) => string
  __line: number

  $$error(...args: any[]): void
  $$warn(...args: any[]): void
  $$log(...args: any[]): void

  get_page(name: string, opts?: {genname?: string, key?: any, target_page?: Page}): Page
  lookup(...fnames: (string | FilePath)[]): FilePath | null
  lookup_file(...fnames: (string | FilePath)[]): FilePath

  [name: string]: unknown
}

export function create_env(seed: Partial<Environment>): Environment {
  let e: any = {}
  e.__params = seed.__params
  e.__iter = seed.__iter
  e.__value = seed.__value
  e.__key = seed.__key
  e.__current = undefined // will be set
  e.θ = seed.θ
  e.$ = seed.$
  e.__lang = seed.__lang
  e.__params = seed.__params
  e.$$env = process.env // ARGH.
  e.__postprocess = seed.__postprocess
  e.__line = -1

  for (let c of creators) c(e)
  return e
}

export type EnvCreator = (e: Environment) => void
export let creators: EnvCreator[] = []

export function add_env_creator(fn: EnvCreator) {
  creators.push(fn)
}

add_env_creator(env => {

  env.is_truthy = function is_truthy(val: any) {
    return val != null && val !== false && !Number.isNaN(val)
  }

  env.extend = extend
  function extend(ppath: string) {
    // extend gets the page and copy its blocks.
    // it must be the first function executed
    let parent = env.get_page(ppath, { target_page: env.θ })
    if (!parent) {
      env.$$log(ppath, ' was not found')
      return
    }

    env.θparent = env.θ.parent = parent
  }


  env.$$log = function $$log(...a: any[]) {
    let more = ''
    if (env.__current !== env.θ) more = c.grey(`(from ${env.θ.path.filename})`)
    env.__current.path.log(env.__params, env.__line, more, ...a)
  }

  env.$$warn = function $$warn(...a: any[]) {
    let more = ''
    if (env.__current !== env.θ) more = c.grey(`(from ${env.θ.path.filename})`)
    env.__current.path.warn(env.__params, env.__line, more, ...a)
  }

  env.$$error = function $$error(...a: any[]) {
    let more = ''
    if (env.__current !== env.θ) more = c.grey(`(from ${env.θ.path.filename})`)
    env.__current.path.error(env.__params, env.__line, more, ...a)
  }


  env.lookup = function lookup(...fnames: (string | FilePath)[]): FilePath | null {
    for (let f of fnames) {
      if (!f || !f.toString().trim()) continue
      if (f instanceof FilePath) return f
      if (f === '@') return env.θ.path
      if (f === ".") return env.__current.path
      // Should change the logic of path_current to the whole child thing...
      let p = f.startsWith('@/') ? env.θ.path : env.__current.path
      f = f.replace(/^@\/?/, '')
        .replace(/%%/g, p.basename)
        .replace(/%/g, p.noext_basename)
      let res = p.lookup(f)
      if (res != null && res.isFile()) return res
    }
    return null
  }

  env.lookup_file = function lookup_file(...fnames: (string | FilePath)[]): FilePath {
    let res = env.lookup(...fnames)
    if (!res || !res.isFile()) throw new Error(`could not find file for '${fnames.join(', ')}'`)
    return res
  }

  /**
   * Get a static file and add its path to the output.
   * Static files are looked relative to the current page, or if fname starts with '@/' relative to the current *page*.
   * Their output is the same file in the output directory of $$path_current / page_path, always relative to the ASSET ROOT, which is generally the same as the OUT ROOT.
   *
   */
  env.static_file = function static_file(fname: string | FilePath, outpath?: string) {
    let look = fname instanceof FilePath ? fname : env.lookup_file(fname)
    return env.__params.copy_file(env.__current.path, look, outpath ?? look.filename)
  }

  /** Read a file's content and outputs it as is */
  function file_contents(fname: string) {
    let look = env.lookup_file(fname)
    return fs.readFileSync(look.absolute_path, 'utf-8')
  }
  env.file_contents = file_contents

  env.get_files = function get_files(name: string): FilePath[] {
    let re = new RegExp(name)

    let files = env.__params.site.listFiles(env.__current.path.root, env.__current.path.local_dir)
    files = files.filter(f => re.test(f.filename))

    return files
  }

  /**
   * Get pages matching a path. Unlike get_page, get_pages only performs path searches
   * relative to the current page.
   */
  env.get_pages = function get_pages(name: string | RegExp, gen_key?: string): Page[] {
    let matcher = name instanceof RegExp ? name : new RegExp(name)
    let gen = gen_key != null ? env.__params.site.generations.get(gen_key) : env.__params
    if (gen == null) throw new Error(`no such generation name '${gen_key}'`)

    let files = env.__params.site.listFiles(env.__current.path.root, env.__current.path.local_dir)
      .filter(f => matcher.test(f.filename))
      .map(f => env.__params.site.get_page_source(f).get_page(gen!))

    return files
  }

  env.link = function link(fpath: string, key?: string) {
    let p = env.get_page(fpath)
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

  env.get_current_page_in = function get_current_page_in(genname: string) {
    let dest_pg = env.θ
    let src = dest_pg.$$source
    let gen = src.site.generations.get(genname)
    if (!gen) throw new Error(`no generation named '${genname}'`)
    let pg = src.get_page(gen)
    if (!pg.$$repetitions) return pg
    return pg.$$repetitions?.get(dest_pg.__env.__iter_key)
  }

  /** get a page */
  env.get_page = function get_page(fname: string, opts?: {genname?: string, key?: any, target_page?: Page}): Page {
    let look = env.lookup_file(fname)
    const src = env.__params.site.get_page_source(look)
    if (!src) throw new Error(`could not find page '${fname}'`)
    const gen = opts?.genname ?? env.__params.generation_name
    if (!env.__params.site.generations.has(gen)) throw new Error(`no generation named '${gen}'`)
    let pg = src.get_page(env.__params.site.generations.get(gen)!, opts?.target_page)
    let key = opts?.key
    if (key != null) {
      let r = pg.$$repetitions?.get(key)
      if (!r) throw new Error(`no page for key ${key}`)
      return r
    }
    return pg
  }

  env.get_this_page_in = function get_this_page_in(genname: string) {
    let self: Page = env.θ

    let iter_key = self.__env.__iter_key
    let gen = env.__params.site.generations.get(genname)
    if (!gen) throw new Error(`no generation named '${genname}'`)
    let pg = self.$$source.get_page(gen)
    if (iter_key != null) return pg.$$repetitions?.get(iter_key)
    return pg
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////

  /** Get a json from self */
  env.get_json = function get_json(fname: string): any {
    return JSON.parse(file_contents(fname))
  }

  /** Get a yaml from self */
  env.get_yaml = function get_yaml(fname: string): any {
    let y = require('js-yaml') as typeof import('js-yaml')
    let res = y.loadAll(file_contents(fname), undefined, { filename: fname, })
    if (res.length === 1) return res[0]
    return res
  }

  /** Get a toml from self */
  env.get_toml = function get_toml(fname: string): any { }

  /** Query an SQlite database from self */
  env.query = function query(fname: string, query: string): any { }

  /////////////////////////////////////////////////////////////////////////////////////////////////////
  //                                FILTERS
  /////////////////////////////////////////////////////////////////////////////////////////////////////

  env.round = function round(v: any) {
    return Math.round(v)
  }

  env.floor = function floor(v: any) {
    return Math.floor(v)
  }

  env.ceil = function ceil(v: any) {
    return Math.ceil(v)
  }


  env.order_by = function order_by<T>(val: T[], ...args: (keyof T | ((a: T) => any))[]) {
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

  env.upper = function upper(val: string) {
    return (val ?? '').toString().toLocaleUpperCase(env.__lang)
  }

  env.lower = function lower(val: string) {
    return (val ?? '').toString().toLocaleLowerCase(env.__lang)
  }

  env.capitalize = function capitalize(val: string) {
    var str = (val ?? '').toString()
    if (str.length === 0) return str
    return str[0].toLocaleUpperCase(env.__lang) + str.slice(1)
  }

  env.slugify = function slugify(val: string) {
    return (val??'').toString().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
      .replace(/[\s']+/g, '-') // Replace spaces with -
      .replace(/[^\w\-]+/g, '') // Remove all non-word characters
      .replace(/\-\-+/g, '-') // Replace multiple - with single -
      .replace(/^-+/, '') // Trim - from start of text
      .replace(/-+$/, '') // Trim - from end of text
  }

  env.date_long = function date_long(dt: any) {
    const lang = env.__lang
    // console.log(lang, dt)
    const fmt = long_dates[lang] = long_dates[lang] ?? Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric' })
    return fmt.format(new Date(dt))
  }

  env.typographic_nbsp = function typographic_nbsp(value: string): string {
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
  env.markdown = function markdown(value: string) {
    return I.md.render(value)
  }

})
