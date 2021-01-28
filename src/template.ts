
export interface ParsedTemplate {
  extends: string
  blocks: Map<string, () => string>
  symbols: Map<string, (...args: any[]) => any>
  content: () => string
}

/**
 * A very simple template system
 * {{ ... }} a value that will be outputed as string
 * {% %} some raw javascript
 * {% end %} equivalent to {% } %}, but more readable
 *
 * {% block <name> %}{% end %}
 *
 * {% define <name> %}{% end %}
 * {% include 'some/template.tpl' %}
 * {% macro name(args) %}{% end %} defines a *function*
 *
 * {{ call_macro('pouet') }} // escaped output
 * {< include('something) >} // raw output
 *
 * {% var toto = [1, 2, 3] %}
 * {% for (let f of page.dir.pages) { %}
 */
export class Template {

  $$run() {

  }

  $$init(scope: any) {
    scope.var = 'pouet'
    scope.var = 'zobi'
  }

  $$block$file(dt: any, out: any) {

  }

  $$block$main(dt: any, out: any) {

  }

  // Any other expression takes (scope: any, out: Writer)
  // $$init should be a separate function ?

  // All expressions are inside their own value ?
  // What about potential errors ? Where is the try/catch ?
  // What about promises ?
  $$xp_1(dt: any): any { }
}

// 1. The page has an $$init() function, that takes a scope that already contains the '$lang' property as
// well as all the other variables that have been set in parent $$init() functions if they exist
//
//  .. the $$content() is called, which calls the real content in case the page was extended.
// @extend does the same as $template ?