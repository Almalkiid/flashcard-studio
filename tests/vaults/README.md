# Test vaults

Small vaults the unit tests load from disk. What a test asserts depends on their structure, not their wording: the
tags, the `sr-*` frontmatter, the schedule comments, the cards and the links between notes.

| Vault | What it holds |
| --- | --- |
| `filesNoCards` | Two notes with no tags and no cards; one of them links to itself |
| `notes1` | One new note to review |
| `notes2` | A scheduled note (due 2025-02-21) with one new card |
| `notes3` | Four new notes to review (`A` to `D`) linked to each other |
| `notes4` | `notes3`, with `A` already scheduled (due 2023-09-10) |
| `notes5` | `notes4`, with two new cards in `A` |
| `notes6` | One note with two scheduled cloze cards, written with `{{ }}`, and no note schedule |
| `notes7` | A note to review and a note that is not |

Links in `notes3` to `notes5`: `A` to `B`, `C` and `D`; `D` to `A` and twice to `B`; `C` to `D`.
