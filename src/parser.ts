
import { Position, Token, T, Ctx } from './token'
import { lex } from './lexer'
import { BlockFn } from './page'
// import * as c from 'colors/safe'

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

export const DATA = `$`
export const WRITE = `w`

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
xp_nud(T.Let, exp_parse_let, 250) //
xp_nud(T.Backtick, exp_parse_backtick)

//////////////////////////////////

var str_id = 0

function exp_parse_backtick(n: NudContext) {

  // Should prevent it from being a block and keep it local
  const name = `__$str_${str_id++}`
  const emit = n.parser.createEmitter(name, false)
  n.parser.pushCtx(n.tk, emit)
  n.parser.parseTopLevel(Ctx.stringtop)
  const src = emit.source
  n.parser.emitters.delete(name) // HACKY HACKY

  return `(${mkfn(name, src)})()`
}

function exp_parse_let(n: NudContext) {
  var right = n.parser.next(Ctx.expression)
  if (right.kind === T.Ident) {
    if (!n.stack.scope.add(right.value)) {
      n.parser.report(right, `'${right.value}' already exists in this scope`)
    }
  } else {
    n.parser.report(right, `expected an identifier`)
  }

  return `${n.tk.all_text}${right}`
}

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

  // var body = ''
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
  stack: StackCtx
}

interface NudContext extends BaseContext {
  nud: Nud
}

interface LedContext extends BaseContext {
  led: Led
  left: Result
}

interface LspPosition {
  line: number
  character: number
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

class Scope {
  names = new Set<string>()
  parent?: Scope

  add(name: string): boolean {
    if (this.names.has(name)) return false
    this.names.add(name)
    return true
  }

  has(name: string): boolean {
    if (!this.names.has(name))
      return this.parent?.has(name) ?? false
    return true
  }

  subScope() {
    const s = new Scope()
    s.parent = this
    return s
  }
}

interface StackCtx {
  token?: Token
  block: string
  emitter: Emitter
  scope: Scope
  close?: () => any
}

export class Emitter {
  source = ''
  indent = 1

  pushIndent() { this.indent++ }
  lowerIndent() { this.indent-- }

  constructor(public name: string, public block = true) { }

  emit(str: string) {
    var add = '  '.repeat(this.indent) + str + '\n'
    this.source += add
    // console.log()
  }

  close() {

  }

  emitText(txt: string) {
    this.emit(`${WRITE}(\`${txt.replace(/(\`|\$|\\)/g, '\\$1').replace(/\n/g, '\\n')}\`)`)
  }

}

export class Parser {
  errors: LspDiagnostic[] = []
  // source = ''

  /**
   * If false, it means the parser is just running as a language server for token output.
   */
  build = true
  emitters = new Map<string, Emitter>()
  stack: StackCtx[] = [{token: null!, emitter: this.createEmitter('__main__'), block: '__main__', scope: new Scope()}]
  emitter: Emitter = this.stack[0].emitter
  extends?: string

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
    this.errors.push(new LspDiagnostic(new LspRange(
      t.value_start,
      t.end,
    ), msg))
    // this.errors.push(`${t.value_start.line+1}: ${msg}`)
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

  createEmitter(name: string, block = true) {
    var emit = new Emitter(name, block)
    this.emitters.set(name, emit)
    return emit
  }

  _stack_top: StackCtx = this.stack[0]
  pushCtx(token: Token, emitter: Emitter = this.emitter) {
    const c: StackCtx = {token, emitter, block: this.stack[this.stack.length -1].block, scope: this.stack[this.stack.length -1].scope}
    this.stack.push(c)
    this._stack_top = c
    this.emitter = emitter
    return c
  }

  popCtx() {
    var c = this.stack.pop()
    c?.close?.()
    this._stack_top = this.stack[this.stack.length - 1]
    this.emitter = this._stack_top.emitter
    return c
  }

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

  /**
   * @(expression)
   */
  parseExpression(tk: Token) {
    this.emitter.emit(`${WRITE}(() => ${this.expression(195)}, {line: ${tk.start.line}, character: ${tk.start.character}, path})`)
  }

  /**
   * @for
   */
  parseTopLevelFor(tk: Token) {

  }

  /**
   * @if
   */
  parseTopLevelIf(tk: Token) {
    const cond = this.expression(195)
    this.emitter.emit(`if (${cond}) {`)
    this.emitter.pushIndent()

    const ct = this.pushCtx(tk)
    ct.close = () => {
      this.emitter.lowerIndent()
      this.emitter.emit(`}`)
    }
  }

  /**
   * @while
   */
  parseTopLevelWhile(tk: Token) {

  }

  /**
   * @extends
   */
  parseExtends(tk: Token) {
    // get a string, this is only an alternative to $template ?
    let nx = this.peek(Ctx.expression)
    if (nx.kind !== T.String) {
      this.report(nx, `expected a string`)
      return
    }
    this.next(Ctx.expression)
    this.extends = nx.value.slice(1, -1) // remove the quotes
  }

  /**
   * @define
   */
  parseTopLevelBlock(tk: Token) {
    let nx = this.next(Ctx.expression)
    let name = '$$block__errorblock__'
    // console.log(nx)
    if (nx.kind === T.Ident) {
      name = nx.value
      // console.error(c.yellow(name))
    } else {
      this.report(nx, 'expected an identifier')
      return
    }

    const st = this.pushCtx(tk, this.createEmitter(name))
    st.scope = new Scope()
  }


  /**
   * @raw
   */
  parseTopLevelRaw(tk: Token) {
    let str = ''
    let nx: Token

    do {
      // @raw skips basically everything in the top context until it finds
      // @end.
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
    if (str) this.emitter.emitText(str)
  }

  /**
   * @super statement
   */
  parseTopLevelSuper(tk: Token) {
    var blk = this.stack[this.stack.length - 1]
    if (blk.block === '__main__') {
      this.report(tk, `@super should be inside a block definition`)
      return
    }
    // call the parent block if it exists
    // maybe should print an error if it doesn't...
    this.emitter.emit(`parent?.${blk.block}($)`)
  }

  parseTopLevelLang(tk: Token) {
    while (this._stack_top.token?.kind === T.Lang) {
      this.popCtx()
    }
    const next = this.peek(Ctx.expression)
    if (next.kind !== T.Ident) {
      this.report(next, `expected an identifier`)
      return
    }
    this.next(Ctx.expression)
    this.emitter.emit(`if (${DATA}.$lang === '${next.value}') {`)
    this.emitter.pushIndent()

    var nc = this.pushCtx(tk)
    nc.close = () => {
      this.emitter.lowerIndent()
      this.emitter.emit('}')
    }
  }

  /**
   * @end statement
   */
  parseTopLevelEnd(tk: Token) {
    const top = (): StackCtx | undefined => this.stack[this.stack.length - 1]

    // end all lang blocks as well as the topmost block currently open
    while (top()?.token?.is_weak_block) {
      this.popCtx()
    }

    var t = top()
    if (!t) {
      this.report(tk, `no block to close`)
      return
    }
    this.popCtx()
  }

  trim_right = false
  _parsed = false
  parseTopLevel(ctx = Ctx.top as Ctx.top | Ctx.stringtop) {
    if (ctx === Ctx.top && this._parsed) return
    this._parsed = true
    do {
      var tk = this.next(ctx)
      // console.log(tk)

      var txt = tk.prev_text
      if (txt) {
        if (tk.trim_left) {
          txt = txt.trimEnd()
        }
        if (this.trim_right) {
          txt = txt.trimStart()
        }
        if (txt) this.emitter.emitText(txt)
      }

      this.trim_right = tk.trim_right

      switch (tk.kind) {
        case T.ExpStart: { this.parseExpression(tk); continue }
        case T.Block: { this.parseTopLevelBlock(tk); continue }
        case T.If: { this.parseTopLevelIf(tk); continue }
        case T.Extend: { this.parseExtends(tk); continue }
        // case T.For: { this.parseTopLevelFor(tk); continue }
        // case T.While: { this.parseTopLevelWhile(tk); continue }
        case T.EndLang: {
          while (this._stack_top.token?.kind === T.Lang) {
            this.popCtx()
          }
          continue
        }
        case T.Lang: { this.parseTopLevelLang(tk); continue }
        case T.Super: { this.parseTopLevelSuper(tk); continue }
        case T.Raw: { this.parseTopLevelRaw(tk); continue }
        case T.End: { this.parseTopLevelEnd(tk); continue }
        case T.EscapeExp: { this.emitter.emit(`${WRITE}('${tk.value.slice(1)}')`); continue }
        case T.Backtick: {
          do {
            // depush anything that was inside the backtick to close them
            if (this.stack.length <= 1) break
            var __c = this.popCtx()
          } while (__c?.token?.kind !== T.Backtick)
          // and stop !
          return
        }
        case T.ZEof:
          break
        default:
          this.report(tk, `'${tk.value}' is not implemented`)
      }
    } while (!tk.isEof)

    while (this.stack.length > 1) {
      this.popCtx()
    }
  }

  /**
   * Just parse the first expression
   */
  parseInit(): string {
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

  __creator?: (parent: {[name: string]: BlockFn} | null, $: any, path: string) => {[name: string]: BlockFn}
  getCreatorFunction(): NonNullable<this['__creator']> {
    if (this.__creator) return this.__creator as any
    this.parseTopLevel()

    var res = [`var blocks = {...parent}`]

    for (let [name, cont] of this.emitters.entries()) {
      res.push(`${cont.block ? `blocks.${name} = ` : ''}function ${name}() {
  var res = ''
  const ${WRITE} = (arg, pos) => {
    if (typeof arg === 'function') {
      try {
        arg = arg()
      } catch (e) {
        arg = \`<span class='laius-error'>\${pos ? \`\${pos.path} \${pos.line}:\` : ''} \${e.message}</span>\`
      }
    }
    res += (arg ?? '').toString()
  }
  ${cont.source}
  return res
} // end ${name}\n`)
    }

    res.push(`blocks.__render__ = parent?.__render__ ?? blocks.__main__`)
    // if there is no parent, remove __main__ to prevent recursion
    // there might be a need for something more robust to handle this case.
    res.push(`if (!parent) delete blocks.__main__`)
    res.push(`return blocks`)
    var src = res.join('\n')

    try {
      const r =  new Function('parent', DATA, 'path', src) as any
      // console.log(r.toString())
      this.__creator = r
      return r
    } catch (e) {
      console.log(src)
      console.error(e.message)
      return (() => { }) as any
    }
  }

  _init_fn?: (dt: any, path: string) => any
  getInitFunction(): (dt: any, path: string) => any {
    if (this._init_fn) return this._init_fn
    var cts = this.parseInit()
    try {
      // console.log(this.emitters, cts)
      this._init_fn = new Function(DATA, 'path', cts) as any
    } catch (e) {
      // console.error(this.errors)
      this._init_fn = () => { console.error(`init function didnt parse`) }
    }
    return this._init_fn!
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

    var res = nud.nud({ parser: this, nud, ctx, tk, rbp, stack: this._stack_top })

    // The next in the expression context might fail since we're looking for @ symbols
    tk = this.next(ctx)
    var led = leds[ctx][tk.kind]

    while (led != null && rbp < led.lbp) {
      res = led.led({ parser: this, left: res, led: led, ctx, tk, rbp: led.rbp, stack: this._stack_top })

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

function mkfn(name: string, src: string) {
  return `function ${name}() {
    var res = ''
    const ${WRITE} = (arg, pos) => {
      if (typeof arg === 'function') {
        try {
          arg = arg()
        } catch (e) {
          arg = \`<span class='laius-error'>\${pos ? \`\${pos.path} \${pos.line}:\` : ''} \${e.message}</span>\`
        }
      }
      res += (arg ?? '').toString()
    }
    ${src}
    return res
  }
`
}