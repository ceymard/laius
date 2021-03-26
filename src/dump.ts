import { register_page_plugin, PageSource, Page } from './page'

declare module './page' {
  interface Page {
    escape(val: string): string
    stringify(val: any): string
  }
}

register_page_plugin('stringify', function dump_raw(value: any): string { return this.escape(JSON.stringify(value)) })

register_page_plugin('escape', function (val: any): string {
  // Stolen from https://github.com/component/escape-html
  // because there is no need to depend on yet another package for something that short
  let str = (val ?? '').toString()
  var matchHtmlRegExp = /["'&<>]/
  var match = matchHtmlRegExp.exec(str)

  if (!match) {
    return str
  }

  var escape
  var html = ''
  var index = 0
  var lastIndex = 0

  for (index = match.index; index < str.length; index++) {
    switch (str.charCodeAt(index)) {
      case 34: // "
        escape = '&quot;'
        break
      case 38: // &
        escape = '&amp;'
        break
      case 39: // '
        escape = '&#39;'
        break
      case 60: // <
        escape = '&lt;'
        break
      case 62: // >
        escape = '&gt;'
        break
      default:
        continue
    }

    if (lastIndex !== index) {
      html += str.substring(lastIndex, index)
    }

    lastIndex = index + 1
    html += escape
  }

  return lastIndex !== index
    ? html + str.substring(lastIndex, index)
    : html
})

register_page_plugin('dump_html', function (value: any): string {
  let res: string[] = []
  let _ = (v: string) => res.push(v)
  let seen = new Set<any>()
  let process = (val: any) => {
    if (seen.has(val)) return
    seen.add(val)
    let typ = typeof val
    switch (typ) {
      case 'bigint':
      case 'number': { _(`<span class="laius-dump-number">${val}</span>`); return }
      case 'string': { _(`<span class="laius-dump-string">"${this.escape((val as string).replace(/"/g, '\\"'))}"</span>`); return }
      case 'function': { _(`<span class="laius-dump-function">[Function]</span>`); return }
      case 'symbol': { _(`<span class="laius-dump-symbol">${(val as Symbol).toString()}</span>`) }
      case 'undefined':
      case 'boolean': { _(`<span class="laius-dump-boolean">${val}</span>`); return }
    }

    if (val === null || val === undefined) {
      _(`<span class='laius-null'>${val}</span>`)
    } if (val instanceof Map) {

    } else if (val instanceof Set) {

    } else if (Array.isArray(val)) {
      _(`<span class='laius-array'>[`)
      for (let i = 0, l = val.length; i < l; i++) {
        process(val[i])
        if (i < l - 1) _(', ')
      }
      _(`]</span>`)
    } else if (val instanceof Page) {
      _(`<span class='laius-page'>Page `)
      let keys = Object.getOwnPropertyNames(val)
      for (let i = 0, l = keys.length; i < l; i++) {
        process(keys[i])
        _(': ')
        process((val as any)[keys[i]])
        if (i < l - 1) _(', ')
      }
      _('</span>')
    } else if (val instanceof PageSource) {

    } else if (val.constructor === Object) {
      _(`<span class='laius-array'>[`)
      let keys = Object.keys(val)
      for (let i = 0, l = keys.length; i < l; i++) {
        process(keys[i])
        _(': ')
        process(val[keys[i]])
        if (i < l - 1) _(', ')
      }

    } else {
      _(`<span>[[${val.constructor.name} Instance]]</span>`)
    }
  }
  process(value)
  return res.join('')
})


for (let alg of ['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512']) {
  register_page_plugin(alg, function (v: any) {
    let str = (v??'').toString() as string
    let cr = require('crypto') as typeof import('crypto')
    return cr.createHash(alg).update(str).digest('hex')
  })
}
