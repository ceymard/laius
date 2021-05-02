import c from 'colors'
import { Env } from './env'

type Res = string[] & { last_empty: boolean }
export const render_in_page = Symbol('render-in-page')

/**
 * The omega function is in charge of error reporting
 */
export function ω(this: Env, arg: any): string {
  if (typeof arg === 'function') {
    try {
      arg = arg()
    } catch (e) {
      let pth = this.filepath.filename
      console.log(` ${c.red('!')} ${c.gray(pth)} ${c.green('' + (this.line + 1))}: ${c.gray(e.message)}`)
      if (process.env.DEBUG) {
        console.log(c.grey(e.stack))
        console.log(c.grey(arg.toString()))
      }
      arg = `<span class='laius-error'>${pth} ${this.line + 1} ${e.message}</span>`
    }
  }
  let r = arg ?? ''
  if (r[render_in_page]) return r[render_in_page]()
  return r
}

export function Σ(res: Res, a: string, is_value: boolean) {
  if (a.length === 0) {
    res.last_empty = is_value
  } else {
    if (res.last_empty) {
      for (var i = 0, l = a.length; i < l; i++) {
        let p = a[i]
        if (p !== ' ' && p !== '\\t') {
          break
        }
      }
      let is_newline = a[i] === '\\n'
      if (i > 0) { a = a.slice(i) }
      else {
        // empty content right before content.
        let j = res.length - 1
        while (j > 0) {
          let item = res[j]
          let k = item.length - 1
          while (k > 0 && (item[k] === ' ' || item[k] === '\\t')) { k-- }
          if (k === -1) {
            res.pop()
          } else {
            if (k < item.length - 1) { res[j] = item.slice(0, (is_newline && item[k] === '\\n') ? k : k+1); break }
            break
          }
          j--
        }
      }
      // last call was empty, which means we have to remove its leading spaces
    }
    res.last_empty = false
    res.push(a)
  }
}

export function ℯ(ω: (a: any) => string, res: Res, a: any) {
  a = ω(a)
  if (Array.isArray(a)) {
    for (let i = 0, l = a.length; i < l; i++) { ℯ(ω, res, a[i]) }
  } else {
    Σ(res, a, true)
  }
}
