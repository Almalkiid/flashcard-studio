# Golden vectors for the math modules (inputs and outputs only)

Produced by running the CURRENT code (src/utils/math-spans.ts, src/data/data-structures/card/questions/math-cloze.ts,
src/ui/cloze-math-macro.ts, through src/cards/expand.ts for the card expansion) with a scratch runner bundled by esbuild
(`obsidian` stubbed; only the pure parts are exercised). Settings are DEFAULT_SETTINGS with only `latexClozes` /
`convertClozePatternsToInputs` / `clozePatterns` changed, as each file says. All inputs are the spec author's own wording.

Private-use characters are written as JSON `\uXXXX` escapes. Their roles:
``..`` math-mask placeholder brackets (`<index>`);
`` token open, `` token close, `` token separator after the sequence argument, `` key delimiter.
`{"ok": v}` is a returned value, `{"throws": msg}` an exception message. `settingOn` = `latexClozes: true`,
`settingOff` = `latexClozes: false`, `inputsOn` = `latexClozes: true` plus `convertClozePatternsToInputs: true`.

| File | Inputs | Outputs |
|---|---|---|
| math-spans-find.json | note text | spans `{start,end,text}` |
| math-spans-split.json / -split-explicit.json | text (and optional precomputed spans) | `{textOnly, mathOnly}` |
| math-spans-mask.json | text + optional keep regex source (global) | `masked`, and what `restore` returns for the masked text, a foreign string, a bare placeholder, an unknown index |
| math-cloze-contains.json | one line | boolean |
| math-cloze-tokenize.json | text | tokenized text, the `clozes` array, and `restoreMathClozes` of the tokenized text |
| math-cloze-restore-handbuilt.json | hand-built token / key strings against the clozes of `$\cloze[2]{p}{} + \cloze{q}{}$` | restored string |
| math-cloze-expand.json | cloze card text | `[{front,back}]` for the three settings |
| math-cloze-expand-custom-patterns.json | text with `{{ }}` and `==` patterns both enabled | cards, setting on / off |
| math-cloze-formatter.json | a MathClozeFormatter over a stand-in inner formatter (writes `ASK(answer\|hint)` etc.) | each of the three calls |
| math-cloze-legacy.json | text + patterns | `legacyClozeCardIndices` result (null or index array) |
| math-cloze-constants.json | - | the exported pattern string |
| cloze-math-macro.json | stand-in MathJax objects (variants listed per row), macro invocations | registration calls, expansion results, unregister results |

Not covered by vectors (needs a real Obsidian/MathJax): `setClozeMathMacro` (see the spec for its state machine).
