

export const base_ctx = {
  iif(cond: boolean, then: any, otherwise: any = null) {
    return cond ? then : otherwise
  },

  coalesce(...args: any[]): null {
    for (let a of args) {
      if (a != null) return a
    }
    return null
  }
}