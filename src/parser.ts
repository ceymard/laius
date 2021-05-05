
/**
This is the parser and code emitter for the laius template language.

The code generation downright abuses the hell out of utf-8 letters and the fact that javascript
pretty much accepts any valid unicode letter for identifiers.
To avoid unintentional name mangling since it is possible to declare local variables with let, the generator generally uses the following symbols ;
  'ℯ' is a shortcut for "expression function". Anything that is to be evaluated before being put into the output.
  'Σ' means plain string to add
  'this' denotes the data/page
  'ε' are all the constants such as pathes
  'φ' (phi) means filter
*/

import { Position, Token, T, Ctx as LexerCtx } from './token'
import { lex } from './lexer'

// import { ω, Σ, ℯ } from './format'
import { Environment, names } from './env'

export type Creator = { repeat?: () => any, init: () => void, postinit: () => void, render: () => string }
export type CreatorFunction = (env: Environment) => Creator

export const enum TokenType {
  string = 0,
  keyword,
  operator,
  type,
  comment,
  variable,
  property,
  macro,
  namespace,
  function,
  number,
  parameter,
}

export const enum TokenModifier {
  readonly = 1,
  defaultLibrary = 1 << 1,
  static = 1 << 2
}

export type BlockFn = {
  (): string
}

// const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor

const STOP_TOP = new Set([T.ZEof])
const STOP_BACKTICK = new Set([T.Backtick])

const LBP: number[] = new Array(T.ZEof)
LBP[T.ArrowFunction] = 210
LBP[T.Dot] = 200
LBP[T.LParen] = 200
LBP[T.LBrace] = 200
// LBP[T.Backtick] = 200
LBP[T.Nullish] = 190
LBP[T.Exclam] = 190 // filter
LBP[T.NullishFilter] = 190
LBP[T.StrictNullishFilter] = 190
LBP[T.LangChoose] = 185
LBP[T.Increments] = 180
LBP[T.Power] = 160
LBP[T.Mul] = 150
LBP[T.Add] = 140
LBP[T.BitShift] = 130
LBP[T.Comparison] = 120
LBP[T.Equal] = 110
LBP[T.BitAnd] = 100
LBP[T.BitXor] = 90
LBP[T.BitOr] = 80
LBP[T.And] = 70
LBP[T.Or] = 60
LBP[T.Question] = 40
LBP[T.Assign] = 30
LBP[T.Colon] = 25
LBP[T.Comma] = 10


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

  _underscore_used = false
  has(name: string): boolean {
    if (!this.names.has(name))
      return this.parent?.has(name) ?? false
    if (name === '_') this._underscore_used = true
    return true
  }

  subScope() {
    const s = new Scope()
    s.parent = this
    return s
  }
}

export class Emitter {
  source: string[] = []
  indent = 1

  pushIndent() { this.indent++ }
  lowerIndent() { this.indent-- }

  constructor(public name: string, public block: boolean) { }

  emit(str: string) {
    var add = '  '.repeat(this.indent) + `${str}`
    this.source.push(add)
  }

  emitExp(contents: string) {
    this.emit(`ℯ(εres, () => ${contents})`)
  }

  emitText(txt: string) {
    this.emit(`Σ(εres, \`${txt.replace(/(\`|\$|\\)/g, '\\$1').replace(/\n/g, '\\n')}\`)`)
  }

  toBlockFunction() {
    return `${this.name}() {
  const εres = []
  let get_parent_block = () => super.${this.name}()
  let get_block = (name) => {
    return this[name]()
  }
${this.source.join('\n')}
  let εfinal_res = εres.join('')
  if (typeof __postprocess !== 'undefined')
    return __postprocess(εfinal_res)
  return εfinal_res
} /* end block ${this.name} */
  `
  }

  toInlineFunction() {
    return `function () {
    const εres = []
  ${this.source.join('\n')}
    return εres.join('')
  } /* end block ${this.name} */
  `
  }

  toSingleFunction(): (() => any) | undefined {
    if (this.source.length === 0) return undefined
    return `function () { ${this.source.join('\n')} }` as any
  }


}

export class Parser {
  errors: LspDiagnostic[] = []
  // source = ''

  /**
   * If false, it means the parser is just running as a language server for token output.
   */
  build = true

  constructor(public str: string, public pos = new Position()) { }

  blocks: Emitter[] = []
  init_emitter = new Emitter('init', false)
  postinit_emitter = new Emitter('postinit', false)
  repeat_emitter = new Emitter('repeat', false)

  parse() {
    var emitter = new Emitter('__main__', true)
    var scope = new Scope()
    this.top_emit_until(emitter, scope, STOP_TOP)
    this.blocks.push(emitter)
  }

  getCreatorFunction(): CreatorFunction {
    // console.log(Env)
    // console.log(Env.prototype)
    // let repeat = this.repeat_emitter.toSingleFunction()
    let body = `
    'use strict'
    // first copy the environment. functions are bound to the environment
      let θparent = null

      function extend(ppath) {
        // extend gets the page and copy its blocks.
        // it must be the first function executed
        let parent = get_page(ppath)
        if (!parent) {
          $$log(ppath, ' was not found')
          return
        }

        θparent = θ.parent = parent
      }

      ${names}

    let θres = {}
    ${this.repeat_emitter.source.length ? `
      θres.repeat = function repeat() {
        ${this.repeat_emitter.source.join('\n')}
      }
    ` : ''}

    θres.init = function () {
      // then create the init / postinit / repeat functions
      ${this.init_emitter.source.join('\n')}

      // and then the blocks
      let εblocks = θ.blocks = new class extends (θparent?.blocks.constructor ?? function () { }) {
        ${this.blocks.map(blk => `/* -- block ${blk.name} -- */ ${blk.toBlockFunction()}`).join('\n\n')}
      }
      if (!εblocks.__render__) {
        εblocks.constructor.prototype.__render__ = εblocks.__main__
      }
    }

    θres.postinit = function () {
      ${this.postinit_emitter.source.join('\n')}
    }

    return θres
`

  try {
    let fn = new Function('εenv', body)
    // console.log(`function _(ω, ℯ, Σ, εenv, εnext) { ${body} })`)

    return (env) => {
      try {
        return fn(env)
      } catch (e) {
        env.$$error(e.message)
      }
    }
  } catch (e) {
    console.log(e.message)
    console.log(`function __creator__(εenv) { ${body} })`)
    throw e
    }
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

  semantic_tokens: {line: number, char: number, length: number, type: TokenType, mods: number}[] = []
  semantic_push(tk: Token, type: TokenType, mods: number = 0) {
    this.semantic_tokens.push({
      line: tk.value_start.line,
      char: tk.value_start.character,
      length: tk.value.length ,
      type: type,
      mods: mods,
    })
  }

  /**
   * Provide the next token in the asked context.
   * FIXME : when next "kills" a token because it moves past it, it should tag it for the LSP.
   */
  next(ctx: LexerCtx): Token {
    let was_rewound = false
    if (this._rewound) {
      was_rewound = true
      var last = this._last_token
      if (last.ctx === ctx) {
        this._rewound = false
        this.pos = last.end
        return last
      }
    }

    do {
      var tk = lex(this.str, ctx, this.pos)
      if (tk.kind === T.Comment) {
        this.semantic_push(tk, TokenType.comment)
      }
      this.pos = tk.end
    } while (tk.can_skip)

    let lt = this._last_token
    if (lt && !was_rewound) {
      switch (lt.kind) {
        case T.Backtick:
        case T.String: { this.semantic_push(lt, TokenType.string) ; break }

        case T.LangChoose: { this.semantic_push(lt, TokenType.macro); break }

        case T.Block:
        case T.ExpStart:
        case T.SilentExpStart:
        case T.Init:
        case T.PostInit:
        case T.Macro:
        case T.Repeat:
          { this.semantic_push(lt, TokenType.type); break }

        case T.Let:
        case T.SilentExpStart:
        case T.Try:
        case T.While:
        case T.For:
        case T.If:
        case T.Else:
          { this.semantic_push(lt, TokenType.keyword); break }

        case T.Literal:
          { this.semantic_push(lt, TokenType.variable, TokenModifier.readonly); break }

        case T.LBrace:
        case T.LParen:
        case T.LBracket:
        case T.RParen:
        case T.RBracket:
        case T.RBrace:
        case T.Colon:
        case T.Nullish:
        // case T.Comma:
        case T.Ellipsis:
        case T.Dot:
        case T.Exclam:
        case T.NullishFilter:
        case T.StrictNullishFilter:
          { this.semantic_push(lt, TokenType.operator); break}

        case T.Date:
          { this.semantic_push(lt, TokenType.number); break }

        case T.Number:
          { this.semantic_push(lt, TokenType.number); break }
      }
      // this is where we emit tokens
    }

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
  top_emit_until(emitter: Emitter, scope: Scope, end_condition: Set<T>, lexctx = LexerCtx.top): Token {
    // FIXME ; how do emitters deal with the text ?

    do {
      var tk = this.next(lexctx)

      var txt = tk.prev_text
      if (txt) {
        // if (tk.kind !== T.ExpStart) {
        //   // If it is anything other than @, we will remove the leading spaces to the start of the line.
        //   // if any other character is encountered, then we keep the space before the % statement.
        //   let i = txt.length - 1
        //   while (txt[i] === ' ' || txt[i] === '\t') { i-- }
        //   if (txt[i] === '\n') {
        //     txt = txt.slice(0, i+1)
        //   }
        // }

        // if (this.trim_right) {
        //   // if we're trimming to the right, we stop at the first '\n' (that we gobble up)
        //   // or we just stop at the first non space character, which we keep
        //   let i = 0
        //   while (txt[i] === ' ' || txt[i] === '\t') { i++ }
        //   if (txt[i] === '\n') {
        //     txt = txt.slice(i+1)
        //   } else if (i > 0) {
        //     txt = txt.slice(i)
        //   }
        // }
        // if (txt)
        emitter.emitText(txt)
      }
      // prevent text from being re-emitted if the token was rewound.
      tk.textWasEmitted()

      this.trim_right = tk.kind !== T.ExpStart

      if (end_condition.has(tk.kind)) {
        //that's it, end of the ride
        return tk
      }

      switch (tk.kind) {
        case T.SilentExpStart:
        case T.ExpStart: { this.top_expression(tk, emitter, scope); continue }
        case T.Macro: { this.top_macro(tk, scope); continue }
        case T.Block: { this.top_block(scope, emitter, tk); continue }
        case T.Raw: { this.top_raw(tk, emitter); continue }

        case T.PostInit:
        case T.Repeat:
        case T.Init: { this.top_init_or_repeat(tk,
          tk.kind === T.Init ? this.init_emitter
          : tk.kind === T.PostInit ? this.postinit_emitter
          : this.repeat_emitter); continue }

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
    emitter.emit(`εenv.__line = ${tk.value_start.line+1}`)
    if (tk.kind === T.SilentExpStart) {
      let xp = this.expression(scope, LBP[T.Exclam] - 1).trim()
      // Remove braces if the expression was encapsulated in them
      if (xp[0] === '{') xp = xp.trim().slice(1, -1)
      emitter.emit(xp)
    } else {
      let nxt = this.peek(LexerCtx.expression)
      let contents = nxt.kind === T.LParen ? (this.commit(), this.nud_expression_grouping(nxt, scope)) : this.expression(scope, LBP[T.LangChoose] - 1)
      emitter.emitExp(contents)
    }
  }

  top_macro(tk: Token, scope: Scope) {
    let pk = this.peek()
    if (pk.kind !== T.Ident) {
      this.report(pk, `macro expects an identifier`)
      return
    }
    this.commit()
    let name = pk.value
    this.semantic_push(pk, TokenType.function)
    pk = this.peek()
    let args = ''
    if (pk.kind === T.LParen) {
      this.commit()
      args = '('
      do {
        let next = this.next(LexerCtx.expression)
        if (next.kind === T.Comma) {
          this.semantic_push(next, TokenType.function)
        } else if (next.kind === T.ZEof) {
          this.report(next, `unexpected end of file`)
          return ''
        } else if (next.kind === T.RParen) {
          this.semantic_push(next, TokenType.function)
          args += ')'
          break
        } else if (next.kind === T.Ident) {
          this.semantic_push(next, TokenType.function)
          scope.add(next.value)
        }
        let nx = next.all_text
        if (next.kind === T.Assign) {
          const res = this.expression(scope, LBP[T.Equal]+1) // higher than comma
          nx += res
        }
        args += nx
      } while (true)
    } else {
      args = '()'
    }

    pk = this.peek()
    let xp = ''
    if (pk.kind !== T.Backtick) {
      this.report(pk, `expected a backtick`)
    } else {
      this.commit()
      xp = this.nud_backtick(scope)
    }
    this.init_emitter.emit(`let ${name} = θ.${name} = function ${name}${args}{ return ${xp} }`)
  }

  top_init_or_repeat(tk: Token, emitter: Emitter) {
    let scope = new Scope()
    let pe = this.peek()
    if (pe.kind !== T.LBracket) {
      this.report(tk, `${tk.value} expects statements surrounded by '{'`)
      return
    }
    this.commit()
    emitter.emit(this.nud_expression_grouping(pe, scope, true).trim().slice(1, -1)) // want a single expression, no operators
  }

  /**
   * @define
   */
  top_block(scope: Scope, emit: Emitter, tk: Token) {
    let nx = this.next(LexerCtx.expression)
    let name = '$$block__errorblock__'
    // console.log(nx)
    if (nx.kind === T.Ident) {
      name = nx.value
      this.semantic_push(nx, TokenType.function)
    } else {
      this.report(nx, 'expected an identifier')
      return
    }

    nx = this.peek(LexerCtx.expression)
    if (nx.kind === T.Backtick) {
      this.commit()
      let block_emit = new Emitter(name, true)
      this.blocks.push(block_emit)
      this.top_emit_until(block_emit, scope, STOP_BACKTICK, LexerCtx.stringtop)
      emit.emitExp(`θparent == null ? get_block('${name}') : ''`)
    } else {
      this.report(nx, 'expected a backtick')
    }

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

    if (nx.isEof) this.report(tk, `missing @end`)
    if (str) emitter.emitText(str)
  }

  /////////////////////////////////////////////////////////////////////////////////////////////
  //                               JS-LIKE EXPRESSION STUFF
  /////////////////////////////////////////////////////////////////////////////////////////////


  expression(scope: Scope, rbp: number): Result {
    var ctx = LexerCtx.expression
    var tk = this.next(ctx)

    var res: string
    switch (tk.kind) {
      case T.LangChoose: { res = this.nudled_lang_chooser(tk, scope); break }
      case T.Backtick: { res = this.nud_backtick(scope); break }
      case T.If: { res = this.nud_if(scope); break }

      case T.Ellipsis: { res = `${tk.all_text}${this.expression(scope, 250)}`; break }

      case T.New: { res = `${tk.all_text}${this.expression(scope, 190)}`; break }

      case T.BitOr:
      case T.Or: { res = this.nud_fn(scope, tk); break }

      case T.Exclam:
      case T.Not:
      case T.Increments:
      case T.Add: { res = `${tk.all_text}${this.expression(scope, 170)}`; break }

      case T.Yield: { res = `${tk.all_text}${this.expression(scope, 20)}`; break }

      case T.Number:
      // case T.Regexp:
      case T.String:
      case T.Semicolon:
      case T.Literal:
      case T.Semicolon: { res = tk.all_text; break }

      case T.Date: { res = `new Date('${tk.value}')`; break }

      case T.LParen:
      case T.LBrace:
      case T.LBracket: { res = this.nud_expression_grouping(tk, scope); break }

      case T.Ident: { res = this.nud_ident(tk, scope, rbp); break }

      case T.Let: { res = this.nud_let(scope, tk); break }

      case T.Return: { res = this.nud_return(tk, scope); break }

      // xp_nud(T.Fn, exp_parse_function)
      // xp_nud(T.Backtick, exp_parse_backtick)

      default:
        this.report(tk, `unexpected ${tk.isEof ? 'EOF' : `'${tk.value}'`}`)
        this.rewind()
        return 'error'
    }

    do {
      tk = this.next(LexerCtx.expression)

      var next_lbp = LBP[tk.kind] ?? -1

      if (rbp >= next_lbp) {
        // this is the end condition. We either didn't find a suitable token to continue the expression,
        // or the token has a binding power too low.
        this.rewind()
        return res
      }

      switch (tk.kind) {
        case T.LangChoose: { res = this.nudled_lang_chooser(tk, scope, res); break }
        case T.Backtick: { res = `${res}`; break }
        case T.ArrowFunction: { res = `${res}${tk.all_text}${this.expression(scope, 28)}`; break } // => accepts lower level expressions, right above colons
        // function calls, filters and indexing
        // case T
        case T.Exclam: { res = this.led_filter(scope, res); break } // ->
        case T.StrictNullishFilter:
        case T.NullishFilter: { res = this.led_nullish_filter(scope, res, tk); break }
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
        case T.Colon: { res = `${res}${tk.all_text}${this.expression(scope, next_lbp)}`; break } // :
        case T.Comma: {
          res = [T.RBrace, T.RParen, T.RBracket].includes(this.peek().kind) ? res : `${res}${tk.all_text}${this.expression(scope, next_lbp)}`; break } // ,

        // SUFFIX
        case T.Increments: { res = `${res}${tk.all_text}`; break } // ++ / -- as suffix
        case T.Question: { res = this.led_ternary(tk, scope, res); break } // ? ... : ...
      }
    } while (true)

  }

  /////////////////////////////////////////////////////////////////////////////////////////////
  //                                    NUD
  /////////////////////////////////////////////////////////////////////////////////////////////

  nud_if(scope: Scope): Result {
    let cond = this.expression(scope, 0)
    let then = this.expression(scope, 0)
    let peek = this.peek()
    if (peek.kind === T.Else) {
      this.commit()
      let els = this.expression(scope, 0)
      return `if (${cond}) ${then} else ${els}`
    }
    return ` if (${cond}) ${then}`
  }

  // ( ... ) grouped expression with optional commas in them
  // This has the potential of messing everything since we're using the same code for
  // { }, ( ) and [ ] and for now it doesn't check for commas.
  // it should !
  nud_expression_grouping(tk: Token, scope: Scope, emit_lines = false): Result {
    var xp = ''
    var right = tk.kind === T.LParen ? T.RParen : tk.kind === T.LBrace ? T.RBrace : T.RBracket
    var iter: Token
    while ((iter = this.peek()).kind !== right && !iter.isEof) {
      var pos = iter.start
      // console.log('!')
      let subexp = this.expression(scope, 0)
      // console.log(subexp)

      xp += emit_lines ? `εenv.__line = ${iter.value_start.line+1}; ` + subexp + ';' : subexp
      if (this.pos.offset === pos.offset) {
        this.report(iter, `unexpected '${tk.value}'`)
        iter = this.next(LexerCtx.expression)
      }
    }
    var paren = this.expect(right)
    return `${tk.all_text}${xp}${paren?.all_text ?? ')'}`
  }

  // Parse ident
  nud_ident(tk: Token, scope: Scope, rbp: number) {
    // console.log(n.rbp)
    var name = tk.value

    if (name === 'this') return `${tk.prev_text}θ`
    // This is a hack so that object properties are detected properly
    let nx = this.peek()
    if (nx.kind === T.LParen) {
      this.semantic_push(tk, TokenType.function)
    } else if (rbp < 200 && !scope.has(name)) { // not in a dot expression, and not in scope from a let or function argument, which means the name has to be prefixed
      // return `${tk.prev_text}θ.${tk.value}`
      this.semantic_push(tk, TokenType.variable)
    } else {
      this.semantic_push(tk, TokenType.property)
    }
    return tk.all_text
  }

  nud_return(tk: Token, scope: Scope) {
    if (this.peek().kind === T.RBrace)
      return tk.all_text
    return `${tk.all_text} ${this.expression(scope, 0)}`
  }

  // Let
  nud_let(scope: Scope, tk: Token) {
    var right = this.next(LexerCtx.expression)
    if (right.kind === T.Ident) {
      if (!scope.add(right.value)) {
        this.report(right, `'${right.value}' already exists in this scope`)
      }
    } else {
      this.report(right, `expected an identifier`)
    }

    return `${tk.prev_text}let ${right.value}`
  }

  nud_backtick(scope: Scope) {
    // Should prevent it from being a block and keep it local
    const name = `__$str_${str_id++}`
    const emit = new Emitter(name, false)
    this.top_emit_until(emit, scope, STOP_BACKTICK, LexerCtx.stringtop)
    // console.log(mkfn(name, src))
    return `(${emit.toInlineFunction()})()`
  }

  // fn
  nud_fn(scope: Scope, tk: Token) {
    var args = '('

    this.semantic_push(tk, TokenType.function)
    if (tk.kind === T.Or) {
      args = '()'
    } else {
      do {
        var next = this.next(LexerCtx.expression)
        if (next.kind === T.Comma) {
          this.semantic_push(next, TokenType.function)
        } else if (next.kind === T.ZEof) {
          this.report(next, `unexpected end of file`)
          return ''
        } else if (next.kind === T.BitOr) {
          this.semantic_push(next, TokenType.function)
          break
        } else if (next.kind === T.Ident) {
          this.semantic_push(next, TokenType.function)
          scope.add(next.value)
        }
        var nx = next.all_text
        if (next.kind === T.Assign) {
          const res = this.expression(scope, 85) // higher than bitor
          nx += res
        }
        args += nx
      } while (true)
      args += ')'
    }

    // Try to see if this is a generator function
    var star = this.peek()
    var has_st = ''
    if (star.value === "*") {
      this.next(LexerCtx.expression)
      has_st = '*'
    }

    let nt = this.next(LexerCtx.expression)
    var xp = ''
    if (nt.kind === T.ArrowFunction) {
      xp = `{ return ${this.expression(scope, 35)} }`
    } else if (nt.kind === T.LBracket) {
      this.rewind()
      xp = this.expression(scope, 200)
    }
    var res = `function ${has_st}${args}${xp}`
    // console.log(args)
    return res
  }

  /////////////////////////////////////////////////////////////////////////////////////////////
  //                                    SPECIAL
  /////////////////////////////////////////////////////////////////////////////////////////////

  nudled_lang_chooser(tk: Token, scope: Scope, left?: Result) {
    // gobble up the right expression, but do not gobble up other lang choosers
    let right = this.expression(scope, LBP[T.LangChoose]+1)
    let langs = tk.value.slice(1).split(/,/g) // remove #
    left = left ?? 'undefined'

    let cond = `(${langs.map(l => `__lang === '${l}'`).join(' || ')})`
    return `(${cond}) ? ${right} : ${left}`
  }

  /////////////////////////////////////////////////////////////////////////////////////////////
  //                                    LED
  /////////////////////////////////////////////////////////////////////////////////////////////

  led_nullish_filter(scope: Scope, left: Result, tk: Token) {
    let filtered = left
    let sub = scope.subScope()
    sub.add('_')

    let filter_xp = this.expression(sub, LBP[T.Exclam])

    // If _ was used in a subsequent filter, turn the filter into a function expression
    if (sub._underscore_used) {
      return `(() => {
        let _ = ${filtered};
        return ${tk.kind === T.NullishFilter ? '_ !== "" && ' : ''}_ != null ? ${filter_xp} : undefined
      })()`
    }

    return `(() => {
      let Ω = ${filtered};
      if (${tk.kind === T.NullishFilter ? 'Ω !== "" && ' : ''}Ω == null) { return undefined }
      let ψ = ${filter_xp};
      return typeof ψ === 'function' ? ψ.call(θ, Ω) : ψ
    })()`
  }

  led_filter(scope: Scope, left: Result) {
    let filtered = left
    let sub = scope.subScope()
    sub.add('_')

    let peek = this.peek()
    let filter_xp = this.expression(sub, LBP[T.Exclam])
    if (peek.kind === T.Ident) {
      this.semantic_push(peek, TokenType.function)
    }

    // If _ was used in a subsequent filter, turn the filter into a function expression
    if (sub._underscore_used) {
      return `(() => {
        let _ = ${filtered};
        return ${filter_xp}
      })()`
    }

    return `(() => {
      let Ω = ${filtered};
      let ψ = ${filter_xp};
      return typeof ψ !== 'function' ? ψ : ψ.call(θ, Ω)
    })()`
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
    var next = this.expression(scope, LBP[T.Question] + 1) // above colon to stop there
    let colon = this.peek()
    if (colon.kind !== T.Colon) {
      return `(${left}${tk.all_text}${next} : undefined)`
    }
    this.commit()
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
