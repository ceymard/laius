import { Site } from './page'
import { Parser } from './parser'

export { Site }




/*
var str = `
@template = 'hello/hello.tpl'
@toto = 1
@m = import()

@youtube = fn(id)
@some_macro = fn(body, args) => \`
  @for stuff in pouet
    @(null)
  @end
\`

# some comment #

@toto(2, await '3', 52['2'])
@toto() @prout
@tutu.titi.tata()

@test = fn toto => toto + 1

@if lang == 'fr'

@elif lang == 'en'

@end

@raw
  pouet pouet
  @titi->escape('a')
@end

@block tata
  @super
  <link rel="stylesheet" href="@stylus('./css/main.styl')">
  DO STUFF @myvar.toString()
@end

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
*/