# Launch-readiness audit — 15 October 2026

Repository inspected at `612b58da474d8903491a6f109266e10fa101d0b1`, version 0.12.1. This is a launch/documentation review, not a full security audit or a certification of independent authorship.

## Outcome

The project has substantial existing features, real screenshots, release assets, tests, issue templates, a contribution guide and a community listing. The immediate opportunity is to make the first card easy and describe limitations accurately. Public promotion and merge remain owner decisions.

| Area               | Evidence / finding                                                                                                               | Action and remaining gap                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Visibility         | GitHub API: 0 stars, 0 forks, no repository topics or homepage at baseline                                                       | Dashboard established; recommend topics below for owner approval                                                                                                   |
| README             | Install section current but far below feature details; broad compatibility and conflict-free claims; unsourced competitor blanks | Added top install/docs links and runnable first-card example; replaced comparison table with clear boundaries                                                      |
| Getting started    | docs/docs/index.md still said listing was pending and repeated BRAT text                                                         | Corrected community install, minimum app version and optional AI costs                                                                                             |
| Card syntax        | README and writing guide placed a blank line directly after `?`, despite documented blank-line termination                       | Removed the blank line from the example and used text fences to preserve literal syntax; repaired a malformed image-occlusion fence; added starter troubleshooting |
| Screenshots        | Existing light/dark, mobile and desktop assets; demo GIF already present                                                         | Preserved originals; added a captioned 30-second screenshot walkthrough, labelled as such                                                                          |
| Screenshot limits  | Existing screen data include study statistics and subject examples                                                               | Do not present as measured outcomes, user counts or verified subject teaching material                                                                             |
| Installation       | Directory entry confirmed in obsidianmd/obsidian-releases; v0.12.1 release contains main.js, manifest.json, styles.css           | Build verified; clean UI install and physical-phone smoke test not executed here                                                                                   |
| Directory status   | Official directory text states plugin has not been manually reviewed by staff                                                    | Added a clear distinction between listing and manual review                                                                                                        |
| Anki compatibility | Import/export docs state schedules do not transfer; image masks become basic exports                                             | Brought restrictions into README and promotional copy; no drop-in replacement claims                                                                               |
| Sync               | Per-device review files coexist with shared note schedule comments                                                               | Removed conflict-proof claims and documented concurrent-use caution                                                                                                |
| Provenance         | README asserted all source original; current files alone cannot prove independent authorship                                     | Replaced unsupported absolute claim; preserved credits and MIT license                                                                                             |
| Dependency notices | Existing file covered cyrb53 only; nine direct production dependencies plus transitive packages                                  | Added exact installed inventory and available license texts; see licensing section                                                                                 |
| Project health     | CI at baseline succeeded; issue templates, contribution guide and conduct policy exist                                           | Avoid redundant scaffolding; no plugin runtime code changed                                                                                                        |
| Community launch   | Owner forum post from 13 October already exists                                                                                  | Prepare a substantive reply rather than duplicate announcement                                                                                                     |
| Analytics          | Public release counters available; traffic endpoint unavailable through connector                                                | Public snapshot collector; no telemetry added; installations remain unknown                                                                                        |

## Licensing readiness

MIT is present and package metadata agrees. The cyrb53 notice is preserved. Its usage is content hashing / Anki identifiers; stable card metadata is separate, so the README's old explanation was too broad.

The installed production inventory contains 13 packages. minimatch declares BlueOak-1.0.0, so the old description listing only public-domain/MIT/Apache/BSD was incomplete. DEPENDENCY-LICENSES.md includes available package license texts. @bufbuild/protobuf declares Apache-2.0 AND BSD-3-Clause but its installed package has no top-level license text. Resolve the exact upstream notices and review embedded WebAssembly provenance before declaring redistribution cleared. Ensure required notices accompany release artifacts; a repository file alone is not a complete distribution review.

History and a package inventory cannot establish that every source file was independently created. No copyright notice was removed and no license was changed. If independent-authorship assurance is required, compare relevant historical sources and retained development evidence; do not treat this audit as that assurance.

## Suggested repository metadata (not applied)

Topics: `obsidian-plugin`, `flashcards`, `spaced-repetition`, `fsrs`, `markdown`, `study-tools`, `anki`.

Homepage: the working community listing, https://community.obsidian.md/plugins/flashcard-studio, until a hosted documentation site is verified. Do not point to a nonexistent GitHub Pages site (has_pages was false).

## Acceptance before wider outreach

- Review and approve PR; confirm documentation and captions accurately reflect the current release.
- Complete clean-vault install → create card → review → reopen on desktop and a physical phone; record versions and any failure.
- Resolve remaining redistribution/provenance questions before describing licensing as fully audited.
- Approve exact external post and attachment; recheck destination rules and account eligibility.

## Sources

- Repository metadata: https://api.github.com/repos/Almalkiid/flashcard-studio
- Releases: https://api.github.com/repos/Almalkiid/flashcard-studio/releases
- Official directory: https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugins.json
- Download statistics: https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugin-stats.json
- Source inspected: README.md, manifest.json, package.json, pnpm-lock.yaml, src/data/card-meta.ts, src/utils/hash.ts, src/import-export/export-collector.ts, docs/docs/import-export.md, docs/docs/data-storage.md, esbuild.config.mjs and workflow files.
- Baseline CI: https://github.com/Almalkiid/flashcard-studio/actions/runs/38490544271

See [campaign](campaign.md), [community rules](communities.md), [drafts](posts.md), [demo](demo.md) and [growth dashboard](dashboard.md).

## Validation results

- Frozen-lockfile dependency installation succeeded with lifecycle scripts disabled.
- Production TypeScript check and build passed.
- Existing unit suite: **185 suites, 4,412 tests passed**.
- Live public snapshot collection succeeded; missing private metrics remain unavailable.
- Video checked as 30 seconds, 1280×720 H.264; caption/layout visually inspected.
- A clean Obsidian GUI installation and physical mobile validation were not performed.
