import { register_page_plugin, render_in_page } from './page'
import fs from 'fs'
import pth from 'path'
import sh from 'shelljs'
import { FilePath } from './path'
import { I } from './optimports'

register_page_plugin('sharp', function (filename: string | FilePath) {
  let look = this.lookup_file(filename)

  let args: any[] = []

  let proxy = new Proxy(args, {
    get(_args, key, _inst) {
      if (key === render_in_page) {
        // ok we have it, we want the URL now
        return () => get_url()
      }
      return function (..._args: any[]) {
        args.push([key, ..._args])
        return _inst
      }
    },

  })

  let get_url = () => {
    // console.log(args)
    let aj = JSON.stringify(args)
    let md5 = require('crypto').createHash('md5').update(aj, 'binary').digest('base64') as string

    let res = `${look.local_dir}/${look.noext_basename}-${md5.slice(0, 8)}.${look.extension}`
    let url = pth.join(this.$$params.assets_url, res)
    let copy_path = pth.join(this.$$params.assets_out_dir, res)

    let st = fs.existsSync(copy_path) ? fs.statSync(copy_path) : null
    if (this.$$site.jobs.has(copy_path) || st?.mtimeMs! >= look.stats.mtimeMs) return url

    this.$$site.jobs.set(copy_path, async () => {

      let result_img = I.sharp(look.absolute_path)
      sh.mkdir('-p', pth.dirname(copy_path))
      // console.dir(result_img.resize)
      for (let a of args) {
        let method = a[0]
        let args = a.slice(1)
        result_img = (result_img as any)[method].apply(result_img, args)
      }
      await result_img.toFile(copy_path)
    })

    return url
  }

  return proxy
})
