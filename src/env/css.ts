import pth from 'path'
import fs from 'fs'

import c from 'colors'

import { add_env_creator, cache_bust } from './env'
import { I } from './optimports'

add_env_creator(env => {
  env.css = function css(fname: string) {
    let look = env.lookup_file(fname)

    let url = pth.join(env.__params.assets_url, fname)
    let copy_path = pth.join(env.__params.assets_out_dir, fname)
    let to_copy = new Map<string, string>()
    to_copy.set(look.absolute_path, copy_path)

    // Do not retry to process the file if it is already in a job.
    if (env.__params.site.jobs.has(copy_path)) return url

    for (let [orig, dest] of to_copy) {
      if (pth.extname(orig) !== '.css') continue
      const src_file = fs.readFileSync(orig, 'utf-8')
      const re_imports = /@import ("[^"?]+"|'[^'?]+')|url\(("[^"?]+"|'[^'?]+'|[^'"?\)]+)\)/g
      let match: RegExpMatchArray | null = null
      while ((match = re_imports.exec(src_file))) {
        var referenced = (match[1] ?? match[2])//.slice(1, -1)
        if (referenced[0] === '"' || referenced[0] === "'") referenced = referenced.slice(1, -1)
        let path_to_add = pth.join(pth.dirname(orig), referenced)
        let copy_to_add = pth.join(pth.dirname(dest), referenced)
        to_copy.set(path_to_add, copy_to_add)
      }
    }

    let curpath = env.__current.path
    env.__params.site.jobs.set(copy_path, () => {
      for (let [orig, copy] of to_copy.entries()) {
        let or = this.lookup(orig)
        if (!or) continue
        env.__params.copy_file(curpath, or, copy)
        // copy_file(orig, copy)
      }
    })

    return url + cache_bust
  }

  /** */
  env.sass = function sass(fname: string) {
    // sass.renderSync()
    let look = env.lookup_file(fname)

    let curpath = env.__current.path
    let dest_fname = look.filename.replace(/\.s[ac]ss$/, '.css')
    return env.__params.process_file(curpath, look, dest_fname, outfile => {
      let r = I.sass.renderSync({file: look.absolute_path, outFile: outfile})
      fs.writeFileSync(outfile, r.css)
      // FIXME : add a dependency to the included files !
      console.log(` ${c.magenta(c.bold('>'))} ${outfile} ${c.green(r.stats.duration.toString())}ms`)

      const re_imports = /@import ("[^"?]+"|'[^'?]+')|url\(("[^"?]+"|'[^'?]+'|[^'"?\)]+)\)/g
      let match: RegExpMatchArray | null = null
      let css = r.css.toString('utf-8')
      while ((match = re_imports.exec(css))) {
        var referenced = (match[1] ?? match[2])//.slice(1, -1)
        if (referenced[0] === '"' || referenced[0] === "'") referenced = referenced.slice(1, -1)
        let path_to_add = pth.join(look.absolute_dir, referenced)
        let copy_to_add = pth.join(pth.dirname(dest_fname), referenced)
        env.__params.copy_file(curpath, path_to_add, copy_to_add)
      }
    })
  }

})