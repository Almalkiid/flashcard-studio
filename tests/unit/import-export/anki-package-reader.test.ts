/**
 * @jest-environment node
 */
import { Deck, Note, Package } from "ankipack";
import * as fflate from "fflate";
import { zipSync } from "fflate";
import type { SqlJsStatic } from "sql.js";

import { openAnkiPackage } from "src/import-export/anki-package-reader";
import { AnkiImportError } from "src/import-export/anki-types";
import { loadSql } from "src/import-export/sql-loader";

import {
    AUDIO_BYTES,
    buildSyntheticApkg,
    IMAGE_BYTES,
    NOTE_TYPES,
    toLegacyLayout,
} from "./helpers/build-apkg";

// fflate as it is, with unzipSync replaceable to watch what it does
jest.mock("fflate", () => {
    const actual = jest.requireActual<typeof fflate>("fflate");
    return { ...actual, unzipSync: jest.fn(actual.unzipSync) };
});

let SQL: SqlJsStatic;
let modern: Uint8Array;

beforeAll(async () => {
    SQL = await loadSql();
    modern = await buildSyntheticApkg(SQL);
});

describe.each([
    ["current layout (zstd, protobuf media index)", () => modern],
    ["old layout (JSON media index, uncompressed)", () => toLegacyLayout(modern)],
])("openAnkiPackage, %s", (_name, getBytes) => {
    let pack: Awaited<ReturnType<typeof openAnkiPackage>>;

    beforeAll(async () => {
        pack = await openAnkiPackage(getBytes(), SQL);
    });

    test("reads every note with its deck, kind, fields, tags and guid", () => {
        const byGuid = new Map(pack.notes.map((note) => [note.guid, note]));
        expect(byGuid.size).toBe(6);

        expect(byGuid.get("guid-hola")).toMatchObject({
            deck: "Spanish",
            kind: "basic",
            noteTypeName: "Basic",
            fieldNames: ["Front", "Back"],
            fields: ["hola", "<b>hello</b><br>(a greeting)"],
            tags: ["greetings", "week1"],
        });
        expect(byGuid.get("guid-gracias")).toMatchObject({ deck: "Spanish", kind: "reversed" });
        expect(byGuid.get("guid-cloze")).toMatchObject({
            deck: "Spanish::Verbs",
            kind: "cloze",
            fields: ["Yo {{c1::hablo::hablar}} y tu {{c2::hablas}}", "Present tense"],
            tags: ["grammar::verbs"],
        });
        expect(byGuid.get("guid-vocab")).toMatchObject({
            deck: "Spanish::Verbs",
            kind: "other",
            fieldNames: ["Word", "Meaning", "Example"],
        });
    });

    test("lists media and extracts one file at a time", () => {
        expect(pack.mediaNames.sort()).toEqual(["cat.png", "meow.mp3"]);
        expect(pack.readMedia("cat.png")).toEqual(IMAGE_BYTES);
        expect(pack.readMedia("meow.mp3")).toEqual(AUDIO_BYTES);
        expect(pack.readMedia("missing.png")).toBeNull();
    });
});

describe.each([
    ["current layout", (bytes: Uint8Array) => bytes],
    ["old layout", toLegacyLayout],
])("openAnkiPackage with many media files, %s", (_name, layout) => {
    const count = 200;
    const mediaBytes = (index: number) => new Uint8Array([index % 256, Math.floor(index / 256), 7]);

    test("takes each file out without going through every file of the archive again", async () => {
        const deck = new Deck({ name: "Audio" });
        deck.addNote(new Note({ notetype: NOTE_TYPES.basic, fields: ["a", "b"], guid: "g" }));
        const built = new Package();
        built.addDeck(deck);
        for (let index = 0; index < count; index++) {
            built.addMedia(`word_${index}.mp3`, mediaBytes(index));
        }
        const pack = await openAnkiPackage(layout(await built.toUint8Array(SQL)), SQL);
        expect(pack.mediaNames).toHaveLength(count);

        // Counts the archive entries unzipSync looks at, which is all of them on every call
        let entriesSeen = 0;
        const { unzipSync } = jest.requireActual<typeof fflate>("fflate");
        jest.mocked(fflate.unzipSync).mockImplementation((data, options) =>
            unzipSync(data, {
                filter: (file) => {
                    entriesSeen++;
                    return options?.filter?.(file) ?? true;
                },
            }),
        );
        try {
            for (let index = 0; index < count; index++) {
                expect(pack.readMedia(`word_${index}.mp3`)).toEqual(mediaBytes(index));
            }
        } finally {
            jest.mocked(fflate.unzipSync).mockImplementation(unzipSync);
        }
        expect(entriesSeen).toBeLessThanOrEqual(count);
    });
});

describe("openAnkiPackage errors", () => {
    test("rejects a file that is not a zip", async () => {
        await expect(openAnkiPackage(new TextEncoder().encode("hello"), SQL)).rejects.toMatchObject(
            {
                name: "AnkiImportError",
                code: "not-a-package",
            },
        );
    });

    test("rejects a zip without a collection", async () => {
        const zip = zipSync({ "readme.txt": new TextEncoder().encode("x") });
        await expect(openAnkiPackage(zip, SQL)).rejects.toBeInstanceOf(AnkiImportError);
    });

    test("rejects a damaged collection", async () => {
        const zip = zipSync({ "collection.anki2": new TextEncoder().encode("not sqlite") });
        await expect(openAnkiPackage(zip, SQL)).rejects.toMatchObject({ code: "invalid-file" });
    });

    test("names a newer layout as unsupported", async () => {
        // `meta` with version 9, which no Anki has written
        const zip = zipSync({
            meta: new Uint8Array([0x08, 0x09]),
            "collection.anki21b": new Uint8Array([1, 2, 3]),
        });
        await expect(openAnkiPackage(zip, SQL)).rejects.toMatchObject({ code: "unsupported" });
    });
});
