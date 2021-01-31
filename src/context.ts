

export const base_ctx = {
  iif(cond: boolean, then: any, otherwise: any = null) {
    return cond ? then : otherwise
  },

  iflang(...args: any[]): any {
    for (let i = 0, l = args.length; i < l; i += 2) {

    }
  },

  coalesce(...args: any[]): null {
    for (let a of args) {
      if (a != null) return a
    }
    return null
  }
}