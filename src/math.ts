
import { register_page_plugin, PageSource, Page } from './page'

register_page_plugin('round', function(v: any) {
  return Math.round(v)
})