import { Site } from './page'
import { Parser } from './parser'

export { Site }

var str = `
---
toto: 1
---

# some comment #

@toto(2, await '3', 52['2'])
@toto() @prout
@tutu.titi.tata()

@test = fn toto => toto + 1

@raw
  pouet pouet
  @titi..escape('a')
@end

@block tata

@end

Pouet ! {{ }}
`

// var str2 = `@zob   @<toto.hey < 3`

// var cursor = 0
var p = new Parser(str)
p.parseTopLevel()
