import type { PageInstance } from './page'

export class Data {
  // page!: PageInstance
  // this!: PageInstance

  $template?: string
  $markdown_options?: any

  constructor(
    public page: PageInstance,
    public self: PageInstance,
    public $lang: string,
  ) {

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

}
