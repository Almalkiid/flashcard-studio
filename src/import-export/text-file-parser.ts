import { hasAnkiCloze } from "src/import-export/anki-cloze";
import { AnkiNote, NoteKind } from "src/import-export/anki-types";
import { syntheticGuid } from "src/import-export/guid-comment";

/**
 * Reads Anki's text file format: fields separated by tabs, semicolons, commas, pipes, colons or spaces, with `#key:value`
 * header lines, quoted fields (`""` for a quote inside) and `#` comment lines. See "Text Files" in the Anki manual.
 */

export interface ParsedTextFile {
    separator: string;
    /** Fields hold HTML. Without the `#html:true` header they are plain text. */
    html: boolean;
    /** Tags every note gets (`#tags:`). */
    tags: string[];
    /** Column names (`#columns:`). */
    columns: string[] | null;
    notetype: string | null;
    deck: string | null;
    /** 1-based column numbers, as in the headers. */
    notetypeColumn: number | null;
    deckColumn: number | null;
    tagsColumn: number | null;
    guidColumn: number | null;
    rows: string[][];
}

const NAMED_SEPARATORS: Record<string, string> = {
    comma: ",",
    semicolon: ";",
    tab: "\t",
    space: " ",
    pipe: "|",
    colon: ":",
};

/** In the order they are tried when the file does not say. Space is last, it is in almost any text. */
const CANDIDATE_SEPARATORS = ["\t", ";", "|", ",", ":", " "];

const HEADER_KEYS = new Set([
    "separator",
    "html",
    "tags",
    "columns",
    "notetype",
    "deck",
    "notetype column",
    "deck column",
    "tags column",
    "guid column",
]);

/** Splits text into records of fields. A record that starts with `#` outside quotes is a comment and is left out. */
function splitRecords(text: string, separator: string, limit = Infinity): string[][] {
    const records: string[][] = [];
    let fields: string[] = [];
    let field = "";
    let inQuotes = false;
    let fieldStart = true;
    let comment = false;

    const endField = (): void => {
        fields.push(field);
        field = "";
        fieldStart = true;
    };
    const endRecord = (): void => {
        endField();
        if (!(fields.length === 1 && fields[0] === "")) records.push(fields);
        fields = [];
    };

    for (let i = 0; i < text.length && records.length < limit; i++) {
        const char = text[i];
        if (comment) {
            if (char === "\n") comment = false;
        } else if (inQuotes) {
            if (char === '"' && text[i + 1] === '"') {
                field += '"';
                i++;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                field += char;
            }
        } else if (char === '"' && fieldStart) {
            inQuotes = true;
            fieldStart = false;
        } else if (char === "#" && fieldStart && fields.length === 0) {
            comment = true;
        } else if (char === "\n") {
            endRecord();
        } else if (char === separator) {
            endField();
        } else {
            field += char;
            fieldStart = false;
        }
    }
    if (!comment && (field !== "" || fields.length > 0)) endRecord();
    return records;
}

/** The separator that splits the first lines of the file into the same number of fields, more than one. */
function guessSeparator(body: string): string {
    let best = { separator: "\t", count: 1 };
    for (const separator of CANDIDATE_SEPARATORS) {
        const counts = splitRecords(body, separator, 10).map((record) => record.length);
        if (counts.length === 0 || counts[0] < 2) continue;
        if (counts.every((count) => count === counts[0])) return separator;
        if (counts[0] > best.count) best = { separator, count: counts[0] };
    }
    return best.separator;
}

function parseColumnNumber(value: string | undefined): number | null {
    const number = Number.parseInt(value ?? "", 10);
    return Number.isFinite(number) && number > 0 ? number : null;
}

/** Reads a whole text file: its headers, and its rows as fields. Throws nothing, a file with no rows has no rows. */
export function parseTextFile(source: string): ParsedTextFile {
    const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

    // Header lines are the `#key:value` lines at the top. Other `#` lines are comments, dropped when reading records.
    const headers = new Map<string, string>();
    const lines = text.split("\n");
    let bodyStart = 0;
    while (bodyStart < lines.length && lines[bodyStart].startsWith("#")) {
        const header = /^#([a-z ]+):(.*)$/i.exec(lines[bodyStart]);
        const key = header?.[1].toLowerCase();
        if (header !== null && key !== undefined && HEADER_KEYS.has(key)) {
            headers.set(key, header[2]);
        }
        bodyStart++;
    }
    const body = lines.slice(bodyStart).join("\n");

    const named = headers.get("separator");
    const separator =
        named === undefined
            ? guessSeparator(body)
            : (NAMED_SEPARATORS[named.trim().toLowerCase()] ?? (named === "" ? "\t" : named));

    const columns = headers.get("columns");
    return {
        separator,
        html: headers.get("html")?.trim().toLowerCase() === "true",
        tags: (headers.get("tags") ?? "").split(/\s+/).filter((tag) => tag !== ""),
        columns: columns === undefined ? null : (splitRecords(columns, separator)[0] ?? null),
        notetype: headers.get("notetype")?.trim() || null,
        deck: headers.get("deck")?.trim() || null,
        notetypeColumn: parseColumnNumber(headers.get("notetype column")),
        deckColumn: parseColumnNumber(headers.get("deck column")),
        tagsColumn: parseColumnNumber(headers.get("tags column")),
        guidColumn: parseColumnNumber(headers.get("guid column")),
        rows: splitRecords(body, separator),
    };
}

/** What kind of note a note type name and its number of fields stand for. */
function kindOf(noteTypeName: string | null, fields: string[]): NoteKind {
    if (noteTypeName !== null && /cloze/i.test(noteTypeName)) return "cloze";
    if (
        noteTypeName !== null &&
        /reversed/i.test(noteTypeName) &&
        !/optional/i.test(noteTypeName)
    ) {
        return fields.length === 2 ? "reversed" : "other";
    }
    if (noteTypeName === null && hasAnkiCloze(fields[0] ?? "")) return "cloze";
    return fields.length === 2 ? "basic" : "other";
}

/**
 * Turns the rows of a text file into notes. The columns that hold the deck, tags, guid and note type are not fields;
 * the other columns are the fields in order.
 *
 * @param defaultDeck - The deck for rows without one, such as the name of the file.
 */
export function textFileToNotes(file: ParsedTextFile, defaultDeck: string): AnkiNote[] {
    const special = new Set(
        [file.notetypeColumn, file.deckColumn, file.tagsColumn, file.guidColumn]
            .filter((column): column is number => column !== null)
            .map((column) => column - 1),
    );
    const at = (row: string[], column: number | null): string =>
        column === null ? "" : (row[column - 1] ?? "").trim();

    const notes: AnkiNote[] = [];
    for (const row of file.rows) {
        const fields = row.filter((_value, index) => !special.has(index));
        if (fields.every((field) => field.trim() === "")) continue;

        const noteTypeName = at(row, file.notetypeColumn) || file.notetype;
        const deck = at(row, file.deckColumn) || file.deck || defaultDeck;
        const columnTags = at(row, file.tagsColumn).split(/\s+/);
        const regularNames = (file.columns ?? []).filter((_name, index) => !special.has(index));

        notes.push({
            guid: at(row, file.guidColumn) || syntheticGuid(deck, fields[0] ?? ""),
            deck,
            kind: kindOf(noteTypeName, fields),
            noteTypeName: noteTypeName ?? "",
            fieldNames: fields.map((_value, index) => regularNames[index] ?? `Field ${index + 1}`),
            fields,
            tags: [...file.tags, ...columnTags].filter((tag) => tag !== ""),
        });
    }
    return notes;
}
