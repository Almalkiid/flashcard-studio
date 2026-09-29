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

/** The deck's tag, for example `#flashcards/Spanish/Verbs`, which is what makes the deck without folders as decks. */
export function deckTag(flashcardTag: string, deck: string): string {
    const levels = deckLevels(deck)
        .map((level) =>
            level
                .replace(/[^\p{L}\p{N}_-]+/gu, "-")
                .replace(/-{2,}/g, "-")
                .replace(/^-+|-+$/g, ""),
        )
        .filter((level) => level !== "");
    return [flashcardTag, ...levels].join("/");
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

/** The tag line of a new deck note: the deck's tag, then the Anki tags of its notes. */
export function tagLine(flashcardTag: string, deck: string, tags: string[]): string {
    return [deckTag(flashcardTag, deck), ...tags.map((tag) => `#${tag}`)].join(" ");
}
