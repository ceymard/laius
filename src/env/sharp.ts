import { add_env_creator, render_in_page } from './env'
import { FilePath } from '../path'
import { I } from './optimports'

add_env_creator(env => {

  env.sharp = sharp
  function sharp(filename: string | FilePath) {
    let look = env.lookup_file(filename)

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
      let ext = look.extension
      for (let a of args) {
        if (a[0] === "toFormat")
          ext = a[1] ?? ext
      }
      let md5 = require('crypto').createHash('md5').update(aj, 'binary').digest('base64') as string
      let res = `${look.local_dir}/${look.noext_basename}-${md5.slice(0, 8)}.${ext}`

      // this is the url
      const result = env.__params.process_file(env.__current.path, look, res, async function (output) {
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
  }
})
