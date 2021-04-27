import { performance } from 'perf_hooks'
import c from 'colors'

export function init_timer() {
  let now = performance.now()
  return function (): string {
    let renow = performance.now()
    let res = c.bold(c.green('' + (Math.round(100 * (renow - now)) / 100))) + 'ms'
    now = renow
    return res
  }
}
