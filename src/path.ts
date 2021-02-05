import fs from 'fs'
import path from 'path'

/**
 * Path represents an *existing* file that lives inside a root.
 */
export class FilePath {

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

  get absolute_path() {
    return path.join(this.root, this.filename)
  }

  get absolute_dir() {
    return path.dirname(this.absolute_path)
  }

  get basename() {
    return path.basename(this.filename)
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
}
