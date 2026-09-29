import type { Deck as AnkiDeck } from "ankipack";
import type { SqlJsStatic } from "sql.js";

import { ExportKind, ExportNote } from "src/import-export/export-collector";
import { HtmlContext, markdownToHtml } from "src/import-export/markdown-to-html";
import { cyrb53 } from "src/utils/strings";

/** How the exporter reaches the files a card embeds. Obsidian's implementation is in `ObsidianExportHost`. */
export interface ExportMediaHost {
    /** The vault path of the file an embed refers to, seen from a note, or null when the vault has none. */
    resolve(target: string, fromPath: string): string | null;
    read(path: string): Promise<Uint8Array>;
}

export interface ExportSummary {
    cards: number;
    decks: number;
    mediaFiles: number;
    /** Embedded files that are not in the vault, which the cards show as text. */
    missingMedia: string[];
}

// Notetypes get fixed ids, or Anki would take every export for a new note type and add a copy of it each time
const NOTETYPE_IDS: Record<ExportKind, number> = {
    basic: 1786000000001,
    reversed: 1786000000002,
    cloze: 1786000000003,
};

/** The names Anki's own note types have, which a text file import maps to the note types the collection already has. */
export const STOCK_NOTETYPE_NAMES: Record<ExportKind, string> = {
    basic: "Basic",
    reversed: "Basic (and reversed card)",
    cloze: "Cloze",
};

const CARD_CSS = `.card {
    font-family: arial;
    font-size: 20px;
    text-align: center;
    color: black;
    background-color: white;
}
`;
const CLOZE_CSS = `.cloze {
    font-weight: bold;
    color: blue;
}
.nightMode .cloze {
    color: lightblue;
}
`;

/**
 * Turns an embedded file's name into one Anki accepts: no characters it cannot have, not too long, no clash.
 * `isValid` is Anki's own rule as ankipack applies it. Anki refuses a whole package for one name it does not accept,
 * so such a name is replaced by a plain one made from a hash.
 */
function ankiMediaName(
    name: string,
    taken: Set<string>,
    isValid: (name: string) => boolean,
): string {
    const base = name.replace(/^.*[\\/]/, "").normalize("NFC");
    const dot = base.lastIndexOf(".");
    const extension = dot > 0 ? base.slice(dot) : "";
    const cleanStem = (dot > 0 ? base.slice(0, dot) : base)
        // eslint-disable-next-line no-control-regex -- control characters are among those Anki refuses in a file name
        .replace(/[[\]<>:"/?*^\\|%#\u0000-\u001f]/g, "_")
        .replace(/\u00a0/g, " ")
        .replace(/[. ]+$/, "_");
    const stem = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(cleanStem)
        ? `_${cleanStem}`
        : cleanStem;

    let candidate = `${stem}${extension}`;
    if (!isValid(candidate)) candidate = `media-${cyrb53(candidate)}${extension}`;
    if (!isValid(candidate)) candidate = `media-${cyrb53(candidate)}`;

    let unique = candidate;
    for (let number = 2; taken.has(unique); number++) {
        unique = `${candidate.slice(0, candidate.length - extension.length)} (${number})${extension}`;
    }
    taken.add(unique);
    return unique;
}

/** Converts the fronts and backs of notes to HTML, finding the files they embed. */
class NoteRenderer {
    readonly media = new Map<string, string>();
    readonly missing = new Set<string>();
    private readonly taken = new Set<string>();

    constructor(
        private readonly host: ExportMediaHost,
        private readonly isValidName: (name: string) => boolean = () => true,
    ) {}

    render(markdown: string, sourcePath: string): string {
        const context: HtmlContext = {
            embed: (target) => {
                const path = this.host.resolve(target, sourcePath);
                if (path === null) {
                    this.missing.add(target);
                    return null;
                }
                let name = this.media.get(path);
                if (name === undefined) {
                    name = ankiMediaName(path, this.taken, this.isValidName);
                    this.media.set(path, name);
                }
                return name;
            },
        };
        return markdownToHtml(markdown, context);
    }
}

/**
 * Builds an Anki package from flashcard notes: the note types Basic and Basic (and reversed card), and Cloze, with the deck
 * hierarchy, tags and embedded images and sounds. It carries content only: no scheduling and no deck presets, so
 * that importing it adds cards to the collection and changes nothing else.
 */
export async function buildApkg(
    notes: ExportNote[],
    host: ExportMediaHost,
    SQL: SqlJsStatic,
): Promise<{ bytes: Uint8Array; summary: ExportSummary }> {
    const { Deck, Note, Notetype, Package } = await import("ankipack");

    const isValidName = (name: string): boolean => {
        try {
            new Package().addMedia(name, new Uint8Array());
            return true;
        } catch {
            return false;
        }
    };
    const renderer = new NoteRenderer(host, isValidName);
    const noteTypes = {
        basic: new Notetype({
            id: NOTETYPE_IDS.basic,
            name: `Cardwright ${STOCK_NOTETYPE_NAMES.basic}`,
            css: CARD_CSS,
            fields: [{ name: "Front" }, { name: "Back" }],
            templates: [
                {
                    name: "Card 1",
                    questionFormat: "{{Front}}",
                    answerFormat: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}",
                },
            ],
        }),
        reversed: new Notetype({
            id: NOTETYPE_IDS.reversed,
            name: `Cardwright ${STOCK_NOTETYPE_NAMES.reversed}`,
            css: CARD_CSS,
            fields: [{ name: "Front" }, { name: "Back" }],
            templates: [
                {
                    name: "Card 1",
                    questionFormat: "{{Front}}",
                    answerFormat: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}",
                },
                {
                    name: "Card 2",
                    questionFormat: "{{Back}}",
                    answerFormat: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}",
                },
            ],
        }),
        cloze: new Notetype({
            id: NOTETYPE_IDS.cloze,
            name: `Cardwright ${STOCK_NOTETYPE_NAMES.cloze}`,
            type: "cloze",
            css: CARD_CSS + CLOZE_CSS,
            fields: [{ name: "Text" }, { name: "Back Extra" }],
            templates: [
                {
                    name: "Cloze",
                    questionFormat: "{{cloze:Text}}",
                    answerFormat: "{{cloze:Text}}<br>\n{{Back Extra}}",
                },
            ],
        }),
    };

    // A deck of no preset of its own uses the collection's default, so importing adds no deck preset
    const decks = new Map<string, AnkiDeck>();
    for (const note of notes) {
        let deck = decks.get(note.deck);
        if (deck === undefined) {
            deck = new Deck({ name: note.deck, config: null });
            decks.set(note.deck, deck);
        }
        deck.addNote(
            new Note({
                notetype: noteTypes[note.kind],
                fields: [
                    renderer.render(note.front, note.sourcePath),
                    renderer.render(note.back, note.sourcePath),
                ],
                tags: note.tags,
                guid: note.guid,
            }),
        );
    }

    const pack = new Package();
    for (const deck of decks.values()) pack.addDeck(deck);
    for (const [path, name] of renderer.media) pack.addMedia(name, await host.read(path));

    return {
        bytes: await pack.toUint8Array(SQL),
        summary: {
            cards: notes.length,
            decks: decks.size,
            mediaFiles: renderer.media.size,
            missingMedia: Array.from(renderer.missing),
        },
    };
}

/**
 * A field of Anki's text file format: quoted when it has a tab, a new line or a quote. A field with a `#` is quoted
 * too, as Anki does: a line that starts with an unquoted `#` is a comment, and guids (the first column) can start
 * with one.
 */
function textField(value: string): string {
    return /[\t\n"#]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Writes notes as Anki's text file format (see "Text Files" in the Anki manual), which Anki imports with its
 * decks, note types and tags. The headers tell Anki which column is which, so it needs no choices in the import
 * window. Embedded files are named in the fields, but not part of the file: copy them into Anki's media folder.
 */
export function buildTextExport(
    notes: ExportNote[],
    host: ExportMediaHost,
): { text: string; summary: ExportSummary } {
    const renderer = new NoteRenderer(host);
    const rows = notes.map((note) =>
        [
            note.guid,
            STOCK_NOTETYPE_NAMES[note.kind],
            note.deck,
            renderer.render(note.front, note.sourcePath),
            renderer.render(note.back, note.sourcePath),
            note.tags.join(" "),
        ]
            .map(textField)
            .join("\t"),
    );
    const header = [
        "#separator:tab",
        "#html:true",
        "#guid column:1",
        "#notetype column:2",
        "#deck column:3",
        "#tags column:6",
    ];
    return {
        text: `${[...header, ...rows].join("\n")}\n`,
        summary: {
            cards: notes.length,
            decks: new Set(notes.map((note) => note.deck)).size,
            mediaFiles: renderer.media.size,
            missingMedia: Array.from(renderer.missing),
        },
    };
}
