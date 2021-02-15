import fs from 'fs'
import path from 'path'
import c from 'colors'
import { Generation } from './site'

import util from 'util'

/**
 * Path represents an *existing* file that lives inside a root.
 */
export class FilePath {

  toString() {
    return `[FilePath:${this.root}:${this.filename}:${this.stats.mtimeMs}]`
  }

  [util.inspect.custom]() {
    return `<FilePath:${c.blue(this.root)}:${c.magenta(this.filename)}:${this.stats.mtimeMs}>`
  }

  /** local name always starts with a '/' */
  constructor(public root: string, public filename: string, public stats: fs.Stats) {
    if (filename[0] !== '/') this.filename = '/' + filename
  }

  get local_dir() {
    return path.dirname(this.filename)
  }

  get extension() {
    return path.extname(this.filename).slice(1)
  }

  get absolute_path_no_ext() {
    return path.join(this.root, this.filename.replace(/\.[^\/]+$/, ''))
  }

  get absolute_path() {
    return path.join(this.root, this.filename)
  }

  get absolute_dir() {
    return path.dirname(this.absolute_path)
  }

  get basename() {
    return path.basename(this.filename)
  }

  get noext_basename() {
    return this.basename.replace(/\.[^\/]+$/, '')
  }

  isDirFile() {
    return this.basename === '__dir__.tpl'
  }

  /**
   * Looks for a file either relatively inside the same root, or absolutely in all the roots in order.
   */
  lookup(lookup_path: string, roots: string[]): FilePath | null {
    if (lookup_path[0] === '/') {
      // perform an absolute lookup.

      // we only search the roots specified after our own
      let i = roots.indexOf(this.root)

      for (; i < roots.length; i++) {
        let root = roots[i]
        let try_path = path.join(root, lookup_path)
        if (!fs.existsSync(try_path)) continue
        let st = fs.statSync(try_path)
        return new FilePath(root, lookup_path, st)
      }
    } else {
      let relative_name = path.join(this.local_dir, lookup_path)
      let try_path = path.join(this.root, relative_name)
      if (fs.existsSync(try_path)) {
        let st = fs.statSync(try_path)
        return new FilePath(this.root, relative_name, st)
      }
    }

    return null // path was not found.
  }

  info(g: Partial<Generation>, ...a: any[]) {
    console.error(c.green(c.bold(' *')), c.magenta(g.generation_name ?? ''), c.grey(this.filename), ...a)
  }

  log(g: Partial<Generation>, ...a: any[]) {
    console.error(c.blue(' ?'), c.magenta(g.generation_name ?? ''), c.grey(this.filename), ...a)
  }

  warn(g: Partial<Generation>, ...a: any[]) {
    console.error(c.yellow(' !'), c.magenta(g.generation_name ?? ''), c.grey(this.filename), ...a)
  }

  error(g: Partial<Generation>, ...a: any[]) {
    console.error(c.red(c.bold(' !')), c.magenta(g.generation_name ?? ''), c.red(this.filename), ...a)
  }

}
