import * as util from 'util'
import { token_names, T } from './token-gen'
export { T }

export const enum Ctx {
  top,
  expression,
  __max,
}

export class Token {
  [util.inspect.custom](depth: any, opts: any) {
    return {at: this.start, kind: token_names[this.kind], val: this.value, txt: this.prev_text}
  }

  get trim_right(): boolean {
    var p = Math.max(this.start, this.text_end)
    return this.str[p + 1] === '>' || this.str[p + 2] === '>'
  }

  get trim_left(): boolean {
    var p = Math.max(this.start, this.text_end)
    return this.str[p + 1] === '<'
  }

  get isEof(): boolean {
    return this.kind === T.ZEof
  }

  get value(): string {
    return this.str.slice(Math.max(this.start, this.text_end), this.end)
  }

  get prev_text(): string {
    return this.str.slice(this.start, this.text_end)
  }

  get all_text(): string {
    return this.str.slice(this.start, this.end)
  }

  constructor(
    public str: string,
    public kind: T,
    public text_end: number,
    public start: number,
    public end: number,
    public line: number,
    public col: number) { }
}
