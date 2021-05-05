
let _md: import('remarkable').Remarkable | undefined
export const I = {
  get sass() {
    return require('sass') as typeof import('sass')
  },
  get sharp() {
    return require('sharp') as typeof import('sharp')
  },
  get md() {
    if (_md === undefined) {
      _md = new ((require('remarkable') as typeof import('remarkable')).Remarkable)('full', { html: true })
    }
    return _md!
  },
  get watch() {
    return ((require('chokidar') as typeof import('chokidar')).watch)
  }
}
