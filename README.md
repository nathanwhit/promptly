# Promptly

A tiny CLI prompt library for deno. Depends only on @std/fmt.

API and implementation largely adapted from [dax](https://github.com/dsherret/dax),
but stripped down to be more minimal (in both code size and scope).
Namely, unlike dax, this is pure JS and focused on prompts.

It does not handle console line wrapping intelligently, instead
leaving that to the terminal.
