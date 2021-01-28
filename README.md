# Laius, yet another Static Site Generator

Laius tries to strike a good balance between flexibility and intuitivity.

It makes no assumption on what kind content it will generate. In particular, it is
not "blog" oriented. While facilities exist to handle time stamped data, pagination and
taxonomies, the whole architecture of the project is not focused on it.

It uses node.js because while not the fastest kid on the block, it still has decent
performance but mostly allows for using code flexibly in the templates.

Front-matter is in yaml. Content is in markdown.

Unlike a lot of other SSG, laius' content can trigger generation of other files besides
them, since it is meant to be easily extensible.

# Organisation of the directories

There is no particular organisation of directories. No template folder, although there can
be a separation *if desired*.
Bottom line -> it is up to the user to define his own organisation.
Themes and plugins work by adding them to the path, whichever it might be.

Static assets are pulled with a `.asset()` method, not because they're in a particular
directory.

Notion of `path` ; lookups are done relative to the current document / directory.

# Front-matter

Pages define front matter, and `_data.yml` files from upward directories are merged adequately.
All *merged* front matter is always available as `data` in the template context.

Some keys in the front-matter may be pulled by `page` or `dir` and have special meaning. As such, they are
available in both `page` and `data`...

Pages front matter are in yaml format. A file with front matter *must* start with `---`. The front matter
ends with a line starting by `---`.

There can be multiple blocks of matter delimited by `---`. Use the `lang` attribute to change where they will
be merged into.

```
---
template: _base.tpl
title: My great title
---
lang: fr
title: Mon super titre
slug: mon-super-titre-trop-bien # we override the slug for the french version
# template is automatically inherited
---
```

# Drafting

Files with `.draft` before their extension are ignored during generation, but are included while serving in developpement mode.

Files starting with an `_` are always ignored and do not get a matching page output automatically.
In general, templates names should start with an underscore to avoid their corresponding page from being generated.
Pages starting by `_` can however be requested by other pages that may want to render their content.


# Outputting variables

Use `#<expression>` to output a variable. Use `|escape` to escape its content.
An expression ends at the first space that is not part of a sub expression.

`@title|escape`

# Template Syntax

Variables assigned to at the top level will be assigned to the page.data variable and will be usable from
other pages.

## Deviation from javascript

The template expressions are compiled to javascript code, since the template ends up being one big javascript function.
However, for the purposes of templating (and in some instances easier, less ambiguous parsing), some variations were introduced.

- There is no class creation, function creation is different, so are import / exports.
- = operator can no longer be chained and its left side may only contain . [] and ()

### Functions

To disambiguate with javascript, the only way to create functions is through lambdas, whose syntax is a little different.
`fn (args) => exp` or `fn (args) { ... }`.

### Filters

Laius adds an operator `..` which is the filter operator (`|` in many other template languages).
- `@myvar..escape` will make `myvar` go through `escape`s

### Date literals

These don't exist in javascript. In laius, you may use iso 8601-like date literals ;

- `@2020-03-01..date`
- `@2020-03-01T15:00`
- `@2020-03-01T15:00:23`
- `@2020-03-01T12:00Z`
- `@2020-03-01T12:00+01:00`
- `@15:00`

## Cheatsheet

- `@{ }` expression block, will not output anything but allows several statements optionally separated by `;`
- `@2020-12-31->date`
- `@(exp * 2) + 1` parenthesize to prevent expressions from being pulled

- `@include 'name'` includes a template with the current `page` in context.

### Blocks with 'weak' end

These end at the next @end that closes a parent "strong" blocks or at EOF, or at their
own `@endgenerate` / `@endextend` / `@endlang` if they need to be shutoff early.

- `@generate <exp> as '<slug>'` ... `@end / @endgenerate / <EOF>`
- `@extend '<template>'` ... `@end / @endextend / <EOF>` inserts the content of the page that is extended
- `@lang <code>` ... `@end / @endlang / <EOF>` an alias to `@switch lang...` but in weak block form to make it more convenient.

If the page has a variable named '$template' that is defined, then it is considered to have an implicit
`@extend` that encompasses the whole document.

### Blocks with strong ends

These instruction with consume an @end for themselves and thus *need* one.
The end encountered will not close outer weak blocks.

- `@block name` ... `@super` ...  `@end` : defines a block
- `@if exp` ... `@elif exp` ... `@else` ... `@end` : does the classic if / else
- `@switch <exp>` ... `@case <exp>` ... `@else` ... `@end`
- `@for name in exp` ... `@end`
- `@while exp` ... `@end`

## Extend and $template

Inside an extension block, all the contents gets put in the `content` block by default.
When invoking @block inside a extend, this just says that inside content, there will be
a call to the corresponding block.

## Whitespace control

`@<toto` collapse left space
`@>toto` collapse right space
`@<>toto` collapse all surrounding space

If inside an expression, use `SomeText@(my_var)MoreText`

## Escaping

To prevent the characters `@` to create a new expression context, escape it by doubling it `@@`.

# Comments



# Inheritance


# Repeating pages

# Multi-language

Use `@lang <lang>` inside the template to only process content relevant to the given language.
Lang blocks may end with `@endlang` or with another lang block, or with end of file, or with `@end`.

## i18n

Plurals are not handled, but the `date` filter that represents a date is i18n aware and numbers are output by default
in their default number style.

# Values in pages

- `page` : the current page **being rendered**, even in the parent templates
- `dir` : the current directory (with its pages, ready to be filtered)
- `template` : the current template. When including


# Next steps

- Parse expressions and blocks
- Expressions should be guarded (maybe using proxies ?) to prevent null values from crashing the template