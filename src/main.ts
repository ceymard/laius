import { Site } from './page'
import { Ctx } from './token'
import { lex } from './lexer'
import { Parser } from './parser'
import './filter'

export { Site }

var str = `
---
toto: 1
---

# some comment #

@toto()
@toto() @prout
@tutu.titi.tata()

@raw
  @titi..filter('a')
@end

@block tata

@end

Pouet ! {{ }}
`

var str2 = `@zob   @<toto.hey < 3`

// var cursor = 0
var p = new Parser(str)
p.parseTopLevel()
