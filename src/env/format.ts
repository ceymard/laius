import c from 'colors'
import { add_env_creator, render_in_page } from './env'

type Res = string[] & { last_empty: boolean }

add_env_creator(env => {
  /**
   * The omega function is in charge of error reporting
   */
  env.ω = ω
  function ω(arg: any): string | undefined | null {
    if (typeof arg === 'function') {
      try {
        arg = arg()
      } catch (e) {
        let pth = env.__current.path.filename
        console.log(` ${c.red('!')} ${c.gray(pth)} ${c.green('' + (env.__line + 1))}: ${c.gray(e.message)}`)
        if (process.env.DEBUG) {
          console.log(c.grey(e.stack))
          console.log(c.grey(arg.toString()))
        }
        arg = `<span class='laius-error'>${pth} ${env.__line + 1} ${e.message}</span>`
      }
    }
    if (arg == null) return arg
    if (arg[render_in_page]) return arg[render_in_page]()
    return arg.toString()
  }

  env.Σ = Σ
  function Σ(res: Res, a: string | undefined | null, is_value: boolean) {
    if (a === null || a === undefined) {
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

  env.ℯ = ℯ
  function ℯ(res: Res, a: any) {
    a = ω(a)
    if (Array.isArray(a)) {
      for (let i = 0, l = a.length; i < l; i++) { ℯ(res, a[i]) }
    } else {
      Σ(res, a, true)
    }
  }
})
