
import { add_env_creator } from './env'
import fs from 'fs'
import pth from 'path'
import { FilePath } from '../path'

let mp = new Map<string, Set<string>>()
interface SvgFile {
  id: string
  viewbox: string
  contents: string
  corrected_viewbox: string
  defs: string
}

let files = new Map<string, SvgFile>()
// let spriter = new SVGSpriter({
  // mode: {symbol: true}, // we only use symbols
// });

const re_comments = /<!--[^]*?-->/g
const re_extract = /<svg([^>]*)>([^]*)<\/svg>/im
const re_defs = /<\s*defs[^>]*>([^]*?)<\/\s*defs[^>]*>/g
const re_property = /\b([\w+-]+)=('[^']*'|"[^"]*")/g
const re_replace = /(?<=id=")[^"]+(?=")|(?<=url\s*\([^#]*#)[^\)]+(?=\))/g
const re_problem_href = /xlink:href/g
let id = 0

// FIXME : should extract defs and rewrite all the id=""
// to some uniquified stuff
function extract_svg(contents: string) {
  let prefix = `f${id++}`
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

  let defs: string[] = []
  // Replace all ids by prefixed versions of them.
  txt = txt.replace(re_replace, m => `${prefix}${m}`)
    .replace(re_defs, (_, m) => {
      defs.push(m)
      return ''
    })
    .replace(re_comments, '')
    .replace(re_problem_href, 'href')

    // console.log(defs)
  return {txt, attrs, defs: defs.join('')}
}


add_env_creator(env => {

  env.inline_svg = inline_svg
  function inline_svg(path: string | FilePath, more_class?: string): string {
    let look = env.lookup_file(path)
    let _changed = false
    let cts = fs.readFileSync(look.absolute_path, 'utf-8')
      .replace(/(?<=<svg([\s\n]|[^>])*class=")/, m => {
        _changed = true
        return more_class + ' '
      })
    if (!_changed) {
      cts = cts.replace(/(?<=<svg)/, m => ` class="${more_class}"`)
    }
    return cts
  }

  env.svg_sprite = svg_sprite
  function svg_sprite(path: string | FilePath, more_class?: string): any {

    let _pth = 'sprite.svg'
    let outpath = pth.join(env.__params.assets_out_dir, _pth)
    let url = pth.join(env.__params.assets_url, _pth)

    let set = mp.get(outpath)
    if (!set) {
      set = new Set()
      mp.set(outpath, set)
    }

    let look = path instanceof FilePath ? path : env.lookup_file(path.endsWith('.svg') ? path : `${path}.svg`)
    if (!look) {
      env.$$error(path, 'was not found')
      return ''
    }

    let out_sym = look.filename.replace(/^\//, '')
      .replace(/\//g, '--')
      .replace(/\.svg$/, '')

    let f!: SvgFile
    if (!set.has(look.absolute_path)) {
      set.add(look.absolute_path)
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
          corrected_viewbox,
          defs: cts.defs,
        }
        files.set(look.absolute_path, f)
      }
    } else {
      f = files.get(look.absolute_path)!
    }

    // Should check the mtime of the output file to make sure we don't try to rebuild the sprite
    // if we don't need it...
    if (!env.__params.site.jobs.has(outpath)) {
      env.__params.site.jobs.set(outpath, () => {
        let res: string[] = ['<svg xmlns="http://www.w3.org/2000/svg">']
        let ctss: string[] = []
        for (let f of mp.get(outpath)!) {
          let cts = files.get(f)
          if (!cts) continue
          // this.$$log("svg-include", f)
          if (cts.defs) {
            res.push(cts.defs)
          }
          ctss.push(cts.contents)
        }
        // res.push('</defs>')
        res.push(ctss.join(''))
        res.push('</svg>')
        // <symbol id="${out_sym}" viewBox="0 0 15 16">${transformed_file}</symbol>
        fs.writeFileSync(outpath, res.join(''), {encoding: 'utf-8'})
      })
    }

    // console.log(f.defs)
    let res = `<svg class="laius-svg${more_class ? ` ${more_class}` : ''}" xmlns="http://www.w3.org/2000/svg" viewBox="${f.corrected_viewbox}">${f.defs ? `<defs>${f.defs}</defs>` : ''}<use x="0" y="0" href="${url}#${f.id}"/></svg>`
    // console.log(res)
    return res
  }
})
