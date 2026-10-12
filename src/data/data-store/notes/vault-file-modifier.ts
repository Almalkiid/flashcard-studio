import { Notice, TFile, Vault } from "obsidian";

import { IFileModifier } from "src/data/data-store/store";
import { VaultNoteFile } from "src/data/data-structures/file/vault-note";
import { t } from "src/lang/translate";
import FlashcardStudioPlugin from "src/studio-plugin";
import { withoutFrontmatterTags } from "src/utils/frontmatter-tags";
import { escapeRegex } from "src/utils/text";

// The schedule-comment and frontmatter format shared with the Spaced Repetition plugin, kept so existing schedules carry over.
// A schedule comment and the one white space in front of it; a line ending of two characters counts as one
const CARD_COMMENT_AND_SPACE = /(?:\r\n|\s)?<!--SR:!.+?-->/g;
const CARD_COMMENT = /<!--SR:!.+?-->/g;
const METADATA_CALLOUT_HEADER = "> [!sr|card-metadata]";

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s/;
const NOTE_SCHEDULE_KEYS = ["sr-due", "sr-interval", "sr-ease"];

/**
 * Calls `change` for each line outside fenced code blocks (``` or ~~~), with the line without its ending and the index
 * of the line; a line it returns null for stays as it is. Every line keeps its own ending.
 */
function mapLinesOutsideCode(
    text: string,
    change: (line: string, index: number, lines: string[]) => string | null,
): string {
    const parts = text.split(/(\r\n|\r|\n)/);
    const lines = parts.filter((_part, i) => i % 2 === 0);
    let fence: string | null = null;
    let result = "";
    lines.forEach((line, index) => {
        const own = parts[index * 2 + 1] ?? "";
        const opens = FENCE.exec(line)?.[1];
        let changed: string | null = null;
        if (fence === null) {
            if (opens !== undefined) fence = opens;
            else changed = change(line, index, lines);
        } else if (
            opens !== undefined &&
            opens[0] === fence[0] &&
            opens.length >= fence.length &&
            line.trim() === opens
        ) {
            fence = null;
        }
        result += (changed ?? line) + own;
    });
    return result;
}

/**
 * The text without the given tags, outside fenced code. A tag takes its nested tags with it (`#flashcards` removes
 * `#flashcards/cia`) but not a longer tag that starts the same (`#flashcards-extra`), and only a tag that starts a
 * word is one: the `#flashcards` in `a#flashcards` or in a link address stays.
 */
function withoutTags(text: string, tags: string[]): string {
    const patterns = tags.map(
        (tag) =>
            new RegExp(
                `(^|\\s)${escapeRegex(tag)}(?:/[\\p{L}\\p{N}_/-]+)?(?![\\p{L}\\p{N}_-])`,
                "gu",
            ),
    );
    return mapLinesOutsideCode(text, (line) =>
        patterns.reduce((remaining, pattern) => remaining.replace(pattern, "$1"), line),
    );
}

/** Whether a line is a row of a table or an item of a list, or goes on with one (indented). */
const continuesStructure = (line: string | undefined): boolean =>
    line !== undefined &&
    line.trim() !== "" &&
    (line.trimStart().startsWith("|") || LIST_ITEM.test(line) || /^\s/.test(line));

/**
 * The text with every schedule comment that is not in a callout moved into a metadata callout under its line:
 * `Q::A <!--SR:...-->` becomes `Q::A`, then `> [!sr|card-metadata]` and `> <!--SR:...-->`. A comment already in a
 * quote stays, so a second run changes nothing, and so does a comment in fenced code. A comment in a table or a list
 * whose next line goes on with it stays too, as a callout there would cut the table or the list in two; those are
 * counted in `skipped`. Every line keeps its own line ending.
 */
export function moveCommentsIntoCalloutsCounting(text: string): { text: string; skipped: number } {
    if (!text.includes("<!--SR:!")) return { text, skipped: 0 };

    const parts = text.split(/(\r\n|\r|\n)/);
    let ending = "\n";
    let skipped = 0;
    const moved = mapLinesOutsideCode(text, (line, index, lines) => {
        const own = parts[index * 2 + 1] ?? "";
        if (own !== "") ending = own;
        const comments = line.trimStart().startsWith(">") ? null : line.match(CARD_COMMENT);
        if (comments === null) return null;
        const rest = line.replace(CARD_COMMENT_AND_SPACE, "");
        const loneComment = rest.trim() === "";
        if (
            continuesStructure(lines[index + 1]) &&
            continuesStructure(loneComment ? lines[index - 1] : rest)
        ) {
            skipped++;
            return null;
        }
        return loneComment
            ? `${METADATA_CALLOUT_HEADER}${ending}> ${line}`
            : `${rest}${ending}${METADATA_CALLOUT_HEADER}${ending}> ${comments.join(`${ending}> `)}`;
    });
    return { text: moved, skipped };
}

export const moveCommentsIntoCallouts = (text: string): string =>
    moveCommentsIntoCalloutsCounting(text).text;

/** Edits many notes of the vault at once. */
export class NoteDataFileModifier implements IFileModifier {
    constructor(private readonly plugin: FlashcardStudioPlugin) {}

    private get vault(): Vault {
        return this.plugin.app.vault;
    }

    /** The note's text changed by `change`, in one step; a note whose text stays the same is not written. */
    private rewrite(vault: Vault, file: TFile, change: (text: string) => string): Promise<boolean> {
        const { metadataCache, fileManager } = this.plugin.app;
        return new VaultNoteFile(vault, metadataCache, fileManager, file).edit((text) => {
            const changed = change(text);
            return changed === text ? null : changed;
        });
    }

    /** The frontmatter Obsidian has read from the note; it says what is there without opening the file. */
    private frontmatterOf(file: TFile): Record<string, unknown> {
        return this.plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    }

    /** Runs `job` on each note of the vault, one after the other, then says the data is gone. */
    private async forEveryNote(job: (file: TFile) => Promise<void>): Promise<void> {
        for (const file of this.vault.getMarkdownFiles()) await job(file);
        this.announceDeletion();
    }

    private announceDeletion(): void {
        new Notice(t("SCHEDULING_DATA_HAS_BEEN_DELETED"));
    }

    async removeSchedulingInfoInCards(
        vault: Vault,
        file: TFile,
        deleteTags: boolean,
        tagsToDelete: string[],
    ): Promise<void> {
        await this.rewrite(vault, file, (text) =>
            text.includes("<!--SR:") ? text.replace(CARD_COMMENT_AND_SPACE, "") : text,
        );
        if (!deleteTags) return;
        await this.removeTagsFromFile(vault, file, tagsToDelete);
    }

    async removeSchedulingInfoInNotes(
        vault: Vault,
        file: TFile,
        deleteTags: boolean,
        tagsToDelete: string[],
    ): Promise<void> {
        // The frontmatter keys of the shared note format (see above). A note without them is not opened.
        const fields = this.frontmatterOf(file);
        if (NOTE_SCHEDULE_KEYS.some((key) => key in fields)) {
            await this.plugin.app.fileManager.processFrontMatter(
                file,
                (frontmatter: Record<string, unknown>) => {
                    NOTE_SCHEDULE_KEYS.forEach((key) => delete frontmatter[key]);
                },
            );
        }
        if (!deleteTags) return;
        await this.removeTagsFromFile(vault, file, tagsToDelete);
    }

    async removeTagsFromFile(vault: Vault, file: TFile, tags: string[]): Promise<void> {
        await this.removeTagsFromFrontmatter(vault, file, tags);
        await this.rewrite(vault, file, (text) => withoutTags(text, tags));
    }

    async removeTagsFromFrontmatter(_vault: Vault, file: TFile, tags: string[]): Promise<void> {
        // Only a note that has one of the tags in its frontmatter is rewritten
        const declared = this.frontmatterOf(file)["tags"];
        const all = withoutFrontmatterTags(declared, []);
        if (all === undefined || withoutFrontmatterTags(declared, tags)?.length === all.length) {
            return;
        }
        await this.plugin.app.fileManager.processFrontMatter(
            file,
            (fields: Record<string, unknown>) => {
                // Notes without tags, or with tags written as one string, used to throw here
                const kept = withoutFrontmatterTags(fields["tags"], tags);
                if (kept !== undefined) fields["tags"] = kept;
            },
        );
    }

    async deleteAllSchedulingData(
        deleteTags: boolean,
        deckTags: string[],
        noteTags: string[],
    ): Promise<void> {
        const { vault } = this;
        await this.forEveryNote(async (file) => {
            await this.removeSchedulingInfoInNotes(vault, file, deleteTags, noteTags);
            await this.removeSchedulingInfoInCards(vault, file, deleteTags, deckTags);
        });
    }

    async deleteAllSchedulingDataInCards(deleteTags: boolean, deckTags: string[]): Promise<void> {
        return this.forEveryNote((file) =>
            this.removeSchedulingInfoInCards(this.vault, file, deleteTags, deckTags),
        );
    }

    async deleteAllSchedulingDataInNotes(deleteTags: boolean, noteTags: string[]): Promise<void> {
        return this.forEveryNote((file) =>
            this.removeSchedulingInfoInNotes(this.vault, file, deleteTags, noteTags),
        );
    }

    async deleteAllSchedulingDataOfCardsInNote(
        file: TFile,
        deleteTags: boolean,
        deckTags: string[],
    ): Promise<void> {
        await this.removeSchedulingInfoInCards(this.vault, file, deleteTags, deckTags);
        this.announceDeletion();
    }

    async deleteNoteSchedulingDataInNote(
        file: TFile,
        deleteTags: boolean,
        noteTags: string[],
    ): Promise<void> {
        await this.removeSchedulingInfoInNotes(this.vault, file, deleteTags, noteTags);
        this.announceDeletion();
    }

    /** @returns How many schedules were left where they were, as moving them would cut a table or a list in two. */
    async migrateCommentsToCallouts(): Promise<number> {
        let skipped = 0;
        for (const file of this.vault.getMarkdownFiles()) {
            skipped += await this.migrateCommentsToCalloutsInFile(file, this.vault);
        }
        return skipped;
    }

    async migrateCommentsToCalloutsInFile(file: TFile, vault: Vault): Promise<number> {
        let skipped = 0;
        await this.rewrite(vault, file, (text) => {
            const moved = moveCommentsIntoCalloutsCounting(text);
            skipped = moved.skipped;
            return moved.text;
        });
        return skipped;
    }
}
