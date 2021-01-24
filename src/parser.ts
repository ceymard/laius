
import { log } from 'console'
import { lex } from './lexer'
import { Token, T, Ctx } from './token'

var prio = 2
var nuds: (Nud | undefined)[][] = new Array(Ctx.__max)
var leds: (Led | undefined)[][] = new Array(Ctx.__max)
for (let i = 0; i < Ctx.__max; i++) {
  nuds[i] = new Array(T.ZEof + 1)
  leds[i] = new Array(T.ZEof + 1)
}

//////////////////////////////////


////////////////////////////////////////////////
// JS-like expressions
////////////////////////////////////////////////

xp_led(0, T.BitAnd, binary)

// 200, function calls and indexing

xp_nud(T.LParen, exp_parse_grouping)

xp_led(200, T.Dot, binary)
xp_led(200, T.LParen, exp_parse_call)
xp_led(200, T.LBrace, exp_parse_call)
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
xp_led(90, T.BitXor, binary)
xp_led(80, T.BitOr, binary)
xp_led(70, T.And, binary)
xp_led(60, T.Or, binary)
xp_led(50, T.Nullish, binary)
xp_led(40, T.Question, exp_parse_ternary)
xp_led(30, T.Assign, binary)
xp_nud(T.Yield, prefix, 20)
// const COMMA_RBP = 10

xp_nud(T.Date, exp_parse_date)
xp_nud(T.Ident, exp_ident)
xp_nud(T.Number, exp_all_text)
xp_nud(T.Regexp, exp_all_text)

//////////////////////////////////

function top_parse_if() {
  return ''
}

// ( ... ) grouped expression with optional commas in them
function exp_parse_grouping(l: NudContext): Result {
  var paren = l.parser.expectXp(T.RParen)
  return `${l.tk.all_text}${paren?.all_text ?? ')'}`
}

// ? <exp> : <exp>
function exp_parse_ternary(l: LedContext): Result {
  var p = l.parser
  var next = p.expression(l.led.rbp)
  var colon = p.expectXp(T.Colon)
  if (!colon) return `throw new Error('invalid expression')`
  var right = p.expression(l.led.rbp /* this is probably wrong ? */)

  return `${l.left}${l.tk.all_text}${next}${colon.all_text}${right}`
}

function exp_ident(n: NudContext) {
  // console.log(n.rbp)
  if (n.rbp < 200) { // not in a dot expression, which means the name has to be prefixed
    return `${n.tk.prev_text}v.${n.tk.value}`
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
  return `${l.left} - call`
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

export class Parser {
  errors: string[] = []

  source = `function (ctx) {
  var res = ''
  function _(txt) { res += txt }
  function __(xp) {  }

`

  constructor(public str: string, public pos = 0) { }

  next(ctx: Ctx): Token {
    var tk = lex(this.str, ctx, this.pos)
    console.log(tk)
    this.pos = tk.end
    return tk
  }

  emit(str: string) {
    var add = '  ' + str + '\n'
    // console.log()
    this.source += add
  }

  parseTopLevel() {
    var trim_right = false
    do {
      var tk = this.next(Ctx.top)

      var txt = tk.prev_text
      if (txt) {
        if (tk.trim_left) {
          txt = txt.trimEnd()
        }
        if (trim_right) {
          txt = txt.trimStart()
        }
        if (txt)
          this.emit(`_(\`${txt.replace(/(\`|\$)/g, '\\$1').replace(/\n/g, '\\n')}\`)`)
      }

      trim_right = tk.trim_right

      switch (tk.kind) {
        case T.ExpStart: {
          this.emit(`__(${this.expression(25)})`)
          continue
        }
        case T.ZEof:

      }
    } while (!tk.isEof)
    this.emit(`return res;\n}`) // close the function
    console.log(this.source)
  }

  /**
   * Advance parser if the current token contains the expected one in the expression context
   * and flags an error if not found
   */
  expectXp(tk: T): Token | null {

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
      // is this an error ?
      this.pos = tk.start
      return ''
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
      this.pos = tk.start
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
