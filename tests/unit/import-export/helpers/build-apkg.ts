import { Deck, Note, Notetype, Package } from "ankipack";
import { unzipSync, zipSync } from "fflate";
import { decompress } from "fzstd";
import type { SqlJsStatic } from "sql.js";

/** A tiny PNG-like payload: the importer never looks inside media, only at its bytes. */
export const IMAGE_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
export const AUDIO_BYTES = new Uint8Array([73, 68, 51, 3, 0, 0, 9, 9, 9]);

export const NOTE_TYPES = {
    basic: Notetype.basic(),
    reversed: Notetype.basicAndReversed(),
    cloze: Notetype.cloze(),
    vocab: new Notetype({
        name: "Vocab",
        fields: [{ name: "Word" }, { name: "Meaning" }, { name: "Example" }],
        templates: [
            {
                name: "Card 1",
                questionFormat: "{{Word}}",
                answerFormat: "{{FrontSide}}<hr id=answer>{{Meaning}}<br>{{Example}}",
            },
        ],
    }),
};

/**
 * A small package with what the importer has to handle: three note types, subdecks, tags, an image and a sound, HTML,
 * and text that collides with the card syntax. Notes have fixed guids.
 */
export async function buildSyntheticApkg(SQL: SqlJsStatic): Promise<Uint8Array> {
    const spanish = new Deck({ name: "Spanish" });
    spanish.addNote(
        new Note({
            notetype: NOTE_TYPES.basic,
            fields: ["hola", "<b>hello</b><br>(a greeting)"],
            tags: ["greetings", "week1"],
            guid: "guid-hola",
        }),
    );
    spanish.addNote(
        new Note({
            notetype: NOTE_TYPES.reversed,
            fields: ["gracias", "thanks"],
            guid: "guid-gracias",
        }),
    );
    spanish.addNote(
        new Note({
            notetype: NOTE_TYPES.basic,
            fields: ['What is this?<br><img src="cat.png">', "A cat [sound:meow.mp3]"],
            guid: "guid-media",
        }),
    );

    const verbs = new Deck({ name: "Spanish::Verbs" });
    verbs.addNote(
        new Note({
            notetype: NOTE_TYPES.cloze,
            fields: ["Yo {{c1::hablo::hablar}} y tu {{c2::hablas}}", "Present tense"],
            tags: ["grammar::verbs"],
            guid: "guid-cloze",
        }),
    );
    verbs.addNote(
        new Note({
            notetype: NOTE_TYPES.vocab,
            fields: ["comer", "to eat", "Yo como pan"],
            guid: "guid-vocab",
        }),
    );
    verbs.addNote(
        new Note({
            notetype: NOTE_TYPES.basic,
            fields: ["std::vector is a", "container"],
            guid: "guid-colons",
        }),
    );

    const pack = new Package();
    pack.addDeck(spanish);
    pack.addDeck(verbs);
    pack.addMedia("cat.png", IMAGE_BYTES);
    pack.addMedia("meow.mp3", AUDIO_BYTES);
    return pack.toUint8Array(SQL);
}

/**
 * Rewrites a package in the older layout Anki wrote before 2.1.50: no `meta`, an uncompressed `collection.anki21`,
 * media named by number in a JSON index and stored uncompressed.
 */
export function toLegacyLayout(bytes: Uint8Array): Uint8Array {
    const entries = unzipSync(bytes);
    const modernMedia = unzipSync(bytes, { filter: (file) => file.name === "media" }).media;
    const names = readModernMediaNames(decompress(modernMedia));

    const legacy: Record<string, Uint8Array> = {
        "collection.anki21": decompress(entries["collection.anki21b"]),
    };
    const index: Record<string, string> = {};
    names.forEach((name, position) => {
        index[String(position)] = name;
        legacy[String(position)] = decompress(entries[String(position)]);
    });
    legacy.media = new TextEncoder().encode(JSON.stringify(index));
    return zipSync(legacy, { level: 0 });
}

/** The names in a current media index, read the plain way: field 1 of each entry. */
function readModernMediaNames(index: Uint8Array): string[] {
    const names: string[] = [];
    let offset = 0;
    while (offset < index.length) {
        // Entry: tag 0x0a, length, then a message whose first field is the name (tag 0x0a, length, bytes)
        const entryLength = index[offset + 1];
        const nameLength = index[offset + 3];
        names.push(new TextDecoder().decode(index.subarray(offset + 4, offset + 4 + nameLength)));
        offset += 2 + entryLength;
    }
    return names;
}
