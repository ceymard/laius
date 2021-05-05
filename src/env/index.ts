import { create_env } from './env'
export { Iteration, Environment, create_env, render_in_page, cache_bust } from './env'
export { I } from './optimports'

import './format'
import './css'
import './dump'
import './sharp'
import './svg_sprite'

let e = create_env({} as any)
export const names: string = Object.getOwnPropertyNames(e).map(name => `  let ${name} = εenv.${name};`).join('\n')
