# Third-party notices

Small parts of other projects that Flashcard Studio contains, with where they came from and under which licence.
Only public-domain, MIT, Apache or BSD sources that are not Obsidian plugins are used this way.

## cyrb53

- **What:** the cyrb53 53-bit string hash function
- **Author:** bryc (github.com/bryc), copyright line in the source: "cyrb53 (c) 2018 bryc"
- **Licence:** public domain. The source file says "License: Public domain (or MIT if needed). Attribution appreciated."
  and the repository's `LICENSE.md` says "Public domain", with MIT (Copyright (c) 2024 bryc) as the fallback for anyone
  who cannot use public-domain works.
- **Source:** https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
- **Used in:** `src/utils/hash.ts`. The mixing steps and constants are bryc's; the result is written as hexadecimal text.
  The output is stored in notes and Anki exports, so it must not change. `src/data/decks/walker.ts` has the same mixing
  as a number (`shuffleKey`), to put cards in a stable shuffle without building the text.
