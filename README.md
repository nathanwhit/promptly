# Promptly

[![JSR](https://jsr.io/badges/@nathanwhit/promptly)](https://jsr.io/@nathanwhit/promptly)

A tiny CLI prompt library for deno. Depends only on @std/fmt.

API and implementation largely adapted from
[dax](https://github.com/dsherret/dax), but stripped down to be more minimal (in
both code size and scope). Namely, unlike dax, this is pure JS and focused on
prompts.

It does not handle console line wrapping intelligently, instead leaving that to
the terminal.

## Examples

A multi-selection prompt:

```ts
import { multiSelect } from "jsr:@nathanwhit/promptly";

const options = ["A", "B", "C"];
const selected = await multiSelect({
  message: "Choose from these options",
  options,
});
console.log(`You chose: ${selected.map((idx) => options[idx]).join(",")}`);
```

A confirmation prompt:

```ts
import { confirm } from "jsr:@nathanwhit/promptly";

if (await confirm("Set up my cool application?")) {
  console.log("Doing setup");
}
```
