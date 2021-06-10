
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

type Result = string

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
LBP[T.Nullish] = 50
LBP[T.Question] = 40
LBP[T.Exclam] = 32 // filter
LBP[T.OptionalFilter] = 32
LBP[T.NullishFilter] = 32
LBP[T.LangChoose] = 31.5
LBP[T.Assign] = 30
LBP[T.Colon] = 25
LBP[T.Comma] = 10

const LBP_XP: number[] = new Array(T.ZEof)
LBP_XP[T.ArrowFunction] = 210
LBP_XP[T.Dot] = 200
LBP_XP[T.LParen] = 200
LBP_XP[T.LBrace] = 200
LBP_XP[T.Nullish] = 50
LBP_XP[T.Question] = 40
LBP_XP[T.Exclam] = 32 // filter
LBP_XP[T.OptionalFilter] = 32
LBP_XP[T.NullishFilter] = 32
LBP_XP[T.LangChoose] = 31.5

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
  _next_temp_id = 0

  getTempId() { return `εtmp_${this._next_temp_id++}` }
  // source = ''

  /**
   * If false, it means the parser is just running as a language server for token output.
   */
  build = true

  constructor(public str: string, public pos = new Position(), public semantic_token = false) { }

  blocks: Emitter[] = []
  init_emitter = new Emitter('init', false)
  postinit_emitter = new Emitter('postinit', false)
  repeat_emitter = new Emitter('repeat', false)

  parse() {
    var emitter = new Emitter('__main__', true)
    this.top_emit_until(emitter, STOP_TOP)
    this.blocks.push(emitter)
  }

  getCreatorFunction(): CreatorFunction {
    let body = `
    'use strict'
      // first copy the environment. functions are bound to the environment
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
      let εblocks = θ.blocks = new class extends (εenv.θparent?.blocks.constructor ?? function () { }) {
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

  peek(ctx = LexerCtx.expression, skip = true): Token {
    var next = this.next(ctx, skip)
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
    if (!this.semantic_token) return
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
  next(ctx: LexerCtx, skip = true): Token {
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
        if (tk.value.startsWith('/*')) {
          let lines = tk.value.split('\n')
          for (let i = 0, l = lines.length; i < l; i++) {
            let l = lines[i]
            this.semantic_tokens.push({
              line: tk.value_start.line + i,
              char: i === 0 ? tk.value_start.character : 0,
              length: l.length,
              type: TokenType.comment,
              mods: 0
            })
          }
        } else {
          this.semantic_push(tk, TokenType.comment)
        }

      }
      this.pos = tk.end
    } while (skip && tk.can_skip)

    let lt = this._last_token
    if (lt && !was_rewound) {
      switch (lt.kind) {
        case T.Backtick:
        case T.String: { this.semantic_push(lt, TokenType.string) ; break }

        case T.LangChoose: { this.semantic_push(lt, TokenType.macro); break }

        case T.ArrowFunction: { this.semantic_push(lt, TokenType.function); break }

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
        case T.Return:
        case T.Finally:
        case T.Catch:
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
        case T.OptionalFilter:
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
  top_emit_until(emitter: Emitter, end_condition: Set<T>, lexctx = LexerCtx.top): Token {
    // FIXME ; how do emitters deal with the text ?

    do {
      var tk = this.next(lexctx)

      var txt = tk.prev_text
      if (txt) {
        if (tk.kind !== T.ExpStart) {
          // If it is anything other than @, we will remove the leading spaces to the start of the line.
          // if any other character is encountered, then we keep the space before the @@ statement.
          let i = txt.length - 1
          while (txt[i] === ' ' || txt[i] === '\t') { i-- }
          if (txt[i] === '\n') {
            txt = txt.slice(0, i+1)
          }

        }

        if (this.trim_right) {
          // if we're trimming to the right, we stop at the first '\n' (that we gobble up)
          // or we just stop at the first non space character, which we keep
          let i = 0
          while (txt[i] === ' ' || txt[i] === '\t') { i++ }
          if (txt[i] === '\n') {
            txt = txt.slice(i+1)
          }
        }

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
        case T.ExpStart: { this.top_expression(tk, emitter); continue }
        case T.Macro: { this.top_macro(tk); continue }
        case T.Block: { this.top_block(emitter, tk); continue }

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
  top_expression(tk: Token, emitter: Emitter) {
    emitter.emit(`εenv.__line = ${tk.value_start.line+1}`)
    if (tk.kind === T.SilentExpStart) {
      let tk = this.next(LexerCtx.expression)
      let xp = this.nud_expression_grouping(tk, true)
      // let xp = this.expression(LBP[T.Exclam] - 1).trim()
      // Remove braces if the expression was encapsulated in them
      if (xp[0] === '{') xp = xp.trim().slice(1, -1)
      emitter.emit(xp)
    } else {
      let pk = this.peek(LexerCtx.expression, false)
      if (pk.kind === T.Comment) {
        this.commit()
        if (this.semantic_token) {
          this.semantic_push(tk, TokenType.comment)
        }
        return
      }

      let nxt = this.peek(LexerCtx.expression)
      let contents = nxt.kind === T.LParen ? (this.commit(), this.nud_expression_grouping(nxt)) : this.expression(0, LBP_XP)
      emitter.emitExp(contents)
    }
  }

  top_macro(tk: Token) {
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
        }
        let nx = next.all_text
        if (next.kind === T.Assign) {
          const res = this.expression(LBP[T.Equal]+1) // higher than comma
          nx += res
        }
        args += nx
      } while (true)
    } else {
      args = '()'
    }

    pk = this.peek()
    if (pk.kind === T.ArrowFunction) {
      this.commit()
      let xp = this.expression(0)
      this.init_emitter.emit(`θ.${name} = ${name}; function ${name}${args}{ return ${xp} }`)
    } else if (pk.kind === T.LBrace) {
      let xp = this.expression(0)
      this.init_emitter.emit(`θ.${name} = ${name}; function ${name}${args}{ ${xp} }`)
    } else {
      this.report(pk, `expected => or {`)
    }
  }

  top_init_or_repeat(tk: Token, emitter: Emitter) {
    let pe = this.peek()
    if (pe.kind !== T.LBracket) {
      this.report(tk, `${tk.value} expects statements surrounded by '{'`)
      return
    }
    this.commit()
    emitter.emit(this.nud_expression_grouping(pe, true).trim().slice(1, -1)) // want a single expression, no operators
  }

  /**
   * @define
   */
  top_block(emit: Emitter, tk: Token) {
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
      this.top_emit_until(block_emit, STOP_BACKTICK, LexerCtx.stringtop)
      emit.emitExp(`θres.θparent == null ? get_block('${name}') : ''`)
    } else {
      this.report(nx, 'expected a backtick')
    }

  }

  /////////////////////////////////////////////////////////////////////////////////////////////
  //                               JS-LIKE EXPRESSION STUFF
  /////////////////////////////////////////////////////////////////////////////////////////////


  expression(rbp: number, table: number[] = LBP): Result {
    var ctx = LexerCtx.expression
    var tk = this.next(ctx)

    var res: string
    switch (tk.kind) {
      case T.LangChoose: { res = this.nudled_lang_chooser(tk, undefined, table); break }
      case T.Backtick: { res = this.nud_backtick(); break }
      case T.If: { res = this.nud_if(); break }

      case T.Ellipsis: { res = `${tk.all_text}${this.expression(250, table)}`; break }

      case T.New: { res = `${tk.all_text}${this.expression(190, table)}`; break }

      case T.Exclam:
      case T.Not:
      case T.Increments:
      case T.Add: { res = `${tk.all_text}${this.expression(170, table)}`; break }

      case T.Yield: { res = `${tk.all_text}${this.expression(20, table)}`; break }

      case T.Number:
      // case T.Regexp:
      case T.String:
      case T.Semicolon:
      case T.Literal:
      case T.Semicolon: { res = tk.all_text; break }

      case T.Date: { res = `new Date('${tk.value}')`; break }

      case T.LParen:
      case T.LBrace:
      case T.LBracket: { res = this.nud_expression_grouping(tk); break }

      case T.Ident: { res = this.nud_ident(tk, rbp); break }

      case T.Let: { res = this.nud_let(tk); break }

      case T.Return: { res = this.nud_return(tk); break }

      // xp_nud(T.Fn, exp_parse_function)
      // xp_nud(T.Backtick, exp_parse_backtick)

      default:
        this.report(tk, `unexpected ${tk.isEof ? 'EOF' : `'${tk.value}'`}`)
        this.rewind()
        return 'error'
    }

    do {
      tk = this.next(LexerCtx.expression)

      var next_lbp = table[tk.kind] ?? -1

      if (rbp >= next_lbp) {
        // this is the end condition. We either didn't find a suitable token to continue the expression,
        // or the token has a binding power too low.
        this.rewind()
        return res
      }

      switch (tk.kind) {
        case T.LangChoose: { res = this.nudled_lang_chooser(tk, res, table); break }
        case T.Backtick: { res = `${res}`; break }
        case T.ArrowFunction: { res = `${res}${tk.all_text}${this.expression(28, table)}`; break } // => accepts lower level expressions, right above colons
        // function calls, filters and indexing
        // case T
        case T.Exclam: // ->
        case T.OptionalFilter:
        case T.NullishFilter: { res = this.led_filter(res, tk, table); break }

        case T.LParen:
        case T.LBrace: { res = this.led_parse_call(tk, res); break }

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
        case T.Colon: { res = `${res}${tk.all_text}${this.expression(next_lbp, table)}`; break } // :
        case T.Comma: {
          res = [T.RBrace, T.RParen, T.RBracket].includes(this.peek().kind) ? res : `${res}${tk.all_text}${this.expression(next_lbp, table)}`; break } // ,

        // SUFFIX
        case T.Increments: { res = `${res}${tk.all_text}`; break } // ++ / -- as suffix
        case T.Question: {
          res = this.led_ternary(tk, res, table)
          break
        } // ? ... : ...
      }
    } while (true)

  }

  /////////////////////////////////////////////////////////////////////////////////////////////
  //                                    NUD
  /////////////////////////////////////////////////////////////////////////////////////////////

  nud_if(): Result {
    let cond = this.expression(0)
    let then = this.expression(0)
    let peek = this.peek()
    if (peek.kind === T.Else) {
      this.commit()
      let els = this.expression(0)
      return `if (${cond}) ${then} else ${els}`
    }
    return ` if (${cond}) ${then}`
  }

  // ( ... ) grouped expression with optional commas in them
  // This has the potential of messing everything since we're using the same code for
  // { }, ( ) and [ ] and for now it doesn't check for commas.
  // it should !
  nud_expression_grouping(tk: Token, emit_lines = false): Result {
    var xp = ''
    var right = tk.kind === T.LParen ? T.RParen : tk.kind === T.LBrace ? T.RBrace : T.RBracket
    var iter: Token
    while ((iter = this.peek()).kind !== right && !iter.isEof) {
      var pos = iter.start
      // console.log('!')
      let subexp = this.expression(0)
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
  nud_ident(tk: Token, rbp: number) {
    // console.log(n.rbp)
    var name = tk.value

    if (name === 'this') return `${tk.prev_text}θ`

    // If the next token is '(' it means this is a function call, so we tell the editor that
    let nx = this.peek()
    if (nx.kind === T.LParen || nx.kind === T.ArrowFunction) {
      this.semantic_push(tk, TokenType.function)
    } else if (nx.kind === T.Colon) {
      this.semantic_push(tk, TokenType.property)
    } else if (rbp < 200) {
      this.semantic_push(tk, TokenType.variable)
    } else {
      this.semantic_push(tk, TokenType.property)
    }

    if (rbp < 200) {
      // Here we are not right after a '.', which has a pretty high rbp
      // this is where we check that the id being used is _ (or _2, _3 ?) to inform
      // any calling expression that it will have to create a curried version.
      let sec = name.charCodeAt(1)
      if (name[0] === '_' && (name.length === 1 || name.length === 2 &&  sec >= '0'.charCodeAt(0) && sec <= '9'.charCodeAt(0))) {
        // inform the scope chain that a curried version is being called
      }
    }

    return tk.all_text
  }

  nud_return(tk: Token) {
    if (this.peek().kind === T.RBrace)
      return tk.all_text
    return `${tk.all_text} ${this.expression(0)}`
  }

  // Let
  nud_let(tk: Token) {
    var right = this.next(LexerCtx.expression)
    if (right.kind === T.Ident) {
      if (right.value === '_') {
        // throw an error as we disallow _ since this is the curry argument ?
      }
    } else {
      this.report(right, `expected an identifier`)
    }

    return `${tk.prev_text}let ${right.value}`
  }

  nud_backtick() {
    // Should prevent it from being a block and keep it local
    const name = `__$str_${str_id++}`
    const emit = new Emitter(name, false)
    this.top_emit_until(emit, STOP_BACKTICK, LexerCtx.stringtop)
    // console.log(mkfn(name, src))
    return `(${emit.toInlineFunction()})()`
  }

  /////////////////////////////////////////////////////////////////////////////////////////////
  //                                    SPECIAL
  /////////////////////////////////////////////////////////////////////////////////////////////

  nudled_lang_chooser(tk: Token, left: Result | undefined, table: number[]) {
    // gobble up the right expression, but do not gobble up other lang choosers
    let right = this.expression(LBP[T.LangChoose]+1, table)
    let langs = tk.value.slice(1).split(/,/g) // remove #
    left = left ?? 'undefined'

    let cond = `(${langs.map(l => `__lang === '${l}'`).join(' || ')})`
    return `(${cond}) ? ${right} : ${left}`
  }

  /////////////////////////////////////////////////////////////////////////////////////////////
  //                                    LED
  /////////////////////////////////////////////////////////////////////////////////////////////

  /**
   * Parses the filter/pipe expressions '!', '?!' and '??!'
   * Where '!' calls whatever happens, '?!' calls if truthy and '??!' if not null and not undefined
   */
  led_filter(left: Result, tk: Token, table: number[]) {
    let filtered = left

    let filter_xp = this.expression(LBP[T.Exclam], table)

    return `(() => {
      let Ω = ${filtered};
      ${tk.kind === T.Exclam ? ''
        : tk.kind === T.OptionalFilter ? 'if (!is_truthy(Ω)) return undefined'
        : 'if (Ω == null) return undefined'
      }
      return (${filter_xp})(Ω)
    })()`
  }

  led_parse_call(tk: Token, left: Result) {
    var call_xp = tk.all_text
    var righttk = tk.kind === T.LParen ? T.RParen : T.RBrace
    if (this.peek().kind !== righttk) {
      call_xp += this.expression(0)
    }
    var right = this.expect(righttk)
    if (right) {
      call_xp += right.all_text
    }
    return `${left}${call_xp}`
  }

  led_ternary(tk: Token, left: Result, table: number[]): Result {
    let pk = this.peek()
    let named = ''
    if (pk.kind === T.BitOr) {
      this.commit()
      this.semantic_push(pk, TokenType.function)
      let ident = this.expect(T.Ident)
      if (!ident) return ''
      this.semantic_push(ident, TokenType.function)
      named = ident.value
      let t = this.expect(T.BitOr)
      if (t) this.semantic_push(t, TokenType.function)
    }

    var then = this.expression(LBP[T.Colon] + 1, table) // above colon to stop there
    let colon = this.peek()
    let right : string = 'undefined'
    if (colon.kind === T.Colon) {
      this.commit()
      right = this.expression(33, table)
    }
    return `( function () { let εeval = ${left}; ${named ? `let ${named} = εeval ;` : ''} return is_truthy(εeval) ? ${then} : ${right} } )()`
  }

  /////////////////////////////////////////////////////////////////////////////////////////////
  //                                    GENERICS
  /////////////////////////////////////////////////////////////////////////////////////////////


  binary(tk: Token, left: Result, rbp: number) {
    return left + tk.all_text + this.expression(rbp)
  }

  prefix(tk: Token, rbp: number) {
    return tk.all_text + this.expression(rbp)
  }

  suffix(tk: Token, left: Result) {
    return left + tk.all_text
  }

}
