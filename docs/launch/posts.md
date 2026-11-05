# Approval queue: community-specific drafts

All drafts are UNAPPROVED and UNPUBLISHED. Confirm destination, account, wording and attachment before sending. Claims refer to v0.12.1. Replace any conditional section with verified facts before approval. Disclose your relationship; never impersonate a satisfied user.

## A — Existing Obsidian Forum thread

**Destination:** reply to https://forum.obsidian.md/t/flashcard-studio-turn-your-obsidian-notes-into-a-study-workflow/119406

I maintain Flashcard Studio. Here is a small example you can try before setting up a larger deck:

```markdown
#flashcards

What does FSRS stand for::Free Spaced Repetition Scheduler
```

Install Flashcard Studio from Community plugins, then run “Flashcard Studio: Review flashcards from all notes.” Reveal the answer and choose a rating. Obsidian 1.13.1 or later is required.

The attached walkthrough uses existing project screenshots to show review, image occlusion and practice exams. The statistics shown are sample screen data, not measured learning outcomes.

The plugin is free and MIT licensed. Manual cards and review work offline; optional AI generation uses your chosen provider, which may charge separately. Anki import/export transfers supported content, not review schedules or history. Please back up before migrating an existing collection.

If you try the example, which step—installing, making the card or starting a review—could be clearer?

Source and documentation: https://github.com/Almalkiid/flashcard-studio

**Attachment:** walkthrough.mp4. Publish after PR merge so the linked starter documentation is available on main.

## B — Obsidian Discord #updates

I maintain Flashcard Studio, a free MIT-licensed plugin for reviewing flashcards inside your Markdown notes. It includes FSRS reviews, image occlusion and practice exams, with desktop and mobile layouts.

Try a note containing `#flashcards` and `Question::Answer`, then run “Review flashcards from all notes.” Install from Community plugins; requires Obsidian 1.13.1+.

Short screenshot walkthrough attached. I would welcome a concrete example of anything confusing in the first review. Optional AI uses your own provider and may cost extra; it is not needed for manual cards.

https://github.com/Almalkiid/flashcard-studio

**Gate:** check channel rules and previous announcements; post once only.

## C — r/ObsidianMD, only if account is eligible

**Title:** A small Markdown example for trying a note-to-flashcard workflow

Disclosure: I maintain Flashcard Studio.

If your study notes are already in Obsidian, here is the simplest workflow I would suggest testing before importing a whole collection:

1. Create a note with `#flashcards`.
2. Add one line, such as `What does FSRS stand for::Free Spaced Repetition Scheduler`.
3. Run the plugin's review command, reveal the answer and rate your recall.
4. Change the wording in the note when you spot an ambiguous question.

Flashcard Studio adds FSRS review, image occlusion and practice exams to this workflow. It is free and MIT licensed, requires Obsidian 1.13.1+, and manual review works offline. Optional AI generation uses your provider and may incur fees. Development has used AI coding assistance.

The screenshot walkthrough shows the interface, not a promise of learning results. Back up before migration; Anki schedules/history do not transfer, and shared note schedules still need careful syncing.

Source: https://github.com/Almalkiid/flashcard-studio

For people who already study from Markdown notes, is keeping the question next to its source useful, or do you prefer a separate collection?

**Gate:** do not post from a first/only-promotional account. Owner must verify disclosure and current rules. Do not disguise this as an unrelated question.

## D — r/Anki, interoperability rather than replacement

**Title:** Flashcard Studio's Anki transfer: what carries over and what does not

I maintain Flashcard Studio, a free MIT-licensed Obsidian plugin, developed with AI coding assistance. I want to make its Anki compatibility boundaries clear before anyone tries moving a collection.

Supported card content, decks and compatible media can be imported from Anki packages, and cards can be exported to Anki. Review schedules and review history do not transfer. Image-occlusion exports become basic cards with a picture and answer, rather than preserving interactive masks. Back up and test a small deck first.

This is for people who want to write and review cards inside their Markdown notes. It is not a recommendation to abandon a working Anki setup. Optional AI card generation uses your own provider and may cost extra; manual cards do not need it. Obsidian 1.13.1+ is required.

The import/export documentation is here:
https://github.com/Almalkiid/flashcard-studio/blob/main/docs/docs/import-export.md

If you already use both tools, a minimal non-private example of a card that transfers badly would help make the limitations clearer.

**Gate:** recheck self-promotion and market-research rules; no mass requests for decks or private data. Confirm extent of AI involvement with owner before submission.

## E — Developer article / owner's technical profile

**Title:** What changes when flashcards live in Markdown files?

I maintain Flashcard Studio, an MIT-licensed Obsidian plugin. Its starting point is a small text representation: `Question::Answer` in a note tagged `#flashcards`.

That makes cards easy to inspect and edit alongside their source. The trade-off is that scheduling metadata also has to live somewhere. Flashcard Studio writes it in HTML comments after cards and keeps review events in separate per-device monthly files.

Separating review logs reduces competing writes, but it does not make the vault conflict-proof: card schedules still sit in shared notes. Finishing sync before switching devices and avoiding concurrent review of the same note remain important.

Another boundary is interoperability. Anki import/export handles supported content and media, not review schedules/history. Image occlusion exports as basic cards. These are limitations to document, not hide behind a compatibility badge.

The repository includes the source, tests and data-format documentation:
https://github.com/Almalkiid/flashcard-studio

Development has used AI assistance. Manual study works offline; optional AI generation uses the configured provider. I am interested in concrete feedback about the note format and first-card experience.

**Gate:** owner profile permitted after approval; DEV policy must be verified before using DEV.

## F — Current student self-promotion thread only

Disclosure: I maintain Flashcard Studio, a free MIT-licensed Obsidian plugin.

If you already keep study notes in Obsidian, you can try one card without moving your whole workflow. Add `#flashcards` to a note and write `Question::Answer`, then start a review. It also supports hiding labels on diagrams and practice exams made from your cards.

Requires Obsidian 1.13.1+. Manual study works offline and needs no AI account. Optional AI generation may have provider charges. It is a study tool, not a guarantee of higher marks.

Here is a screenshot walkthrough and the source:
https://github.com/Almalkiid/flashcard-studio

**Gate:** only a current thread explicitly permitting this content. The old r/study thread in the research file is evidence of a past format, not a destination to revive.

## G — Productivity audience on owner's profile

A small workflow to try if your study notes already live in Obsidian: turn one important fact into `Question::Answer`, review it, then rewrite the question if it turns out to be vague.

I maintain Flashcard Studio to support that process inside Markdown notes. It adds scheduled reviews, image occlusion and practice exams. Free, MIT licensed; Obsidian 1.13.1+ required. Manual study works offline. AI generation is optional and provider charges may apply.

The attached walkthrough shows existing project screens. Try one card before deciding whether a bigger migration is worth it.

https://github.com/Almalkiid/flashcard-studio

**Gate:** not for r/productivity or r/GetStudying while permission is unverified.

## H — Follow-up framework, not ready to post

Write this only after actual feedback and fixes exist:

- What users reported, with permission before quoting anyone.
- What changed, with a released version and a working link.
- What remains unsupported.
- One short reproduction/example showing the change.

Do not use placeholders as a public update, claim feedback that did not occur, or announce an unmerged PR as shipped.

## Hacker News: owner-authored brief only

HN prohibits generated and AI-edited text and automated posting. Do not paste any draft from this packet there. If choosing Show HN, the owner should independently write why they built it, how to try it, one interesting implementation trade-off, AI involvement where relevant, and the Anki/sync limitations. Link the working repository, not a signup-only page. Be present for discussion. No voting requests or coordinated comments.

## Support response guidance

Acknowledge the specific issue; request only plugin/Obsidian version, device, exact steps and a minimal redacted example. Reproduce before promising a fix. Keep public replies human and useful. Never ask someone to publish a private vault or API key.
