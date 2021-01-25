
export const filter_sym = Symbol('filter')

/** */
declare global {
  interface Object {
    [filter_sym](ctx: any, filter: string, ...args: any): any
  }
}

Object.prototype[filter_sym] = function (this: any, ctx: any, name: string, ...args: any[]): any {
  const f = ctx.filters.get(name)
  if (!f) throw new Error(`unknown filter ${f}`)
}
