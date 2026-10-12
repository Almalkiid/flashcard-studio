/**
 * @jest-environment node
 */
import { zipSync } from "fflate";
import type { SqlJsStatic } from "sql.js";

import { openAnkiPackage } from "src/import-export/anki-package-reader";
import { AnkiImportError } from "src/import-export/anki-types";
import { loadSql } from "src/import-export/sql-loader";

import { AUDIO_BYTES, buildSyntheticApkg, IMAGE_BYTES, toLegacyLayout } from "./helpers/build-apkg";

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
