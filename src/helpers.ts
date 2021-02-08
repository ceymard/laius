import { performance } from 'perf_hooks'
import path from 'path'
import c from 'colors'
import fs from 'fs'
import sh from 'shelljs'

export function init_timer() {
  const now = performance.now()
  return function (): string {
    return c.bold(c.green('' + (Math.round(100 * (performance.now() - now)) / 100))) + 'ms'
  }
}

export function copy_file(orig: string, dest: string, warn_orig = false) {

  if (!fs.existsSync(orig)) {
    if (warn_orig) console.log(` ${c.yellow('?')} ${orig} does not exist`)
    return
  }

  if (fs.existsSync(dest)) {
    let st = fs.statSync(dest)
    let ost = fs.statSync(orig)
    if (ost.mtimeMs <= st.mtimeMs) {
      // no need to copy
      return
    }
  }
  sh.mkdir('-p', path.dirname(dest))
  sh.cp(orig, dest)
  console.log(` ${c.bold(c.blue('>'))} ${dest}`)
}