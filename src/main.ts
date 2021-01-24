import { Site } from './page'
import { Ctx } from './token'
import { lex } from './lexer'
import './parser'
import './filter'

export { Site }

var str = `
---
toto: 1
---

# some comment #

@toto()
@toto() @prout
@<tutu.titi.tata()

@raw
  @titi..filter('a')
@end

@block tata

@end

Pouet ! {{ }}
`

var cursor = 0
do {
  var t = lex(str, Ctx.top, cursor)
  console.log(t)
  cursor = t.end
} while (!t.isEof)

