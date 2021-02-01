
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

export const DATA = `$`
export const WRITE = `w`

//////////////////////////////////


////////////////////////////////////////////////
// JS-like expressions
////////////////////////////////////////////////

// const COMMA_RBP = 10

//////////////////////////////////

var str_id = 0

/**
 * Parse a function declaration
 * fn (arg, ...args) => body
 * fn (arg) {  }
 */


// ? <exp> : <exp>


/////////////////////////////////////////////////////////////////////////

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

    var result = this.expression(new Scope(), 999) // we're only parsing a nud...
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
        arg = \`<span class='laius-error'>\${pos ? \`\${pos.path} \${pos.line}:\` : ''} \${e.message.replace(/\\b\\$\\./g, '')}</span>\`
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
      this._init_fn = new Function(DATA, 'path', cts) as any
      // console.log(this._init_fn?.toString())
    } catch (e) {
      // console.error(this.errors)
      this._init_fn = () => { console.error(`init function didnt parse: ` + e.message) }
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

  expression(scope: Scope, rbp: number): Result {
    var ctx = Ctx.expression
    var tk = this.next(ctx)

    var res: string
    switch (tk.kind) {
      case T.Backtick: { res = this.nud_parse_backtick(scope); break }

      case T.Ellipsis: { res = `${tk.all_text}${this.expression(scope, 250)}`; break }

      case T.New: { res = `${tk.all_text}${this.expression(scope, 190)}`; break }

      case T.Fn: { res = this.nud_parse_function(scope); break }

      case T.Not:
      case T.Increments:
      case T.Add: { res = `${tk.all_text}${this.expression(scope, 170)}`; break }

      case T.Yield: { res = `${tk.all_text}${this.expression(scope, 20)}`; break }

      case T.Number:
      case T.Regexp:
      case T.String:
      case T.Semicolon:
      case T.Literal:
      case T.Semicolon: { res = tk.all_text; break }

      case T.Date: { res = `new Date('${tk.value}')`; break }

      case T.LParen:
      case T.LBrace:
      case T.LBracket: { res = this.nud_expression_grouping(tk, scope); break }

      case T.Ident: { res = this.nud_ident(tk, scope, rbp); break }

      case T.Let: { res = this.nud_let(scope); break }

      // xp_nud(T.Fn, exp_parse_function)
      // xp_nud(T.Backtick, exp_parse_backtick)

      default:
        this.report(tk, `unexpected ${tk.isEof ? 'EOF' : `'${tk.value}'`}`)
        this.rewind()
        return 'error'
    }

    do {
      tk = this.next(Ctx.expression)

      var next_lbp = -1
      switch (tk.kind) {
        case T.ArrowFunction: { next_lbp = 210; break }
        // function calls, filters and indexing
        case T.Dot:
        case T.LParen:
        case T.Filter: // ->
        case T.LBrace: { next_lbp = 200; break }
        case T.Increments: { next_lbp = 180; break } // ++ / --
        case T.Power: { next_lbp = 160; break } // **
        case T.Mul: { next_lbp = 150; break } // * / + %
        case T.Add: { next_lbp = 140; break } // + -
        case T.BitShift: { next_lbp = 130; break } // >> <<
        case T.Comparison: { next_lbp = 120; break } // < >
        case T.Equal: { next_lbp = 110; break } // == === !== !=
        case T.BitAnd: { next_lbp = 100; break } // &
        case T.BitXor: { next_lbp = 90; break } // ^
        case T.BitOr: { next_lbp = 80; break } // |
        case T.And: { next_lbp = 70; break } // &&
        case T.Or: { next_lbp = 60; break } // ||
        case T.Nullish: { next_lbp = 50; break } // ??
        case T.Question: { next_lbp = 40; break } // ?
        case T.Assign: { next_lbp = 30; break } // = &= /= ..
        case T.Colon: { next_lbp = 25; break } // :
        case T.Comma: { next_lbp = 10; break } // ,
      }

      if (rbp >= next_lbp) {
        // this is the end condition. We either didn't find a suitable token to continue the expression,
        // or the token has a binding power too low.
        this.rewind()
        return res
      }

      switch (tk.kind) {
        case T.ArrowFunction: { res = `${res}${tk.all_text}${this.expression(scope, 28)}`; break } // => accepts lower level expressions, right above colons
        // function calls, filters and indexing
        case T.Filter: { res = this.led_filter(scope, res); break } // ->
        case T.LParen:
        case T.LBrace: { res = this.led_parse_call(tk, scope, res); break }

        // BINARY OPERATIONS
        case T.Dot:
        case T.Power:
        case T.Mul:  // * / + %
        case T.Add: // + -
        case T.BitShift:  // >> <<
        case T.Comparison:  // < >
        case T.Equal:  // == === !== !=
        case T.BitAnd:  // &
        case T.BitXor:  // ^
        case T.BitOr:  // |
        case T.And:  // &&
        case T.Or:  // ||
        case T.Nullish: // ??
        case T.Assign:  // = &= /= ..
        case T.Colon: // :
        case T.Comma: { res = `${res}${tk.all_text}${this.expression(scope, next_lbp)}`; break } // ,

        // SUFFIX
        case T.Increments: { res = `${res}${tk.all_text}`; break } // ++ / -- as suffix
        case T.Question: { res = this.led_ternary(tk, scope, res); break } // ? ... : ...
      }

    } while (true)

  }

  /////////////////////////////////////////////////////////////////////////////////////////////
  //                                    NUD
  /////////////////////////////////////////////////////////////////////////////////////////////

  // ( ... ) grouped expression with optional commas in them
  nud_expression_grouping(tk: Token, scope: Scope): Result {
    var xp = ''
    var right = tk.kind === T.LParen ? T.RParen : tk.kind === T.LBrace ? T.RBrace : T.RBracket
    var tk: Token
    while ((tk = this.peek()).kind !== right) {
      var pos = tk.start
      // console.log('!')
      xp += this.expression(scope, 0)
      if (this.pos.offset === pos.offset) {
        this.report(tk, `unexpected '${tk.value}'`)
        tk = this.next(Ctx.expression)
      }
    }
    var paren = this.expect(right)
    return `${tk.all_text}${xp}${paren?.all_text ?? ')'}`
  }

  // Parse ident
  nud_ident(tk: Token, scope: Scope, rbp: number) {
    // console.log(n.rbp)
    var name = tk.value
    if (rbp < 200 || !scope.has(name)) { // not in a dot expression, and not in scope from a let or function argument, which means the name has to be prefixed
      return `${tk.prev_text}${DATA}.${tk.value}`
    }
    return tk.all_text
  }

  // Let
  nud_let(scope: Scope) {
    var right = this.next(Ctx.expression)
    if (right.kind === T.Ident) {
      if (!scope.add(right.value)) {
        this.report(right, `'${right.value}' already exists in this scope`)
      }
    } else {
      this.report(right, `expected an identifier`)
    }

    return ` let ${right}`
  }

  nud_parse_backtick(scope: Scope) {
    // Should prevent it from being a block and keep it local
    const name = `__$str_${str_id++}`
    const emit = this.createEmitter(name, false)
    this.parseTopLevel(Ctx.stringtop)
    const src = emit.source
    this.emitters.delete(name) // HACKY HACKY
    // console.log(mkfn(name, src))
    return `(${mkfn(name, src)})()`
  }

  // fn
  nud_parse_function(scope: Scope) {
    var args = ''
    var star = this.peek()
    var has_st = ''
    if (star.value === "*") {
      this.next(Ctx.expression)
      has_st = '*'
    }
    var t = this.expect(T.LParen)
    args += `${t?.all_text ?? '('}`
    do {
      var next = this.next(Ctx.expression)
      var nx = next.all_text
      if (next.kind === T.Assign) {
        const res = this.expression(scope, 15) // higher than comma
        nx += res
      }
      args += nx
    } while (next.kind !== T.RParen)
    // console.log(args)

    let nt = this.next(Ctx.expression)
    var xp = ''
    if (nt.kind === T.ArrowFunction) {
      xp = `{ return ${this.expression(scope, 35)} }`
    } else if (nt.kind === T.LBracket) {
      this.rewind()
      xp = this.expression(scope, 200)
    }
    var res = `function ${has_st}${args}${xp}`
    // console.log(res)
    return res
  }

  /////////////////////////////////////////////////////////////////////////////////////////////
  //                                    LED
  /////////////////////////////////////////////////////////////////////////////////////////////

  led_filter(scope: Scope, left: Result) {
    var filter_xp = this.expression(scope, 76) // is this priority correct ?
    return `$.filter(${filter_xp}, () => ${left})`
  }

  led_parse_call(tk: Token, scope: Scope, left: Result) {
    var call_xp = tk.all_text
    var righttk = tk.kind === T.LParen ? T.RParen : T.RBrace
    if (this.peek().kind !== righttk) {
      call_xp += this.expression(scope, 0)
    }
    var right = this.expect(righttk)
    if (right) {
      call_xp += right.all_text
    }
    return `${left}${call_xp}`
  }

  led_ternary(tk: Token, scope: Scope, left: Result): Result {
    var next = this.expression(scope, 26) // above colon to stop there
    var colon = this.expect(T.Colon)
    if (!colon) return `throw new Error('invalid expression')`
    var right = this.expression(scope, 28 /* this is probably wrong ? */)

    return `${left}${tk.all_text}${next}${colon.all_text}${right}`
  }

  /////////////////////////////////////////////////////////////////////////////////////////////
  //                                    GENERICS
  /////////////////////////////////////////////////////////////////////////////////////////////


  binary(tk: Token, scope: Scope, left: Result, rbp: number) {
    return left + tk.all_text + this.expression(scope, rbp)
  }

  prefix(tk: Token, scope: Scope, rbp: number) {
    return tk.all_text + this.expression(scope, rbp)
  }

  suffix(tk: Token, left: Result) {
    return left + tk.all_text
  }

}

type Result = string

function mkfn(name: string, src: string) {
  return `function ${name}() {
    var res = ''
    const ${WRITE} = (arg, pos) => {
      if (typeof arg === 'function') {
        try {
          arg = arg()
        } catch (e) {
          arg = \`<span class='laius-error'>\${pos ? \`\${pos.path} \${pos.line}:\` : ''} \${e.message.replace(/\\b\\$\\./g, '')}</span>\`
        }
      }
      res += (arg ?? '').toString()
    }
    ${src}
    return res
  }
`
}