import { Site } from './page'
import { Parser } from './parser'

export { Site }

var str = `
@toto = 1
@title = L()

@Extend 'hello'

# some comment #

@toto(2, await '3', 52['2'])
@toto() @prout
@tutu.titi.tata()

@test = fn toto => toto + 1

@Raw
  pouet pouet
  @titi->escape('a')
@End

@Block tata
  @Super
  <link rel="stylesheet" href="@stylus('./css/main.styl')">
  DO STUFF @myvar.toString()
@End

Pouet ! @[1, 2, 3]
@tutu = {1: 2}

@{
  inst = 'toto'
}

@toto->date
`

// var str2 = `@zob   @<toto.hey < 3`

// var cursor = 0
var p = new Parser(str)
p.parseTopLevel()
