# Focused licensing and attribution review — 17 October 2026

## Outcome and scope

The protobuf Apache and Google BSD license texts are now collected and verified. **Release licensing remains unresolved**, chiefly because ankipack's generated Anki files carry AGPL notices while its upstream documentation claims MIT, and because the embedded SQLite extension has no established permission grant in the inspected source. Notice delivery and detailed WebAssembly runtime coverage also remain incomplete. This is a technical evidence review, not legal certification or independent-authorship assurance.

Reviewed PR #1 head `1b329055b781b8f0a55324b3c3d2b87e2a2e7033`, its frozen production dependency installation (13 packages; scripts disabled), upstream version tags, and the actual 0.12.1 release `main.js`. The release tag and PR have identical pnpm-lock.yaml bytes. Changes here are documentation only: the MIT LICENSE, existing license texts, cyrb53 attribution, runtime, dependencies, build and release workflow are preserved. No merge or promotional publication was performed.

## Coverage: repository collection versus delivered release

| Component                                                                             | Already covered before this review                                                                    | Verified correction / remaining gap                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project MIT and cyrb53                                                                | Root LICENSE and THIRD-PARTY-NOTICES.md                                                               | Preserved. Repository attribution is not proof that installed release files deliver it.                                                                                                                                                     |
| @bufbuild/protobuf 2.15.0 — Apache                                                    | Full upstream Apache text already in DEPENDENCY-LICENSES.md                                           | Matched v2.15.0 LICENSE; corrected misleading inventory “missing” status. Apache text is absent from released main.js.                                                                                                                      |
| @bufbuild/protobuf — Google BSD                                                       | Header present in installed wire/varint.js, but not collected in PR notices                           | Added complete Google 2008 BSD header, including its generated-code paragraph. No separate NOTICE file found in upstream tag/package. Release lacks this header.                                                                            |
| @kurkle/color, chart.js                                                               | Full packaged MIT texts                                                                               | Verified unchanged. Release keeps short MIT-labelled copyright banners, not full permission/disclaimer text. Preserve both packaged and banner credits (color package 2018–2024 vs banner 2024; Chart.js package 2014–2024 vs banner 2025). |
| ankipack, balanced-match, brace-expansion, clozecraft, fflate, fzstd, sql.js, ts-fsrs | Full packaged MIT texts                                                                               | All matched installed files. These package texts do not establish licenses for every embedded/generated component. Release has no full MIT permission text.                                                                                 |
| minimatch 10.2.6                                                                      | Full BlueOak-1.0.0 text                                                                               | Verified. Release main.js contains neither this text nor its required-license-link alternative.                                                                                                                                             |
| ts-fsrs-optimizer 0.1.2                                                               | Full BSD-3-Clause text, both Open Spaced Repetition and ihv-forge copyright lines, fsrs-rs derivation | Verified. This package is JavaScript/TypeScript, not an optimizer WASM binary. Release lacks its collected copyright/conditions/disclaimer.                                                                                                 |
| ankipack generated Anki code                                                          | Package MIT label only; no generated-file attribution in PR notice collection                         | Added observed Ankitects attribution and explicit conflict. All nine file descriptors occur in the released bundle. Permission/terms remain unresolved; attribution alone is insufficient.                                                  |
| sql.js authors and Emscripten/musl                                                    | sql.js MIT text including Makefile credit                                                             | Added sql.js AUTHORS and upstream Emscripten LICENSE/musl COPYRIGHT to WASM-NOTICES.md. Per-file linked runtime coverage remains open.                                                                                                      |
| extension-functions.c                                                                 | Not separately identified                                                                             | Exact source hash matched upstream build recipe; no explicit license grant found. SQLite core's public-domain statement cannot simply be extended to this separately contributed file.                                                      |

“Covered” in this table means text collected in the PR, not certified delivery or satisfaction of all license conditions.

## Protobuf: source of the BSD component

Official protobuf-es v2.15.0 resolves to `f72f5295c853b7be8c0828f350e4f2803c8afdde`. Its package declares `(Apache-2.0 AND BSD-3-Clause)`, not a choice of either license. `packages/protobuf/src/wire/varint.ts` carries Google's 2008 three-clause BSD notice and links to the original Protocol Buffers implementations. The installed ESM and CJS `wire/varint.js` retain the same header; `wire/binary-encoding.js` imports its reader functions. The package's license-header script explicitly excludes this file.

The full Apache license was already present in this PR. The missing documentation was the separate Google BSD attribution, conditions and disclaimer. The root license and recursive tag/package filename inspection found no separate NOTICE file; this does not waive Apache section 4 or other applicable obligations. A missing top-level package LICENSE is not evidence that no licenses occur within distributed files.

Sources: [package metadata](https://github.com/bufbuild/protobuf-es/blob/f72f5295c853b7be8c0828f350e4f2803c8afdde/packages/protobuf/package.json), [varint source and header](https://github.com/bufbuild/protobuf-es/blob/f72f5295c853b7be8c0828f350e4f2803c8afdde/packages/protobuf/src/wire/varint.ts), [Apache LICENSE](https://github.com/bufbuild/protobuf-es/blob/f72f5295c853b7be8c0828f350e4f2803c8afdde/LICENSE).

## Material conflict: ankipack's generated Anki descriptors

Official ankipack v0.3.1 resolves to `36d3bcc459f52f53eb47dd64a9b7e880ca47c4ba`. Its root LICENSE and package metadata say MIT. Its `proto/LICENSE` acknowledges AGPL-3.0-or-later for the Anki input schemas, but asserts the generated code is distributed under MIT. Conversely, its generated TypeScript source and published JavaScript files explicitly retain:

```text
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
```

The exact base64 `fileDesc` argument from each of these installed files occurs in released main.js: `cards_pb.js`, `collection_pb.js`, `deck_config_pb.js`, `decks_pb.js`, `generic_pb.js`, `import_export_pb.js`, `notes_pb.js`, `notetypes_pb.js`, `sync_pb.js`. This establishes inclusion of descriptor content, not that every generated export survived tree shaking. The release contains no “Ankitects” or “GNU AGPL” text.

**Unknown:** whether the generated material is copyrightable/derivative in the relevant circumstances, and what authorization or exception supports upstream's MIT assertion. No verified separate grant resolving the conflicting statements was established. Do not silently resolve this in favor of either label, claim that Flashcard Studio must automatically be relicensed, or claim that merely adding AGPL attribution is enough. If AGPL applies, source/distribution obligations can go beyond notices. Obtain a documented rights/terms basis or an independently reviewed replacement approach before claiming release licensing cleared. This review neither contacts upstream nor changes the project's MIT license.

Sources: [upstream proto/LICENSE](https://github.com/ImGajeed76/ankipack/blob/36d3bcc459f52f53eb47dd64a9b7e880ca47c4ba/proto/LICENSE), [root MIT LICENSE](https://github.com/ImGajeed76/ankipack/blob/36d3bcc459f52f53eb47dd64a9b7e880ca47c4ba/LICENSE), [generated import/export source](https://github.com/ImGajeed76/ankipack/blob/36d3bcc459f52f53eb47dd64a9b7e880ca47c4ba/src/generated/anki/import_export_pb.ts), [Anki input schema](https://github.com/ImGajeed76/ankipack/blob/36d3bcc459f52f53eb47dd64a9b7e880ca47c4ba/proto/anki/import_export.proto).

## WebAssembly: identified binary and unresolved native components

`src/import-export/sql-loader.ts` imports `sql.js/dist/sql-wasm-browser.wasm`. The build deflates and base64-embeds it in main.js. Decoding the actual release found one WASM payload, **658,410 bytes**, byte-identical to the installed sql.js 1.14.2 browser binary:

```text
SHA-256 38c14f6e379210bc942bdc4ebca44e7bfdb4318ecc1c72ca666a28fdce96670a
```

Running that same binary with the sql.js wrapper returned SQLite `3.49.1`; `reverse('abc')`, `square(3)` and `median(1,3)` (aggregate over two rows) returned `cba`, `9`, `2`. This confirms functioning bundled extension routines, not just a build-file reference.

The sql.js v1.14.2 Makefile links SQLite 3.49.1 and `extension-functions.c`. The retrieved extension source SHA-1 matches its pinned build checksum exactly: `c68fa706d6d9ff98608044c00212473f9c14892f`. It credits Liam Healy, relicoder and others but contains no explicit license/permission/public-domain declaration. **The permission basis for this contributed extension remains unverified.** The sql.js MIT package label and SQLite core's public-domain status do not by themselves resolve it.

The release action uses a Dockerfile pinning Emscripten 5.0.0, although the Makefile contains an old 2.0.15 comment. Added upstream Emscripten license and musl copyright overview as a conservative notice collection. Emscripten includes runtime code with its own MIT/NCSA terms and a Node.js attribution; musl's overview references further per-file math and other notices. A linked-object/build manifest or reproducible build is still needed to enumerate applicable per-file notices and any compiler runtime exceptions accurately. No claim is made that all Emscripten source components ship, or that the overview covers every linked routine.

The other installed sql.js WASM variants are not the embedded payload. The lockfile's `7z-wasm`, `@open-spaced-repetition/binding-wasm32-wasi` and resolver WASM entries belong to development/test tooling; source inspection found no production imports of those binaries. The optimizer production dependency itself has no WASM file. A lockfile match alone is not evidence of release inclusion.

Sources: [sql.js Makefile](https://github.com/sql-js/sql.js/blob/9c4e167ec37129192d166ab9223faa9a4bd07c58/Makefile), [Dockerfile](https://github.com/sql-js/sql.js/blob/9c4e167ec37129192d166ab9223faa9a4bd07c58/.devcontainer/Dockerfile), [build action](https://github.com/sql-js/sql.js/blob/9c4e167ec37129192d166ab9223faa9a4bd07c58/.github/actions/build-sqljs/action.yml), [extension source](https://www.sqlite.org/contrib/download/extension-functions.c?get=25), [SQLite core copyright statement](https://www.sqlite.org/copyright.html), [Emscripten 5.0.0 license](https://github.com/emscripten-core/emscripten/blob/be68a767ff3937d97ffc7996a24bd3d7e7f9c849/LICENSE), [musl copyright overview](https://github.com/emscripten-core/emscripten/blob/be68a767ff3937d97ffc7996a24bd3d7e7f9c849/system/lib/libc/musl/COPYRIGHT).

## Released artifacts: concrete delivery gap

The 0.12.1 release API lists only `main.js`, `manifest.json`, `styles.css`. Downloaded main.js is **1,442,936 bytes**, with SHA-256 matching GitHub's asset digest:

```text
8714e5e528ba0df92c9c05ab64e99cdbb6e6005a68a35fe108a7d86cd98cfd0d
```

Its trailing “Bundled license information” contains short @kurkle/color and Chart.js banners and a ts-fsrs coverage-tool comment. It does not contain the collected Apache license, Google's BSD header, the optimizer BSD text, full MIT permission text, or the BlueOak text/link. The release workflow copies and uploads only the three files; it does not package the PR's notices. These repository additions do not retroactively modify release 0.12.1 or prove notices reach installed plugin users. This was a main.js inspection and release asset-list/workflow review, not a claim that every historical distribution channel was inspected.

After resolving permission questions, a release change should carry the verified notice collection in material actually delivered to users—such as a retained comment in main.js for the three-file installation path—and verify it after minification and installation. A separate GitHub notice attachment alone does not establish delivery through Obsidian/BRAT. Preserve required copyright, permission, disclaimer and any applicable modification notices. That build/release implementation is outside this documentation-only correction and remains unapplied.

Sources: [release 0.12.1](https://github.com/Almalkiid/flashcard-studio/releases/tag/0.12.1), [release main.js](https://github.com/Almalkiid/flashcard-studio/releases/download/0.12.1/main.js), [workflow at reviewed head](https://github.com/Almalkiid/flashcard-studio/blob/1b329055b781b8f0a55324b3c3d2b87e2a2e7033/.github/workflows/release.yml), [build configuration](https://github.com/Almalkiid/flashcard-studio/blob/1b329055b781b8f0a55324b3c3d2b87e2a2e7033/esbuild.config.mjs).

## Completion checks and remaining decisions

- Completed: checked all 12 packaged license texts and protobuf Apache text against sources; added Google BSD header, generated-file attribution/conflict and verified WASM notice texts; preserved existing MIT and attribution.
- Completed: confirmed released main.js digest, matched embedded WASM bytes, tested SQLite/extension identity, and matched all nine generated Anki descriptors in the actual release.
- Remaining: resolve ankipack's conflicting rights statements and extension-functions.c permission basis; enumerate applicable runtime per-file notices against the linked binary; implement and verify notice delivery in a later approved release change.
- Documentation verification: copied notice comparisons (ignoring trailing whitespace), unchanged original license blocks/root LICENSE, documentation-only diff and whitespace check. The earlier 185 suites/4,412 tests belong to the original PR validation; they were not rerun or presented as validating these licensing conclusions.
