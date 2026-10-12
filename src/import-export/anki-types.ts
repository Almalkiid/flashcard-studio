/**
 * How a note maps to cards. Anki has many note types, but only these shapes matter when the content is written as
 * flashcard Markdown.
 */
export type NoteKind =
    /** Two fields and one card: front and back. */
    | "basic"
    /** Two fields and a second card that asks the other way round. */
    | "reversed"
    /** A text with cloze deletions. */
    | "cloze"
    /** Any other note type: the first field is the front, the other fields make up the back. */
    | "other";

/** One Anki note, as read from a package or a text file. Field contents are Anki HTML. */
export interface AnkiNote {
    /** Anki's globally unique id of the note. Stable across exports, so it identifies a note on re-import. */
    guid: string;
    /** Deck name with `::` between the levels, for example `Spanish::Verbs`. */
    deck: string;
    kind: NoteKind;
    noteTypeName: string;
    fieldNames: string[];
    /** Raw field contents (HTML), in the order of `fieldNames`. */
    fields: string[];
    tags: string[];
}

/** Problems the user can act on: a file that is not an Anki package, a newer format, an empty file. */
export class AnkiImportError extends Error {
    constructor(
        message: string,
        readonly code: "not-a-package" | "unsupported" | "empty" | "invalid-file",
    ) {
        super(message);
        this.name = "AnkiImportError";
    }
}

/** The separator Anki puts between deck levels. */
export const ANKI_DECK_SEPARATOR = "::";
