import * as util from 'util'
import { token_names, T } from './token-gen'
export { T }

export const enum Ctx {
  top,
  expression,
  stringtop,
  __max,
}

export class Position {
  constructor(
    public line: number = 0,
    public character: number = 0,
    public offset: number = 0,
  ){ }
}

export class Range {
  constructor(
    public start: Position,
    public end: Position,
  ) { }
}

export class Token {
  constructor(
    public str: string,
    public kind: T,
    public start: Position,
    public value_start: Position,
    public end: Position,
    public ctx: Ctx,
  ) { }


  [util.inspect.custom](depth: any, opts: any) {
    return {kind: token_names[this.kind], val: this.value, txt: this.prev_text, start: this.start, end: this.end}
  }

  text_was_emitted = false

  textWasEmitted() {
    this.text_was_emitted = true
  }

  get is_weak_block(): boolean {
    return !this.is_strong_block
  }

  get is_strong_block(): boolean {
    switch (this.kind) {
      case T.If:
      case T.While:
      case T.Switch:
      case T.For:
      case T.Block:
        return true
    }
    return false
  }

  get can_skip(): boolean {
    return this.kind === T.Comment
  }

  get isEof(): boolean {
    return this.kind === T.ZEof
  }

  get value(): string {
    return this.str.slice(this.value_start.offset, this.end.offset)
  }

  get prev_text(): string {
    if (this.text_was_emitted) return ''
    return this.str.slice(this.start.offset, this.value_start.offset)
  }

  get all_text(): string {
    return this.str.slice(this.start.offset, this.end.offset)
  }

}
