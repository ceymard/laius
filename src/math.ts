
import { Env, } from './env'

Env.register('round', function(v: any) {
  return Math.round(v)
})