
import { Token, T, Ctx } from './token'

var prio = 2
var nuds: (Nud | undefined)[][] = new Array(Ctx.__max)
var leds: (Led | undefined)[][] = new Array(Ctx.__max)
for (let i = 0; i < Ctx.__max; i++) {
  nuds[i] = new Array(T.ZEof)
  leds[i] = new Array(T.ZEof)
}


nud(Ctx.top, T.If, function parse_if_toplevel() {
  return ''
})


function binary(c: LedContext) {
  return c.left + c.tk.value + c.parser.expression(c.led.rbp, c.ctx)
}

/////////////////////////////////////////////////////////////////////////

interface BaseContext {
  parser: Parser
  ctx: Ctx
  tk: Token
}

interface NudContext extends BaseContext {
  nud: Nud
}

interface LedContext extends BaseContext {
  led: Led
  left: Result
}

class Parser {
  tokens: Token[] = []
  current = this.tokens[0]
  pos: number = 0
  errors: string[] = []

  expression(rbp: number, ctx: Ctx): Result {
    var nud = this.getNud(ctx)
    if (nud == null) {
      throw new Error()
    }

    var res = nud.nud({parser: this, nud, ctx, tk: this.current})

    var led = this.getLed(ctx)
    if (led == null) {
      // Error condition !
      throw new Error()
    }

    while (rbp < led.lbp) {
      res = led.led({parser: this, left: res, led: led, ctx, tk: this.current})

      led = this.getLed(ctx)
      if (led == null) {
        break
      }
    }
    return res
  }

  getNud(ctx: Ctx): Nud | undefined {
    return nuds[ctx][this.current.kind]
  }

  getLed(ctx: Ctx): Led | undefined {
    return leds[ctx][this.current.kind]
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

function nud(ctx: Ctx, tk: T, fn: Nud['nud'], rbp = prio) {
  nuds[ctx][tk] = { rbp, nud: fn }
}

function led(ctx: Ctx, tk: T, fn: Led['led'], lbp = prio, rbp = lbp) {
  leds[ctx][tk] = { rbp, lbp, led: fn }
}