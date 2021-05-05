import { create_env } from './env'
export { Environment, create_env, render_in_page } from './env'

import './format'
import './css'
import './dump'
import './math'
import './sharp'

let e = create_env({} as any)
export const names: string = Object.getOwnPropertyNames(e).map(name => `  let ${name} = εenv.${name};`).join('\n')
