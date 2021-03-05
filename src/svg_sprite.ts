
import { register_page_plugin } from './page'
import fs from 'fs'
import pth from 'path'

let mp = new Map<string, Set<string>>()
interface SvgFile {
  id: string
  viewbox: string
  contents: string
  corrected_viewbox: string
}

let files = new Map<string, SvgFile>()
// let spriter = new SVGSpriter({
  // mode: {symbol: true}, // we only use symbols
// });


const re_extract = /<svg([^>]*)>([^]*)<\/svg>/im
const re_property = /\b([\w+-]+)=('[^']*'|"[^"]*")/g
function extract_svg(contents: string) {
  let cts = re_extract.exec(contents)
  if (!cts) {
    throw new Error(`svg file does not appear to be valid`)
  }
  let pros = cts[1]
  let txt = cts[2]
  let attrs: {[name: string]: string | undefined} = {}
  let match: RegExpExecArray | null = null

  while ((match = re_property.exec(pros))) {
    let prop = match[1]
    let ct = match[2].slice(1, -1)
    attrs[prop.toLocaleLowerCase()] = ct
  }
  return {txt, attrs}
}


register_page_plugin('svg_sprite', function (path: string, more_class?: string): any {

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

      const cts = extract_svg(svg_contents)
      // min-x, min-y, width, height
      // we want to keep only the width and height
      let viewbox = cts.attrs.viewbox ?? `0 0 ${cts.attrs.width??100} ${cts.attrs.height??100}`
      let corrected_viewbox = cts.attrs.viewbox ? cts.attrs.viewbox.replace(/[-+]?[\d.]* [-+]?[\d.]*/, '0 0')
        : `0 0 ${cts.attrs.width ?? '100'} ${cts.attrs.height ?? '100'}`
      // console.log(corrected_viewbox)

      f = {
        id: out_sym,
        viewbox: viewbox,
        contents: `<symbol id="${out_sym}" viewBox="${viewbox}">${cts.txt}</symbol>`,
        corrected_viewbox
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
        this.$$log("svg-include", f)
        res.push(cts.contents)
      }
      res.push('</svg>')
      // <symbol id="${out_sym}" viewBox="0 0 15 16">${transformed_file}</symbol>
      fs.writeFileSync(outpath, res.join(''), {encoding: 'utf-8'})
    })
  }

  let res = `<svg class="laius-svg${more_class ? ` ${more_class}` : ''}" xmlns="http://www.w3.org/2000/svg" viewBox="${f.corrected_viewbox}"><use x="0" y="0" href="${url}#${f.id}"/></svg>`
  // console.log(res)
  return res
})
