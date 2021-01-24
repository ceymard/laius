const fs = require('fs')
const path = require('path')

const lex = fs.readFileSync(path.join(__dirname, 'lexer.rets'), 'utf-8')
var output = fs.readFileSync(path.join(__dirname, 'lexer.ts'), 'utf-8')

// re2c -isc lexer.rets | sed 's/cond()/cond/' | sed 's/cond\([^)]+\)/cond = \1/' | sed 's/var\ yych/case 1: var yych/' | sed 's/[*]\([+][+]\)\?cursor/str[\1cursor]/' | sed 's/goto case \([^;]*\)/{ state = \1 ; continue ; }/' | sed 's/unsigned int //' | sed 's/[*](Y/(Y/' | sed 's/yych \([!=]\)= /yych \1== /'  | sed 's|yych \([<>]\)= \(0x[0-9a-fA-F]*\)|yych.charCodeAt(0) \1= \2|' | sed 's/case eof/case State.eof/' | sed 's/state = eof/state = State.eof/' | sed 's/State[.]yyc/State./' > lexer.ts

	// echo export const enum T { `grep -o 'T\.\w\+' lexer.rets | sort | sed 's/T.\(.*\)/\1,/' | uniq` } >> lexer.ts

output = output
  .replace(/cond\(\)/g, 'cond()')
  .replace(/cond\([^]+\)/g, 'cond = $1')
  .replace(/var yych\s*;/g, 'case 1: ')
  .replace(/\*(\+\+)?cursor/g, '[$1cursor]')
  .replace(/goto case ([^;]*)/g, '{ state = $1; continue ; }')
  .replace(/unsigned int /g, '')
  .replace(/\*\(Y/g, 'Y')
  .replace(/yych ([=!])= /g, 'yych $1== ')
  // .replace(/yych ([><]= 0x[0-9a-fA-F]*)/g, 'yych.charCodeAt(0) $1')
  .replace(/(case|[><=]=) '(\\\\|\\'|[^'])+'/g, m => {
    // console.log(m)
    if (m[0] === 'c') {
      var op = 'case'
      var code = m.slice(4)
    } else {
      op = m.slice(0, 2)
      code = m.slice(3)
    }
    return `${op} 0x${eval(`${code}.charCodeAt(0).toString(16)`)} /* ${code} */`
  })
  .replace(/case eof/g, 'case State.eof')
  .replace(/state = eof/g, 'state = State.eof')
  .replace(/State\.yyc/g, 'State.')

// console.log('\n\n')

function get_all(re, src) {
  var res = new Set()
  do {
    var m = re.exec(src)
    if (m) {
      res.add(m[1])
    }
  } while (m)
  return [...res].sort()
}

var states = get_all(/case (?:State\.)?([a-zA-Z][\w_]+)/g, output)
var tokens = get_all(/T\.(\w+)/g, output)
// var conds = get_all(/Cond\.(\w+)/g, output)


var out = output

out += `const enum State {
${states.map((s, i) => `  ${s}${i === 0 ? ' = 10000' : ''},`).join('\n')}
}`

fs.writeFileSync("lexer.ts", out, { encoding: 'utf-8' })

fs.writeFileSync("token-gen.ts", `
export const enum T {
${tokens.map((s, i) => `  ${s}${i === 0 ? ' = 0' : ''},`).join('\n')}
}

export const token_names = [
  ${tokens.map((s, i) => `  '${s}',`).join('\n')}
]
`, { encoding: 'utf-8' })
