import { ANKI_DECK_SEPARATOR } from "src/import-export/anki-types";
import { formatGuidComment } from "src/import-export/guid-comment";

/** Characters that cannot be in a file name on some platform, or that break a link to the file in Obsidian. */
const UNSAFE_FILE_NAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

/** A file or folder name for text that may hold characters a name cannot have. */
export function sanitizeFileName(name: string): string {
    const cleaned = name
        .normalize("NFC")
        .replace(UNSAFE_FILE_NAME_CHARS, "-")
        .replace(/\s+/g, " ")
        .replace(/^\.+/, "_")
        .replace(/[. ]+$/, "")
        .trim()
        .slice(0, 100)
        .trim();
    return cleaned === "" ? "Untitled" : cleaned;
}

/** Joins path parts with `/`, dropping empty parts and doubled or trailing slashes. */
export function joinPath(...parts: string[]): string {
    return parts
        .flatMap((part) => part.split("/"))
        .filter((part) => part !== "")
        .join("/");
}

/** The levels of an Anki deck name: `A::B` is `["A", "B"]`. */
export function deckLevels(deck: string): string[] {
    return deck
        .split(ANKI_DECK_SEPARATOR)
        .map((level) => level.trim())
        .filter((level) => level !== "");
}

/**
 * Where the note for a deck goes: a folder per deck level and a note named like the deck in the last folder. With
 * folders as decks, that folder path is the deck path, so it is the same tree as in Anki. `A::B` in `Target` is
 * `Target/A/B/B.md`.
 */
export function deckNotePath(targetFolder: string, deck: string): string {
    const levels = deckLevels(deck).map(sanitizeFileName);
    if (levels.length === 0) levels.push("Default");
    return joinPath(targetFolder, ...levels, `${levels[levels.length - 1]}.md`);
}

/**
 * An Obsidian tag for an Anki tag, or null when nothing of it is left. Anki's `::` levels become `/` levels, and
 * characters a tag cannot have become `-`. Tags of only digits are not tags in Obsidian, so they get a `_` first.
 */
export function ankiTagToObsidianTag(tag: string): string | null {
    const levels = tag
        .split(ANKI_DECK_SEPARATOR)
        .flatMap((part) => part.split("/"))
        .map((part) =>
            part
                .replace(/[^\p{L}\p{N}_-]+/gu, "-")
                .replace(/-{2,}/g, "-")
                .replace(/^-+|-+$/g, ""),
        )
        .filter((part) => part !== "");
    if (levels.length === 0) return null;
    const joined = levels.join("/");
    return /^[\d/]+$/.test(joined) ? `_${joined}` : joined;
}

/** A deck level as a tag level: characters a tag cannot have become `-`, and a level with nothing else is `_`. */
function tagLevel(level: string): string {
    const cleaned = level
        .replace(/[^\p{L}\p{N}_-]+/gu, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "");
    return cleaned === "" ? "_" : cleaned;
}

/**
 * Orders decks level by level, so that a deck comes after its parent. Of levels that make the same tag level, the one
 * that is a tag level as it is comes first, so that it keeps it.
 */
function compareLevels(a: string[], b: string[]): number {
    const key = (level: string): string[] => {
        const tag = tagLevel(level);
        return [tag, level === tag ? "0" : "1", level];
    };
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
        const [left, right] = [key(a[index]), key(b[index])];
        const differs = left.findIndex((part, at) => part !== right[at]);
        if (differs >= 0) return left[differs] < right[differs] ? -1 : 1;
    }
    return a.length - b.length;
}

/**
 * The tags of the decks of one import, by deck name. A deck's tag is its path as a tag path under the flashcard tag,
 * for example `#flashcards/Spanish/Verbs`, which is what makes the deck without folders as decks.
 *
 * Decks whose names differ only in characters a tag cannot have would get the same tag, and so become one deck. A
 * level whose tag another deck already has gets a number instead: `C`, `C#` and `C++` are `#flashcards/C`,
 * `#flashcards/C-2` and `#flashcards/C-3`.
 *
 * `existing` has the tag on the note of each deck that an earlier import made a note for. Such a deck keeps it, its
 * parents keep the levels of it above the deck, so that a new subdeck follows them, and no other deck gets one of
 * these tags.
 */
export function deckTags(
    flashcardTag: string,
    decks: string[],
    existing: ReadonlyMap<string, string> = new Map(),
): Map<string, string> {
    // Each tag and the deck, its levels joined with `::`, that it is for, both ways round
    const owners = new Map<string, string>();
    const ownTags = new Map<string, string>();
    const claim = (owner: string, tag: string): void => {
        if (owners.has(tag) || ownTags.has(owner)) return;
        owners.set(tag, owner);
        ownTags.set(owner, tag);
    };
    const ownerAt = (levels: string[], index: number): string =>
        levels.slice(0, index + 1).join(ANKI_DECK_SEPARATOR);
    const byLevels = (names: Iterable<string>) =>
        Array.from(new Set(names), (deck) => ({ deck, levels: deckLevels(deck) })).sort((a, b) =>
            compareLevels(a.levels, b.levels),
        );

    for (const { deck, levels } of byLevels(existing.keys())) {
        const tag = existing.get(deck);
        if (levels.length === 0 || !tag.startsWith(`${flashcardTag}/`)) continue;
        const tagLevels = tag.slice(flashcardTag.length + 1).split("/");
        if (tagLevels.length === levels.length) {
            levels.forEach((_, index) =>
                claim(
                    ownerAt(levels, index),
                    [flashcardTag, ...tagLevels.slice(0, index + 1)].join("/"),
                ),
            );
        } else {
            // A tag changed to one of another depth says nothing about the parents' tags
            claim(ownerAt(levels, levels.length - 1), tag);
        }
    }

    const tags = new Map<string, string>();
    for (const { deck, levels } of byLevels(decks)) {
        let tag = flashcardTag;
        levels.forEach((level, index) => {
            const owner = ownerAt(levels, index);
            const base = `${tag}/${tagLevel(level)}`;
            tag = ownTags.get(owner) ?? base;
            for (let number = 2; (owners.get(tag) ?? owner) !== owner; number++) {
                tag = `${base}-${number}`;
            }
            claim(owner, tag);
        });
        tags.set(deck, tag);
    }
    return tags;
}

export interface ImportedCard {
    markdown: string;
    guid: string;
}

/** A card with the comment that remembers its Anki note. */
export function formatCard(card: ImportedCard): string {
    return `${card.markdown}\n${formatGuidComment(card.guid)}`;
}

/** The text of a new deck note: the tag line, then the cards. */
export function formatDeckNote(tagLine: string, cards: ImportedCard[]): string {
    return `${tagLine}\n\n${cards.map(formatCard).join("\n\n")}\n`;
}

/** Adds cards to the end of an existing deck note, and the Anki tags it does not have yet to its tag line. */
export function appendToDeckNote(existing: string, cards: ImportedCard[], tags: string[]): string {
    const lines = existing.trimEnd().split("\n");
    const isTagLine =
        lines[0].length > 0 && lines[0].split(/\s+/).every((word) => word.startsWith("#"));
    if (isTagLine) {
        const known = new Set(lines[0].split(/\s+/));
        const missing = tags.map((tag) => `#${tag}`).filter((tag) => !known.has(tag));
        if (missing.length > 0) lines[0] = `${lines[0]} ${missing.join(" ")}`;
    }
    return `${lines.join("\n")}\n\n${cards.map(formatCard).join("\n\n")}\n`;
}

/** The tag line of a new deck note: the deck's tag (see `deckTags`), then the Anki tags of its notes. */
export function tagLine(deckTag: string, tags: string[]): string {
    return [deckTag, ...tags.map((tag) => `#${tag}`)].join(" ");
}

/** The deck tag at the start of a deck note's tag line, or null when its first line does not start with one. */
export function deckTagOfNote(text: string, flashcardTag: string): string | null {
    const end = text.indexOf("\n");
    const first = (end < 0 ? text : text.slice(0, end)).trim().split(/\s+/)[0];
    return first.startsWith(`${flashcardTag}/`) ? first : null;
}
