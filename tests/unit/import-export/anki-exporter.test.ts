/**
 * @jest-environment node
 */
import type { SqlJsStatic } from "sql.js";

import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { CURLY_CLOZE_PATTERN } from "src/import-export/anki-cloze";
import {
    buildApkg,
    buildTextExport,
    ExportMediaHost,
    STOCK_NOTETYPE_NAMES,
} from "src/import-export/anki-exporter";
import { importNotes } from "src/import-export/anki-importer";
import { openAnkiPackage } from "src/import-export/anki-package-reader";
import { collectExportNotes, ExportNote } from "src/import-export/export-collector";
import { loadSql } from "src/import-export/sql-loader";
import { parseTextFile, textFileToNotes } from "src/import-export/text-file-parser";

import { unitTestSetupStandardDataStoreAlgorithm } from "../helpers/unit-test-setup";
import { AUDIO_BYTES, buildSyntheticApkg, IMAGE_BYTES } from "./helpers/build-apkg";
import { deckFromText } from "./helpers/deck-from-text";
import { FakeHost } from "./helpers/fake-host";
import { simpleHtmlToMarkdown } from "./helpers/simple-html-to-markdown";

let SQL: SqlJsStatic;

const settings: SRSettings = {
    ...DEFAULT_SETTINGS,
    clozePatterns: [...DEFAULT_SETTINGS.clozePatterns, CURLY_CLOZE_PATTERN],
};

beforeAll(async () => {
    SQL = await loadSql();
    unitTestSetupStandardDataStoreAlgorithm(settings);
});

/** A vault with a few media files, found by name from any note. */
function mediaHost(files: Record<string, Uint8Array>): ExportMediaHost {
    return {
        resolve: (target) => Object.keys(files).find((path) => path.endsWith(target)) ?? null,
        read: async (path) => files[path],
    };
}

const note = (overrides: Partial<ExportNote> = {}): ExportNote => ({
    deck: "Spanish",
    kind: "basic",
    front: "hola",
    back: "**hello**",
    tags: [],
    guid: "g1",
    sourcePath: "Notes/a.md",
    ...overrides,
});

describe("buildApkg", () => {
    test("writes decks, note types, fields, tags and guids that read back", async () => {
        const { bytes, summary } = await buildApkg(
            [
                note({ tags: ["exam", "grammar::verbs"] }),
                note({ kind: "reversed", front: "gracias", back: "thanks", guid: "g2" }),
                note({
                    deck: "Spanish::Verbs",
                    kind: "cloze",
                    front: "Yo {{c1::hablo}} y {{c2::hablas}}",
                    back: "",
                    guid: "g3",
                }),
            ],
            mediaHost({}),
            SQL,
        );
        expect(summary).toEqual({ cards: 3, decks: 2, mediaFiles: 0, missingMedia: [] });

        const pack = await openAnkiPackage(bytes, SQL);
        expect(pack.notes).toHaveLength(3);
        expect(pack.notes[0]).toMatchObject({
            guid: "g1",
            deck: "Spanish",
            kind: "basic",
            noteTypeName: "Cardwright Basic",
            fieldNames: ["Front", "Back"],
            fields: ["hola", "<b>hello</b>"],
            tags: ["exam", "grammar::verbs"],
        });
        expect(pack.notes[1]).toMatchObject({ kind: "reversed", fields: ["gracias", "thanks"] });
        expect(pack.notes[2]).toMatchObject({
            deck: "Spanish::Verbs",
            kind: "cloze",
            fieldNames: ["Text", "Back Extra"],
            fields: ["Yo {{c1::hablo}} y {{c2::hablas}}", ""],
        });
    });

    test("uses fixed note type ids and no deck presets, so that importing changes nothing else", async () => {
        const { Collection } = await import("ankipack");
        const first = Collection.open((await buildApkg([note()], mediaHost({}), SQL)).bytes, SQL);
        const second = Collection.open(
            (await buildApkg([note({ deck: "Other", guid: "g9" })], mediaHost({}), SQL)).bytes,
            SQL,
        );
        expect(first.data.notetypes.map((type) => type.id)).toEqual(
            second.data.notetypes.map((type) => type.id),
        );
        expect(first.data.notetypes.map((type) => type.name)).toEqual(["Cardwright Basic"]);
        // The deck points at the collection's own default preset
        expect(first.data.decks.find((deck) => deck.name === "Spanish")).toBeDefined();
    });

    test("copies embedded images and sounds into the package", async () => {
        const host = mediaHost({
            "Attachments/cat.png": IMAGE_BYTES,
            "Attachments/meow.mp3": AUDIO_BYTES,
        });
        const { bytes, summary } = await buildApkg(
            [
                note({
                    front: "What is this?\n![[cat.png]]",
                    back: "A cat ![[meow.mp3]] ![[cat.png]] ![[gone.png]]",
                }),
            ],
            host,
            SQL,
        );
        expect(summary).toMatchObject({ mediaFiles: 2, missingMedia: ["gone.png"] });

        const pack = await openAnkiPackage(bytes, SQL);
        expect(pack.notes[0].fields).toEqual([
            'What is this?<br><img src="cat.png">',
            'A cat [sound:meow.mp3] <img src="cat.png"> ![[gone.png]]',
        ]);
        expect(pack.mediaNames.sort()).toEqual(["cat.png", "meow.mp3"]);
        expect(pack.readMedia("cat.png")).toEqual(IMAGE_BYTES);
        expect(pack.readMedia("meow.mp3")).toEqual(AUDIO_BYTES);
    });

    test("gives media names Anki accepts, and different names to different files", async () => {
        const files: Record<string, Uint8Array> = {
            "One/pic.png": new Uint8Array([1]),
            "Two/pic.png": new Uint8Array([2]),
            "Odd/a%c:d.png": new Uint8Array([3]),
            "Odd/CON.png": new Uint8Array([4]),
            ["Odd/" + "x".repeat(200) + ".png"]: new Uint8Array([5]),
        };
        const host: ExportMediaHost = {
            resolve: (target) => (target in files ? target : null),
            read: async (path) => files[path],
        };
        const embeds = Object.keys(files).map((path) => `![[${path}]]`);
        const { bytes } = await buildApkg([note({ back: embeds.join(" ") })], host, SQL);

        const pack = await openAnkiPackage(bytes, SQL);
        expect(pack.mediaNames).toHaveLength(5);
        expect(pack.mediaNames).toEqual(
            expect.arrayContaining(["pic.png", "pic (2).png", "a_c_d.png", "_CON.png"]),
        );
        const contents = pack.mediaNames.map((name) => pack.readMedia(name)[0]).sort();
        expect(contents).toEqual([1, 2, 3, 4, 5]);
    });
});

describe("buildTextExport", () => {
    test("writes Anki's text format with headers, guids, note types, decks and tags", () => {
        const { text, summary } = buildTextExport(
            [
                note({ tags: ["exam"] }),
                note({ kind: "cloze", front: "A {{c1::b}}", back: "", guid: "g2" }),
                note({
                    front: 'tab\there "quoted"',
                    back: "line1\nline2",
                    guid: "g3",
                    deck: "A::B",
                }),
            ],
            mediaHost({}),
        );
        expect(summary).toMatchObject({ cards: 3, decks: 2 });
        const lines = text.split("\n");
        expect(lines.slice(0, 6)).toEqual([
            "#separator:tab",
            "#html:true",
            "#guid column:1",
            "#notetype column:2",
            "#deck column:3",
            "#tags column:6",
        ]);
        expect(lines[6]).toBe("g1\tBasic\tSpanish\thola\t<b>hello</b>\texam");
        expect(lines[7]).toBe("g2\tCloze\tSpanish\tA {{c1::b}}\t\t");
        expect(text.endsWith("\n")).toBe(true);
    });

    test("is read back by the text file importer", () => {
        const { text } = buildTextExport(
            [
                note({ tags: ["a", "b"] }),
                note({
                    kind: "reversed",
                    front: 'has\ttab "and" quote',
                    back: "x<br>y",
                    guid: "g2",
                    deck: "A::B",
                }),
                note({ kind: "cloze", front: "A {{c1::b}}", back: "", guid: "g3" }),
            ],
            mediaHost({}),
        );
        const file = parseTextFile(text);
        expect(file.html).toBe(true);
        const notes = textFileToNotes(file, "unused");
        expect(
            notes.map((item) => [item.guid, item.deck, item.kind, item.fields, item.tags]),
        ).toEqual([
            ["g1", "Spanish", "basic", ["hola", "<b>hello</b>"], ["a", "b"]],
            ["g2", "A::B", "reversed", ['has\ttab "and" quote', "x<br>y"], []],
            ["g3", "Spanish", "cloze", ["A {{c1::b}}", ""], []],
        ]);
    });

    test("names the stock note types", () => {
        expect(STOCK_NOTETYPE_NAMES).toEqual({
            basic: "Basic",
            reversed: "Basic (and reversed card)",
            cloze: "Cloze",
        });
    });
});

describe("export then import again", () => {
    test("cards survive the round trip: package to notes to package to notes", async () => {
        // 1. Import the synthetic package into a fake vault
        const source = await openAnkiPackage(await buildSyntheticApkg(SQL), SQL);
        const vault = new FakeHost();
        await importNotes(
            source.notes,
            source,
            { targetFolder: "Flashcards/Imported", basicStyle: "multi", keepTags: true },
            { host: vault, htmlToMarkdown: simpleHtmlToMarkdown, flashcardTag: "#flashcards" },
        );

        // 2. Export what the plugin reads from those notes
        const collected = [];
        for (const [path, text] of vault.texts) {
            const deck = await deckFromText(text, settings, path);
            collected.push(...(await collectExportNotes(deck, settings)).notes);
        }
        const media: Record<string, Uint8Array> = {};
        for (const [path, data] of vault.binaries) media[path] = data;
        const { bytes } = await buildApkg(collected, mediaHost(media), SQL);

        // 3. Read the exported package: same notes, same guids
        const exported = await openAnkiPackage(bytes, SQL);
        expect(exported.notes).toHaveLength(source.notes.length);
        const original = new Map(source.notes.map((item) => [item.guid, item]));
        for (const item of exported.notes) {
            const before = original.get(item.guid);
            expect(before).toBeDefined();
            expect(item.kind).toBe(before?.kind === "other" ? "basic" : before?.kind);
        }
        const byGuid = new Map(exported.notes.map((item) => [item.guid, item]));
        expect(byGuid.get("guid-hola")?.fields).toEqual(["hola", "<b>hello</b><br>(a greeting)"]);
        expect(byGuid.get("guid-hola")?.deck).toBe("Spanish");
        expect(byGuid.get("guid-gracias")?.kind).toBe("reversed");
        expect(byGuid.get("guid-media")?.fields).toEqual([
            'What is this?<br><img src="cat.png">',
            "A cat [sound:meow.mp3]",
        ]);
        expect(byGuid.get("guid-cloze")?.fields).toEqual([
            "Yo {{c1::hablo::hablar}} y tu {{c2::hablas}}",
            "Present tense",
        ]);
        expect(byGuid.get("guid-colons")?.fields[0]).toBe("std:&#58;vector is a");
        expect(exported.readMedia("cat.png")).toEqual(IMAGE_BYTES);

        // 4. Import the export again into another folder: the same cards, in the same decks
        const again = new FakeHost();
        const result = await importNotes(
            exported.notes,
            exported,
            { targetFolder: "Second", basicStyle: "multi", keepTags: true },
            { host: again, htmlToMarkdown: simpleHtmlToMarkdown, flashcardTag: "#flashcards" },
        );
        expect(result).toMatchObject({ cards: 6, decks: 2, mediaFiles: 2, duplicates: 0 });
        expect(again.texts.get("Second/Spanish/Spanish.md")).toContain(
            "hola\n?\n**hello**\n(a greeting)",
        );
        expect(again.texts.get("Second/Spanish/Verbs/Verbs.md")).toContain(
            "Yo {{1;;hablo;;hablar}} y tu {{2;;hablas}}",
        );

        // 5. Importing the export into the folder of the first import skips everything: guids were kept
        const skipped = await importNotes(
            exported.notes,
            exported,
            { targetFolder: "Flashcards/Imported", basicStyle: "multi", keepTags: true },
            { host: vault, htmlToMarkdown: simpleHtmlToMarkdown, flashcardTag: "#flashcards" },
        );
        expect(skipped).toMatchObject({ cards: 0, duplicates: 6 });
    });
});
