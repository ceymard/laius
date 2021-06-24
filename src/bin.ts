#!/usr/bin/env -S node --enable-source-maps
import './env'

import { Site } from './site'
import { optparser, flag } from "swl-argparse"
// import 'sharp'

import fs from 'fs'
import path from 'path'
import yml from 'js-yaml'

const opts = optparser(
  flag("-l", "--local").as("local"),
  flag("-w", "--watch").as("watch"),
).parse()


let dir = process.cwd()
let fname: string
do {
  fname = path.join(dir, 'laius.yml')
  if (fs.existsSync(fname)) {
    break
  }
  dir = path.dirname(dir)
}
while (dir !== '/')

if (dir === '/') {
  console.error(`no 'laius.yml' file was found`)
  process.exit(1)
}

let contents: any = yml.load(fs.readFileSync(fname, 'utf-8'))
{
  let pth = contents.path
  if (!pth || !Array.isArray(pth)) {
    console.error(`path should be an array`)
    process.exit(1)
  }
  pth = pth.map(p => path.join(dir, p))

  let site = new Site()
  let first_out_dir: null | string = null
  site.path = pth
  let default_lang: string | undefined = contents.default_gen
  for (let [k, _v] of Object.entries(contents.sites)) {
    if (!default_lang) default_lang = k
    let must = (name: string) => {
      if (!v[name]) {
        console.log(`missing ${name} in site option`)
        process.exit(1)
      }
    }
    let v = _v as any
    must('out_dir')
    must('base_url')
    v.out_dir = path.join(dir, v.out_dir)
    if (v.assets_dir) v.assets_dir = path.join(dir, v.assets_dir)
    if (opts.local || opts.watch) {
      if (!first_out_dir) first_out_dir = v.out_dir
      v.assets_dir = first_out_dir
      v.assets_url = '/'
      v.base_url = k === default_lang ? `/` : `/${k}` // v.out_dir

    }
    // console.log(k, v)
    site.addGeneration(k, v as any)
  }

  if (opts.watch)
    site.watch()
  else
    site.process()
}
