
import { register_page_plugin } from './page'
import fs from 'fs'
import pth from 'path'

let mp = new Map<string, Set<string>>()
interface SvgFile {
  id: string
  viewbox: string
  contents: string
}

let files = new Map<string, SvgFile>()
// let spriter = new SVGSpriter({
  // mode: {symbol: true}, // we only use symbols
// });


register_page_plugin('svg_sprite', function (path: string): any {

  if (!path.endsWith('.svg'))
    path = path + '.svg'

  let _pth = 'sprite.svg'
  let outpath = pth.join(this.$$params.assets_out_dir, _pth)
  let url = pth.join(this.$$params.assets_url, _pth)

  let set = mp.get(outpath)
  if (!set) {
    set = new Set()
    mp.set(outpath, set)
  }

  let look = this.lookup_file(path)
  let out_sym = look.filename.replace(/^\//, '')
    .replace(/\//g, '--')
    .replace(/\.svg$/, '')

  let f!: SvgFile
  if (!set.has(path)) {
    set.add(path)
    if (!files.has(look.absolute_path)) {
      let svg_contents = fs.readFileSync(look.absolute_path, 'utf-8')
      let viewBox!: string
      let cts = svg_contents.replace(/<svg[^>]*(viewBox="[^"]*")[^>]*>(.*?)<\/svg>/g, (_, viewbox, contents) => {
        viewBox = viewbox
        return `<symbol id="${out_sym}" ${viewbox}>${contents}</symbol>`
      })
      f = {
        id: out_sym,
        viewbox: viewBox,
        contents: cts
      }
      files.set(path, f)
    }
  } else {
    f = files.get(path)!
  }

  // Should check the mtime of the output file to make sure we don't try to rebuild the sprite
  // if we don't need it...
  if (!this.$$site.jobs.has(outpath)) {
    this.$$site.jobs.set(outpath, () => {
      let res: string[] = ['<svg xmlns="http://www.w3.org/2000/svg">']
      for (let f of mp.get(outpath)!) {
        let cts = files.get(f)
        if (!cts) continue
        res.push(cts.contents)
      }
      res.push('</svg>')
      // <symbol id="${out_sym}" viewBox="0 0 15 16">${transformed_file}</symbol>
      fs.writeFileSync(outpath, res.join(''), {encoding: 'utf-8'})
    })
  }

  let res = `<svg class="laius-svg" xmlns="http://www.w3.org/2000/svg" ${f.viewbox}><use href="${url}#${f.id}"/></svg>`
  // console.log(res)
  return res
})
