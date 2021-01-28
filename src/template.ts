
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

  $$init() {

  }

}
