import type { PageInstance } from './page'

const dt = Intl.DateTimeFormat('fr')
const long_dates: {[lang: string]: Intl.DateTimeFormat} = {}

export class Data {
  // page!: PageInstance
  // this!: PageInstance

  $template?: string
  $markdown_options?: any
  $post_init!: (fn: () => any) => any

  $slug?: string

  // Repeating stuff !
  $repeat?: any[]
  $on_repeat?: () => any
  iter?: any

  constructor(
    public page: PageInstance,
    public self: PageInstance,
    public lang: string,
  ) {

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
