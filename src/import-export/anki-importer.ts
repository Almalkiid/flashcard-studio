import { AnkiNote } from "src/import-export/anki-types";
import {
    BasicStyle,
    buildCard,
    CardSeparators,
    DEFAULT_SEPARATORS,
} from "src/import-export/card-builder";
import {
    ankiTagToObsidianTag,
    appendToDeckNote,
    deckNotePath,
    formatDeckNote,
    ImportedCard,
    joinPath,
    sanitizeFileName,
    tagLine,
} from "src/import-export/deck-note";
import {
    fieldToMarkdown,
    findMediaReferences,
    isExternalReference,
} from "src/import-export/field-to-markdown";
import { findGuids } from "src/import-export/guid-comment";

/** The vault operations an import needs. Obsidian's implementation is in `ObsidianImportHost`. */
export interface ImportHost {
    exists(path: string): Promise<boolean>;
    /** Creates the folder and any missing folders above it. */
    ensureFolder(path: string): Promise<void>;
    readText(path: string): Promise<string>;
    createText(path: string, text: string): Promise<void>;
    /** Rewrites a note in one step, so that a change made meanwhile is not lost. */
    processText(path: string, transform: (text: string) => string): Promise<void>;
    readBinary(path: string): Promise<Uint8Array>;
    createBinary(path: string, data: Uint8Array): Promise<void>;
    /** Paths of every Markdown note in the folder and its subfolders. */
    listNotes(folder: string): Promise<string[]>;
}

/** The media files that came with the notes. A text file has none. */
export interface MediaSource {
    mediaNames: string[];
    readMedia(name: string): Uint8Array | null;
}

export const NO_MEDIA: MediaSource = { mediaNames: [], readMedia: () => null };

export interface ImportOptions {
    /** Where the deck notes go. The decks' folders are created in it, and the media in `attachments` in it. */
    targetFolder: string;
    basicStyle: BasicStyle;
    keepTags: boolean;
    /** Fields are text to show as it is, not HTML. */
    plainText?: boolean;
}

export type ImportPhase = "scanning" | "media" | "converting" | "writing";

export interface ImportContext {
    host: ImportHost;
    /** Obsidian's `htmlToMarkdown`. */
    htmlToMarkdown: (html: string) => string;
    /** The tag that makes a note flashcards, from the settings (`#flashcards`). */
    flashcardTag: string;
    separators?: CardSeparators;
    onProgress?: (phase: ImportPhase, done: number, total: number) => void;
}

export interface ImportResult {
    /** Notes written as cards. */
    cards: number;
    /** Decks that got cards. */
    decks: number;
    mediaFiles: number;
    /** Notes left out because an earlier import already brought them. */
    duplicates: number;
    /** Notes left out because they have no front or no back, or a broken cloze. */
    skipped: number;
    /** True when there are clozes, which need the curly-bracket cloze pattern in the settings. */
    hasClozes: boolean;
    /** Media files the notes refer to that the package does not have. */
    missingMedia: string[];
    /** The deck notes written to. */
    notePaths: string[];
}

const MEDIA_FOLDER = "attachments";

/** Gives the browser a turn, so the progress display can update while a long import runs. */
const yieldToUi = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 0));

/** A vault file name for a media file: characters a link cannot have are replaced, the extension is kept. */
export function sanitizeMediaName(name: string): string {
    const base = name.replace(/^.*[\\/]/, "");
    const dot = base.lastIndexOf(".");
    const hasExtension = dot > 0 && base.length - dot <= 11;
    const stem = sanitizeFileName(hasExtension ? base.slice(0, dot) : base);
    return hasExtension ? `${stem}${base.slice(dot).replace(/[^\w.-]/g, "")}` : stem;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

/** The package's name for the file a field refers to, trying the reference as written and percent-decoded. */
function findMediaName(reference: string, names: Set<string>): string | null {
    const candidates = [reference];
    try {
        candidates.push(decodeURIComponent(reference));
    } catch {
        // A stray % is not an encoding, the reference as written is all there is
    }
    return candidates.map((name) => name.normalize("NFC")).find((name) => names.has(name)) ?? null;
}

/** Writes one media file into the attachments folder, unless the same file is already there. */
async function writeMediaFile(
    host: ImportHost,
    attachments: string,
    wanted: string,
    data: Uint8Array,
): Promise<{ name: string; written: boolean }> {
    const dot = wanted.lastIndexOf(".");
    const stem = dot > 0 ? wanted.slice(0, dot) : wanted;
    const extension = dot > 0 ? wanted.slice(dot) : "";
    for (let attempt = 1; ; attempt++) {
        const name = attempt === 1 ? wanted : `${stem} ${attempt}${extension}`;
        const path = joinPath(attachments, name);
        if (!(await host.exists(path))) {
            await host.createBinary(path, data);
            return { name, written: true };
        }
        // A file of the same name and content is what an earlier import left: use it
        if (sameBytes(await host.readBinary(path), data)) return { name, written: false };
    }
}

/**
 * Writes Anki notes into the vault as one note per deck, in folders that follow the deck tree, and their media into an
 * `attachments` folder.
 *
 * Notes an earlier import already brought are recognised by the Anki guid in the comment after each card, and left
 * out. New notes of a deck that has a note already are added to it.
 */
export async function importNotes(
    notes: AnkiNote[],
    media: MediaSource,
    options: ImportOptions,
    context: ImportContext,
): Promise<ImportResult> {
    const { host } = context;
    const separators = context.separators ?? DEFAULT_SEPARATORS;
    const progress = context.onProgress ?? (() => undefined);
    const result: ImportResult = {
        cards: 0,
        decks: 0,
        mediaFiles: 0,
        duplicates: 0,
        skipped: 0,
        hasClozes: false,
        missingMedia: [],
        notePaths: [],
    };

    // Notes that came in before, and notes repeated in this batch, are left out
    const knownGuids = new Set<string>();
    const existingNotes = await host.listNotes(options.targetFolder);
    for (const [index, path] of existingNotes.entries()) {
        progress("scanning", index, existingNotes.length);
        for (const guid of findGuids(await host.readText(path))) knownGuids.add(guid);
    }
    const fresh: AnkiNote[] = [];
    for (const note of notes) {
        if (knownGuids.has(note.guid)) {
            result.duplicates++;
        } else {
            knownGuids.add(note.guid);
            fresh.push(note);
        }
    }

    // Media, one file at a time: only what the new notes use, each read, written and let go before the next
    const packageNames = new Set(media.mediaNames);
    const wanted = new Set<string>();
    // A text file has no package: its references are files the user puts into the vault, not missing ones
    const missing = new Set<string>();
    for (const note of fresh) {
        for (const field of note.fields) {
            for (const reference of findMediaReferences(field)) {
                if (isExternalReference(reference)) continue;
                const name = findMediaName(reference, packageNames);
                if (name !== null) wanted.add(name);
                else if (media !== NO_MEDIA) missing.add(reference);
            }
        }
    }
    const attachments = joinPath(options.targetFolder, MEDIA_FOLDER);
    const vaultNames = new Map<string, string>();
    let folderReady = false;
    let position = 0;
    for (const name of wanted) {
        progress("media", position++, wanted.size);
        const data = media.readMedia(name);
        if (data === null) {
            missing.add(name);
            continue;
        }
        if (!folderReady) {
            await host.ensureFolder(attachments);
            folderReady = true;
        }
        const written = await writeMediaFile(host, attachments, sanitizeMediaName(name), data);
        vaultNames.set(name, written.name);
        if (written.written) result.mediaFiles++;
        if (position % 20 === 0) await yieldToUi();
    }
    result.missingMedia = Array.from(missing);

    const resolveMedia = (reference: string): string | null => {
        if (isExternalReference(reference)) return null;
        const name = findMediaName(reference, packageNames);
        return (name !== null ? vaultNames.get(name) : undefined) ?? sanitizeMediaName(reference);
    };
    const conversion = { htmlToMarkdown: context.htmlToMarkdown, resolveMedia };

    const decks = new Map<string, { cards: ImportedCard[]; tags: Set<string> }>();
    for (const [index, note] of fresh.entries()) {
        progress("converting", index, fresh.length);
        const fields = note.fields.map((field) =>
            fieldToMarkdown(field, conversion, options.plainText),
        );
        const card = buildCard(note.kind, fields, options.basicStyle, separators);
        if ("skipped" in card) {
            result.skipped++;
            continue;
        }
        result.hasClozes ||= card.clozeNeedsCurlyPattern;
        const deck = decks.get(note.deck) ?? { cards: [], tags: new Set<string>() };
        deck.cards.push({ markdown: card.markdown, guid: note.guid });
        if (options.keepTags) {
            for (const tag of note.tags) {
                const converted = ankiTagToObsidianTag(tag);
                if (converted !== null) deck.tags.add(converted);
            }
        }
        decks.set(note.deck, deck);
        result.cards++;
        if (index % 50 === 49) await yieldToUi();
    }

    let written = 0;
    for (const [deckName, deck] of Array.from(decks).sort(([a], [b]) => a.localeCompare(b))) {
        progress("writing", written++, decks.size);
        const path = deckNotePath(options.targetFolder, deckName);
        const tags = Array.from(deck.tags).sort();
        if (await host.exists(path)) {
            await host.processText(path, (text) => appendToDeckNote(text, deck.cards, tags));
        } else {
            await host.ensureFolder(path.slice(0, path.lastIndexOf("/")));
            await host.createText(
                path,
                formatDeckNote(tagLine(context.flashcardTag, deckName, tags), deck.cards),
            );
        }
        result.notePaths.push(path);
        result.decks++;
    }
    progress("writing", decks.size, decks.size);
    return result;
}
