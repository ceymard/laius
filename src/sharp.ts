import { register_page_plugin, render_in_page } from './page'
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

    // this is the url
    const result = this.$$params.process_file(this.current_path, look, res, async function (output) {
      let result_img = I.sharp(look.absolute_path)
      for (let a of args) {
        let method = a[0]
        let args = a.slice(1)
        result_img = (result_img as any)[method].apply(result_img, args)
      }
      await result_img.toFile(output)
    })
    return result
  }

  return proxy
})
