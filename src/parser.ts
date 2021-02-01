
import { Position, Token, T, Ctx as LexerCtx } from './token'
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

const STOP_TOP = new Set([T.ZEof])
const STOP_LANG = new Set([T.EndLang, T.End, T.ZEof])
const STOP_BLOCK = new Set([T.End])
const STOP_IF_CTX = new Set([T.Elif, T.Else, T.End])
const STOP_LOOPERS = new Set([T.End])
const STOP_BACKTICK = new Set([T.Backtick])

//////////////////////////////////


////////////////////////////////////////////////
// JS-like expressions
////////////////////////////////////////////////

// const COMMA_RBP = 10

//////////////////////////////////

var str_id = 0


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

export class Emitter {
  source = ''
  indent = 1

  pushIndent() { this.indent++ }
  lowerIndent() { this.indent-- }

  constructor(public name: string, public block: boolean) { }

  emit(str: string) {
    var add = '  '.repeat(this.indent) + str + '\n'
    this.source += add
    // console.log()
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

  extends?: string

  constructor(public str: string, public pos = new Position()) { }

  blocks: {name: string, body: string}[] = []

  __creator?: (parent: {[name: string]: BlockFn} | null, $: any, path: string) => {[name: string]: BlockFn}
  getCreatorFunction(): NonNullable<this['__creator']> {
    if (this.__creator) return this.__creator as any
    var emitter = new Emitter('__main__', true)
    var scope = new Scope()
    this.top_handle_until(emitter, scope, STOP_TOP)

    var res = [`var blocks = {...parent}`]

    for (let block of this.blocks) {
      res.push(`blocks.${block.name} = function ${block.name}() {
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
  ${block.body}
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
   * Just parse the first expression
   */
  parseInit(): string {
    if (this.pos.offset > 0) throw new Error(`first expression must only be called at the beginning`)
    var start = this.pos
    var tk = this.next(LexerCtx.top)
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

    var result = this.expression(new Scope(), 999) // we're only parsing a nud that starts with '{'
    return result
  }

  /////////////////////////////////////////////////////////////////////////////////////////////
  //                                    TOKEN HANDLING
  /////////////////////////////////////////////////////////////////////////////////////////////

  peek(ctx = LexerCtx.expression): Token {
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

  _rewound = false

  /**
   * Rewind the parser to the start position of the last token.
   * In effect, the parser needs one token of look-ahead.
   */
  rewind() {
    this.pos = this._last_token!.start
    this._rewound = true
  }

  /**
   * Used if we just peeked and decided that the last token is in fact the last valid one.
   */
  commit() {
    this.pos = this._last_token.end
    this._rewound = false
  }

  _last_token!: Token

  /**
   * Provide the next token in the asked context.
   * FIXME : when next "kills" a token because it moves past it, it should tag it for the LSP.
   */
  next(ctx: LexerCtx): Token {
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
   * Advance parser if the current token contains the expected one in the expression context
   * and flags an error if not found
   */
  expect(tk: T): Token | null {
    var t = this.next(LexerCtx.expression)
    if (t.kind === tk) return t
    this.report(t, `unexpected '${t.value}'`)
    this.rewind() // reset the parser
    return null
  }

  /////////////////////////////////////////////////////////////////////////////////////////////
  //                                    TOP-LEVEL PARSING
  /////////////////////////////////////////////////////////////////////////////////////////////

  trim_right = false

  // Waits for a specific token to occur.
  // As long as it's something else, then keep emitting. If it is, then the token is not consumated and control
  // is given back to the caller.
  // made for __main__, which will wait for ZEof,
  // @block, @for, @while, which wait for @end
  // @lang which waits for @endlang OR @end OR eof
  // and `, which waits for another ` (hence the lexer context)
  // @if, which waits for @elif, @else, and @end
  top_handle_until(emitter: Emitter, scope: Scope, end_condition: Set<T>, lexctx = LexerCtx.top): Token {
    // FIXME ; how do emitters deal with the text ?

    do {
      var tk = this.next(lexctx)

      var txt = tk.prev_text
      if (txt) {
        if (tk.trim_left) {
          txt = txt.trimEnd()
        }
        if (this.trim_right) {
          txt = txt.trimStart()
        }
        if (txt) emitter.emitText(txt)
      }

      this.trim_right = tk.trim_right

      if (end_condition.has(tk.kind)) {
        // Even though the token will be consumed by a caller farther up that may be inside another { } expression
        // this is where the space must be eaten.
        this.rewind()
        //that's it, end of the ride
        return tk
      }

      switch (tk.kind) {
        case T.ExpStart: { this.top_expression(tk, emitter, scope); continue }
        case T.Block: { this.top_block(tk); continue }
        case T.If: { this.top_if(tk, emitter, scope); continue }
        case T.Extend: { this.top_extends(tk); continue }
        // case T.For: { this.top_for(tk); continue }
        // case T.While: { this.top_while(tk); continue }
        case T.Lang: { this.top_lang(emitter, scope); continue }
        case T.Super: { this.top_super(tk, emitter); continue }
        case T.Raw: { this.top_raw(tk, emitter); continue }
        case T.EscapeExp: { emitter.emitText(tk.value.slice(1)); continue }

        default:
          this.report(tk, `unexpected '${tk.value}'`)
          if (tk.isEof) {
            // this is a forced end of the ride. we got there without seeing the end condition
            this.rewind()
            return tk
          }
      }

      // error or not, we must get to the next token
      continue

    } while (true)
  }

    /**
   * @(expression)
   */
  top_expression(tk: Token, emitter: Emitter, scope: Scope) {
    emitter.emit(`${WRITE}(() => ${this.expression(scope, 195)}, {line: ${tk.start.line}, character: ${tk.start.character}, path})`)
  }

  /**
   * @for
   */
  top_for(tk: Token) {

  }

  /**
   * @if
   */
  top_if(tk: Token, emitter: Emitter, scope: Scope) {
    const cond = this.expression(scope, 195)
    emitter.emit(`if (${cond}) {`)
    emitter.pushIndent()

    // if is now looking for @elif, @else or @end
    // FIXME !
  }

  /**
   * @while
   */
  top_while(tk: Token) {

  }

  /**
   * @extends
   */
  top_extends(tk: Token) {
    // get a string, this is only an alternative to $template ?
    let nx = this.peek(LexerCtx.expression)
    if (nx.kind !== T.String) {
      this.report(nx, `expected a string`)
      return
    }
    this.next(LexerCtx.expression)
    this.extends = nx.value.slice(1, -1) // remove the quotes
  }

  /**
   * @define
   */
  top_block(tk: Token) {
    let nx = this.next(LexerCtx.expression)
    let name = '$$block__errorblock__'
    // console.log(nx)
    if (nx.kind === T.Ident) {
      name = nx.value
      // console.error(c.yellow(name))
    } else {
      this.report(nx, 'expected an identifier')
      return
    }

    // It relaunches the top parsing on a new scope and a new emitter and waits for a non-eaten @end
    // after which it stops the emission and writes a new block.
  }

  /**
   * @raw
   */
  top_raw(tk: Token, emitter: Emitter) {
    let str = ''
    let nx: Token

    do {
      // @raw skips basically everything in the top context until it finds
      // @end.
      nx = this.next(LexerCtx.top)
      if (nx.kind === T.End || nx.isEof) {
        str += nx.prev_text
        break
      }
      str += nx.all_text
    } while (true)

    if (this.trim_right) str = str.trimStart()
    if (nx.trim_left) str = str.trimEnd()

    if (nx.isEof) this.report(tk, `missing @end`)
    if (str) emitter.emitText(str)
  }

  /**
   * @super statement
   */
  top_super(tk: Token, emitter: Emitter) {
    if (emitter.name === '__main__' || !emitter.block) {
      this.report(tk, `@super should be inside a block definition`)
      return
    }
    // call the parent block if it exists
    // maybe should print an error if it doesn't...
    emitter.emit(`parent?.${emitter.name}($)`)
  }

  /**
   * Handle @lang
   */
  top_lang(emitter: Emitter, scope: Scope) {
    const next = this.peek(LexerCtx.expression)
    if (next.kind !== T.Ident) {
      this.report(next, `expected an identifier`)
      return
    }
    this.next(LexerCtx.expression)
    emitter.emit(`if (${DATA}.$lang === '${next.value}') {`)
    emitter.pushIndent()

    var ended = this.top_handle_until(emitter, scope, STOP_LANG)
    if (ended.kind === T.EndLang || ended.kind === T.ZEof) {
      // we accept the endlang or end of file and commit them.
      this.commit()
    }
    emitter.lowerIndent()
    emitter.emit('}')
  }

  /////////////////////////////////////////////////////////////////////////////////////////////
  //                               JS-LIKE EXPRESSION STUFF
  /////////////////////////////////////////////////////////////////////////////////////////////


  expression(scope: Scope, rbp: number): Result {
    var ctx = LexerCtx.expression
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
      tk = this.next(LexerCtx.expression)

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
  // This has the potential of messing everything since we're using the same code for
  // { }, ( ) and [ ] and for now it doesn't check for commas.
  // it should !
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
        tk = this.next(LexerCtx.expression)
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
    var right = this.next(LexerCtx.expression)
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
    const emit = new Emitter(name, false)
    this.top_handle_until(emit, scope, STOP_BACKTICK, LexerCtx.stringtop)
    const src = emit.source
    // console.log(mkfn(name, src))
    return `(${mkfn(name, src)})()`
  }

  // fn
  nud_parse_function(scope: Scope) {
    var args = ''
    var star = this.peek()
    var has_st = ''
    if (star.value === "*") {
      this.next(LexerCtx.expression)
      has_st = '*'
    }
    var t = this.expect(T.LParen)
    args += `${t?.all_text ?? '('}`
    do {
      var next = this.next(LexerCtx.expression)
      var nx = next.all_text
      if (next.kind === T.Assign) {
        const res = this.expression(scope, 15) // higher than comma
        nx += res
      }
      args += nx
    } while (next.kind !== T.RParen)
    // console.log(args)

    let nt = this.next(LexerCtx.expression)
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