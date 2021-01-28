
import { Position, Token, T, Ctx } from './token'
import { lex } from './lexer'

export const enum TokenType {
  keyword,
  property,
  variable,
  parameter,
  function,
  type,
  operator,
  regexp,
  string,
  number,
  comment,
}

// const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor

var nuds: (Nud | undefined)[][] = new Array(Ctx.__max)
var leds: (Led | undefined)[][] = new Array(Ctx.__max)
for (let i = 0; i < Ctx.__max; i++) {
  nuds[i] = new Array(T.ZEof + 1)
  leds[i] = new Array(T.ZEof + 1)
}

export const DATA = `dt`

//////////////////////////////////


////////////////////////////////////////////////
// JS-like expressions
////////////////////////////////////////////////

xp_led(210, T.ArrowFunction, binary, 35) // parses above assign

// 200, function calls and indexing
xp_led(200, T.Dot, binary)
xp_led(200, T.LParen, exp_parse_call)
xp_led(200, T.LBrace, exp_parse_call)
xp_led(200,  T.Filter, exp_filter)
//
xp_nud(T.New, prefix, 190)
xp_led(180, T.Increments, suffix)
// 170
xp_nud(T.Add, prefix, 170)
xp_nud(T.Increments, prefix, 170)
xp_nud(T.Not, prefix, 170)
//
xp_led(160, T.Power, binary)
xp_led(150, T.Mul, binary)
xp_led(140, T.Add, binary)
xp_led(130, T.BitShift, binary)
xp_led(120, T.Comparison, binary)
xp_led(110, T.Equal, binary)
xp_led(100, T.BitAnd, binary)
xp_led(90,  T.BitXor, binary)
xp_led(80,  T.BitOr, binary)
xp_led(70,  T.And, binary)
xp_led(60,  T.Or, binary)
xp_led(50,  T.Nullish, binary)
xp_led(40,  T.Question, exp_parse_ternary)
xp_led(30,  T.Assign, binary) // = needs to be in @{ }
xp_led(25,  T.Colon, binary)
xp_nud(T.Yield, prefix, 20)
xp_led(10,  T.Comma, binary)
// const COMMA_RBP = 10

xp_nud(T.Date, exp_parse_date)
xp_nud(T.Ident, exp_ident)
xp_nud(T.Number, exp_all_text)
xp_nud(T.Regexp, exp_all_text)
xp_nud(T.String, exp_all_text)
xp_nud(T.Semicolon, exp_all_text)
xp_nud(T.LParen, exp_parse_grouping)
xp_nud(T.LBrace, exp_parse_grouping)
xp_nud(T.LBracket, exp_parse_grouping)
xp_nud(T.Semicolon, exp_all_text)
xp_nud(T.Fn, exp_parse_function)
xp_nud(T.Ellipsis, prefix, 250) // ellipsis can only bind nuds

//////////////////////////////////

/**
 * Parse a function declaration
 * fn (arg, ...args) => body
 * fn (arg) {  }
 */
function exp_parse_function(n: NudContext) {
  var args = ''
  var star = n.parser.peek()
  if (star.value === "*") {
    /// ooh, ugly...

  }
  var t = n.parser.expect(T.LParen)
  args += `${t?.all_text ?? '('}`
  do {
    var next = n.parser.next(Ctx.expression)
    args += next.all_text
  } while (next.kind !== T.RParen)

  var body = ''
  n.parser.expression(0)
  return ''
}

// ( ... ) grouped expression with optional commas in them
function exp_parse_grouping(l: NudContext): Result {
  var xp = ''
  var right = l.tk.kind === T.LParen ? T.RParen : l.tk.kind === T.LBrace ? T.RBrace : T.RBracket
  var tk: Token
  const p = l.parser
  while ((tk = p.peek()).kind !== right) {
    var pos = tk.start
    // console.log('!')
    xp += p.expression(0)
    if (p.pos.offset === pos.offset) {
      tk = p.next(Ctx.expression)
    }
  }
  var paren = p.expect(right)
  return `${l.tk.all_text}${xp}${paren?.all_text ?? ')'}`
}

// ? <exp> : <exp>
function exp_parse_ternary(l: LedContext): Result {
  var p = l.parser
  var next = p.expression(l.led.rbp)
  var colon = p.expect(T.Colon)
  if (!colon) return `throw new Error('invalid expression')`
  var right = p.expression(l.led.rbp /* this is probably wrong ? */)

  return `${l.left}${l.tk.all_text}${next}${colon.all_text}${right}`
}

function exp_filter(l: LedContext) {
  l.parser.tagToken(l.tk)
  var filter_xp = l.parser.expression(76) // is this priority correct ?
  return `$.filter(${filter_xp}, () => ${l.left})`
}

function exp_ident(n: NudContext) {
  // console.log(n.rbp)
  if (n.rbp < 200) { // not in a dot expression, which means the name has to be prefixed
    return `${n.tk.prev_text}${DATA}.${n.tk.value}`
  }
  return n.tk.all_text
}

function exp_all_text(n: NudContext) {
  return n.tk.all_text
}

function exp_parse_date(n: NudContext) {
  return `new Date('${n.tk.value}')`
}

function exp_parse_call(l: LedContext) {
  const p = l.parser, tk = l.tk
  var call_xp = tk.all_text
  var righttk = tk.kind === T.LParen ? T.RParen : T.RBrace
  if (p.peek().kind !== righttk) {
    call_xp += p.expression(0)
  }
  var right = l.parser.expect(righttk)
  if (right) {
    call_xp += right.all_text
  }
  return `${l.left}${call_xp}`
}


/////////////////////////////////////////////////////////////////////////

function binary(c: LedContext) {
  return c.left + c.tk.all_text + c.parser.expression(c.led.rbp)
}

function prefix(c: NudContext) {
  return c.tk.all_text + c.parser.expression(c.nud.rbp)
}

function suffix(c: LedContext) {
  return c.left + c.tk.all_text
}

interface BaseContext {
  parser: Parser
  ctx: Ctx
  tk: Token
  rbp: number
}

interface NudContext extends BaseContext {
  nud: Nud
}

interface LedContext extends BaseContext {
  led: Led
  left: Result
}

export class LspPosition {

}

export class LspRange {
  constructor(public start: LspPosition,
              public end: LspPosition,
  ) { }
}

export class LspDiagnostic {
  source = 'laius'
  constructor(public range: LspRange, public message: string) { }
}

interface TopCtxBlock {
  type: 'block'
  block: string,
}

interface TopCtxLang {
  type: 'lang'
  lang: string
  block?: string
}

interface TopCtxIf {
  type: 'if'
}

type TopCtx = TopCtxBlock | TopCtxLang | TopCtxIf

export class Parser {
  errors: string[] = []
  source = ''

  /**
   * If false, it means the parser is just running as a language server for token output.
   */
  build = true

  constructor(public str: string, public pos = new Position()) { }

  peek(ctx = Ctx.expression): Token {
    var next = this.next(ctx)
    this.rewind()
    return next
    // return lex(this.str, ctx, this.pos)
  }

  /**
   * Tags a token for the LSP
   */
  tagToken(tk: Token) {

  }

  report(t: Token, msg: string) {
    this.errors.push(`${t.value_start.line+1}: ${msg}`)
  }

  commit(t: Token) {
    this.pos = t.end
  }

  _rewound = false

  /**
   * Rewind the parser to the start position of the last token.
   * In effect, the parser needs one token of look-ahead.
   */
  rewind() {
    this.pos = this._last_token!.start
    this._rewound = true
  }

  _last_token!: Token

  /**
   * Provide the next token in the asked context.
   */
  next(ctx: Ctx): Token {
    if (this._rewound) {
      var last = this._last_token
      if (last.ctx === ctx) {
        this._rewound = false
        this.pos = last.end
        return last
      }
    }

    do {
      var tk = lex(this.str, ctx, this.pos)
      // console.log(tk)
      this.pos = tk.end
    } while (tk.can_skip)
    this._last_token = tk
    this._rewound = false
    return tk
  }

  emit(str: string) {
    var add = '  '.repeat(this.topctx.length + 1) + str + '\n'
    this.source += add
    // console.log()
  }

  emitText(txt: string) {
    this.emit(`$(\`${txt.replace(/(\`|\$)/g, '\\$1').replace(/\n/g, '\\n')}\`)`)
  }

  topctx: TopCtx[] = []

  parseExpression(tk: Token) {
    this.emit(`await $.xp(async () => ${this.expression(195)})`)
  }

  parseTopLevelFor(tk: Token) {

  }

  parseTopLevelIf(tk: Token) {

  }

  parseTopLevelWhile(tk: Token) {

  }

  parseTopLevelBlock(tk: Token) {
    let nx = this.next(Ctx.expression)
    let name = '__errorblock__'
    // console.log(nx)
    if (nx.kind === T.Ident) {
      name = nx.value
    } else {
      this.report(nx, 'expected an identifier')
    }

    this.emit(`await $.block('${name}', async ($, ${DATA}) => {`)
    this.topctx.push({type: 'block', block: name })
    this.emit(`var r = ''`)
  }

  parseTopLevelRaw(tk: Token) {
    let str = ''
    let nx: Token

    do {
      nx = this.next(Ctx.top)
      if (nx.kind === T.End || nx.isEof) {
        str += nx.prev_text
        break
      }
      str += nx.all_text
    } while (true)

    if (this.trim_right) str = str.trimStart()
    if (nx.trim_left) str = str.trimEnd()

    if (nx.isEof) this.report(tk, `missing @end`)
    if (str) this.emitText(str)
  }

  parseTopLevelEnd(tk: Token) {
    const top = (): TopCtx | undefined => this.topctx[this.topctx.length - 1]

    // end all lang blocks as well as the topmost block currently open
    while (top()?.type === 'lang') {
      this.topctx.pop()
    }

    var t = top()
    if (!t) {
      this.report(tk, `no block to close`)
      return
    }
    this.emit('return res')
    this.topctx.pop()
    this.emit('})')
  }

  trim_right = false
  parseTopLevel() {
    do {
      var tk = this.next(Ctx.top)

      var txt = tk.prev_text
      if (txt) {
        if (tk.trim_left) {
          txt = txt.trimEnd()
        }
        if (this.trim_right) {
          txt = txt.trimStart()
        }
        if (txt) this.emitText(txt)
      }

      this.trim_right = tk.trim_right

      switch (tk.kind) {
        case T.ExpStart: { this.parseExpression(tk); continue }
        case T.Block: { this.parseTopLevelBlock(tk); continue }
        case T.Raw: { this.parseTopLevelRaw(tk); continue }
        case T.End: { this.parseTopLevelEnd(tk); continue }
        case T.ZEof:
          break
      }
    } while (!tk.isEof)

    console.log(`async function template($, ${DATA}) {
  var r = ''
${this.source}
  return '?'
}`)
    console.log(this.errors)
  }

  /**
   * Just parse the first expression
   */
  parseFirstExpression(): string {
    if (this.pos.offset > 0) throw new Error(`first expression must only be called at the beginning`)
    var start = this.pos
    var tk = this.next(Ctx.top)
    if (tk.kind !== T.ExpStart) {
      this.pos = start
      return ''
    }
    var xp = this.peek()
    if (xp.kind !== T.LBracket) {
      // this is not an expression
      this.pos = start
      return ''
    }

    var result = this.expression(999) // we're only parsing a nud...
    return result
  }

  /**
   * Advance parser if the current token contains the expected one in the expression context
   * and flags an error if not found
   */
  expect(tk: T): Token | null {
    var t = this.next(Ctx.expression)
    if (t.kind === tk) return t
    this.report(t, `unexpected '${t.value}'`)
    this.rewind() // reset the parser
    return null
  }

  expression(rbp: number): Result {
    var ctx = Ctx.expression
    var tk = this.next(ctx)
    if (tk.isEof) {
      // ERROR
    }
    var nud = nuds[ctx][tk.kind]
    if (nud == null) {
      // this is an error ; requesting an expression and not having
      // a way to start it is "problematic". The generated code will
      // be bad.
      this.report(tk, `unexpected ${tk.isEof ? 'EOF' : `'${tk.value}'`}`)

      // This could also be a place to try skip this token and try the next one instead if it makes sense
      // to do so. However, we're not trying to typecheck anything, so we'll just return *something* that
      // looks like an expression and let it fail miserably at runtime instead.
      this.rewind()
      return 'error'
    }

    var res = nud.nud({ parser: this, nud, ctx, tk, rbp })

    // The next in the expression context might fail since we're looking for @ symbols
    tk = this.next(ctx)
    var led = leds[ctx][tk.kind]

    while (led != null && rbp < led.lbp) {
      res = led.led({ parser: this, left: res, led: led, ctx, tk, rbp: led.rbp })

      tk = this.next(ctx)
      led = leds[ctx][tk.kind]
    }

    if (led == null || rbp >= led.lbp) {
      // reset the parser position to before the token if it failed as a led
      this.rewind()
    }

    return res
  }

  error(msg: string) {

  }

  advance() {
    // ignore whitespace ?
  }
}

type Result = string

interface Nud {
  rbp: number
  nud(context: NudContext): Result
}

interface Led {
  rbp: number
  lbp: number
  led(context: LedContext): Result
}

function nud(tk: T, fn: Nud['nud'], ctx: Ctx, rbp = 0) {
  nuds[ctx][tk] = { rbp, nud: fn }
}

function led(lbp: number, tk: T, fn: Led['led'], ctx: Ctx, rbp = lbp) {
  leds[ctx][tk] = { rbp, lbp, led: fn }
}

function xp_nud(tk: T, fn: Nud['nud'], rbp = 0) {
  return nud(tk, fn, Ctx.expression, rbp)
}

function xp_led(lbp: number, tk: T, fn: Led['led'], rbp = lbp) {
  return led(lbp, tk, fn, Ctx.expression, rbp)
}
