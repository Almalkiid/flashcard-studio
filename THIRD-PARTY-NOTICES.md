# Third-party notices

Small parts of other projects that Flashcard Studio contains, with where they came from and under which licence.
This file distinguishes embedded source attribution from packaged dependency notices.

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

## Dependency notice review

The cyrb53 attribution above is not a complete inventory of bundled dependencies. Version 0.12.1 declares ankipack, chart.js, clozecraft, fflate, fzstd, minimatch, sql.js, ts-fsrs and ts-fsrs-optimizer as production dependencies. Transitive packages and bundled WebAssembly also need review.

Before claiming that release licensing has been fully verified, inspect the exact lockfile-resolved packages, retain required copyright/license/NOTICE texts, and verify what the release bundle includes. Do not infer redistribution obligations solely from a package's SPDX label. This launch documentation change does not change the project's license or remove existing attribution.

The installed production dependency inventory and available license texts are in [DEPENDENCY-LICENSES.md](DEPENDENCY-LICENSES.md). It includes BlueOak-1.0.0 for minimatch. The installed `@bufbuild/protobuf` package did not contain a top-level license file; its upstream Apache license and the Google BSD notice from `wire/varint` are now reproduced there. Release delivery is still incomplete.

## Focused review — 17 October 2026

See [licensing-review.md](docs/launch/licensing-review.md) for artifact hashes, primary sources, covered notices and remaining gaps. [WASM-NOTICES.md](WASM-NOTICES.md) adds verified sql.js authors and Emscripten/musl texts without claiming complete binary coverage. The released bundle contains generated Anki descriptors with conflicting upstream MIT/AGPL statements; this requires resolution beyond attribution. Existing cyrb53 attribution and the project's MIT license are preserved.
