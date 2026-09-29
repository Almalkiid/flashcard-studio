import type { Collection as AnkiCollection } from "ankipack";
import { unzipSync, zipSync } from "fflate";
import { decompress } from "fzstd";
import type { SqlJsStatic } from "sql.js";

import {
    ANKI_DECK_SEPARATOR,
    AnkiImportError,
    AnkiNote,
    NoteKind,
} from "src/import-export/anki-types";
import { protoNumber, protoString, readProtoFields } from "src/import-export/protobuf-lite";
import { t } from "src/lang/helpers";

/** An opened Anki package: its notes, and a way to take media files out of it one at a time. */
export interface AnkiPackage {
    notes: AnkiNote[];
    /** Names of the media files in the package. */
    mediaNames: string[];
    /** Extracts one media file, or returns null when the package has no such file. */
    readMedia(name: string): Uint8Array | null;
}

/** Anki's internal separator between the levels of a deck name (the manual's `::` is only how Anki displays it). */
const INTERNAL_DECK_SEPARATOR = "\u001f";
const FIELD_SEPARATOR = "\u001f";

const isZstd = (data: Uint8Array): boolean =>
    data.length >= 4 &&
    data[0] === 0x28 &&
    data[1] === 0xb5 &&
    data[2] === 0x2f &&
    data[3] === 0xfd;

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Media names by the number the package stores each file under. Old packages have JSON, current ones protobuf. */
function readMediaIndex(index: Uint8Array | undefined): Map<string, string> {
    const names = new Map<string, string>();
    if (index === undefined || index.length === 0) return names;

    if (isZstd(index)) {
        const entries = readProtoFields(decompress(index)).filter((item) => item.field === 1);
        entries.forEach((entry, position) => {
            const name = protoString(readProtoFields(entry.value as Uint8Array), 1);
            if (name !== "") names.set(name.normalize("NFC"), String(position));
        });
        return names;
    }

    const parsed = JSON.parse(new TextDecoder().decode(index)) as Record<string, unknown>;
    for (const [key, name] of Object.entries(parsed)) {
        if (typeof name === "string" && name !== "") names.set(name.normalize("NFC"), key);
    }
    return names;
}

interface NoteTypeInfo {
    name: string;
    cloze: boolean;
    fieldNames: string[];
    templateQuestions: string[];
}

/** What shape of card a note type makes: see NoteKind. */
function classifyNoteType(info: NoteTypeInfo): NoteKind {
    if (info.cloze) return "cloze";
    const { fieldNames, templateQuestions } = info;
    if (fieldNames.length !== 2) return "other";
    if (templateQuestions.length === 1) return "basic";

    const shows = (question: string, field: string): boolean =>
        new RegExp(`\\{\\{(?:[^{}:]+:)*${escapeRegex(field)}\\}\\}`).test(question);
    const reversed =
        templateQuestions.length === 2 &&
        shows(templateQuestions[0], fieldNames[0]) &&
        !shows(templateQuestions[0], fieldNames[1]) &&
        shows(templateQuestions[1], fieldNames[1]) &&
        !shows(templateQuestions[1], fieldNames[0]);
    return reversed ? "reversed" : "other";
}

function toImportError(error: unknown): AnkiImportError {
    const code = (error as { code?: string }).code;
    if (code === "unsupported-schema") {
        return new AnkiImportError(t("ANKI_IMPORT_ERR_UNSUPPORTED"), "unsupported");
    }
    const detail = error instanceof Error ? error.message : JSON.stringify(error);
    return new AnkiImportError(t("ANKI_IMPORT_ERR_UNREADABLE", { detail }), "invalid-file");
}

/**
 * Opens an `.apkg` or `.colpkg` file (all three layouts Anki has written) and reads its notes.
 *
 * Only the collection database and the media index are unpacked. The media files stay compressed inside the archive
 * and come out one at a time through `readMedia`, so a package with hundreds of megabytes of media does not have to
 * fit in memory twice, which matters on a phone.
 *
 * The database is read by ankipack. Its own reader unpacks every media file up front, so it is handed a copy of the
 * archive that holds only the collection.
 */
export async function openAnkiPackage(bytes: Uint8Array, SQL: SqlJsStatic): Promise<AnkiPackage> {
    let core: Record<string, Uint8Array>;
    try {
        core = unzipSync(bytes, {
            filter: (file) =>
                file.name === "meta" ||
                file.name === "media" ||
                file.name.startsWith("collection."),
        });
    } catch {
        throw new AnkiImportError(t("ANKI_IMPORT_ERR_NOT_A_PACKAGE"), "not-a-package");
    }
    if (!Object.keys(core).some((name) => name.startsWith("collection."))) {
        throw new AnkiImportError(t("ANKI_IMPORT_ERR_NOT_A_PACKAGE"), "not-a-package");
    }

    const { media: mediaIndex, ...collectionEntries } = core;
    const { Collection } = await import("ankipack");

    let collection: AnkiCollection;
    let mediaKeys: Map<string, string>;
    try {
        collection = Collection.open(zipSync(collectionEntries, { level: 0 }), SQL);
        mediaKeys = readMediaIndex(mediaIndex);
    } catch (error) {
        throw toImportError(error);
    }

    const { data } = collection;
    const deckNames = new Map<number, string>(
        data.decks.map((deck) => [
            deck.id,
            deck.name.split(INTERNAL_DECK_SEPARATOR).join(ANKI_DECK_SEPARATOR),
        ]),
    );

    const noteTypes = new Map<number, NoteTypeInfo>();
    for (const noteType of data.notetypes) {
        noteTypes.set(noteType.id, {
            name: noteType.name,
            cloze: protoNumber(readProtoFields(noteType.config), 1) === 1,
            fieldNames: data.fields
                .filter((field) => field.ntid === noteType.id)
                .sort((a, b) => a.ord - b.ord)
                .map((field) => field.name),
            templateQuestions: data.templates
                .filter((template) => template.ntid === noteType.id)
                .sort((a, b) => a.ord - b.ord)
                .map((template) => protoString(readProtoFields(template.config), 1)),
        });
    }

    // A note lives in the deck of its first card (a card in a filtered deck counts for the deck it came from)
    const deckOfNote = new Map<number, { ord: number; deck: number }>();
    for (const card of data.cards) {
        const known = deckOfNote.get(card.nid);
        if (known === undefined || card.ord < known.ord) {
            deckOfNote.set(card.nid, {
                ord: card.ord,
                deck: card.odid !== 0 ? card.odid : card.did,
            });
        }
    }

    const notes: AnkiNote[] = [];
    for (const row of data.notes) {
        const noteType = noteTypes.get(row.mid);
        const deckId = deckOfNote.get(row.id)?.deck;
        // A note without cards or a note type is not something Anki shows either
        if (noteType === undefined || deckId === undefined) continue;
        notes.push({
            guid: row.guid,
            deck: deckNames.get(deckId) ?? "Default",
            kind: classifyNoteType(noteType),
            noteTypeName: noteType.name,
            fieldNames: noteType.fieldNames,
            fields: row.flds.split(FIELD_SEPARATOR),
            tags: row.tags.split(/\s+/).filter((tag) => tag !== ""),
        });
    }

    const modernLayout = mediaIndex !== undefined && isZstd(mediaIndex);
    return {
        notes,
        mediaNames: Array.from(mediaKeys.keys()),
        readMedia(name: string): Uint8Array | null {
            const key = mediaKeys.get(name);
            if (key === undefined) return null;
            const stored = unzipSync(bytes, { filter: (file) => file.name === key })[key];
            if (stored === undefined) return null;
            return modernLayout && isZstd(stored) ? decompress(stored) : stored;
        },
    };
}
