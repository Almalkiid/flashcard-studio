/**
 * @jest-environment node
 */
import type { SqlJsStatic } from "sql.js";

import {
    importNotes,
    ImportOptions,
    ImportResult,
    NO_MEDIA,
    sanitizeMediaName,
} from "src/import-export/anki-importer";
import { openAnkiPackage } from "src/import-export/anki-package-reader";
import { AnkiNote } from "src/import-export/anki-types";
import { findGuids } from "src/import-export/guid-comment";
import { loadSql } from "src/import-export/sql-loader";

import { AUDIO_BYTES, buildSyntheticApkg, IMAGE_BYTES } from "./helpers/build-apkg";
import { FakeHost } from "./helpers/fake-host";
import { simpleHtmlToMarkdown } from "./helpers/simple-html-to-markdown";

let SQL: SqlJsStatic;
let apkg: Uint8Array;

beforeAll(async () => {
    SQL = await loadSql();
    apkg = await buildSyntheticApkg(SQL);
});

const options: ImportOptions = {
    targetFolder: "Flashcards/Imported",
    basicStyle: "multi",
    keepTags: true,
};

async function runImport(
    host: FakeHost,
    overrides: Partial<ImportOptions> = {},
): Promise<ImportResult> {
    const pack = await openAnkiPackage(apkg, SQL);
    return importNotes(
        pack.notes,
        pack,
        { ...options, ...overrides },
        {
            host,
            htmlToMarkdown: simpleHtmlToMarkdown,
            flashcardTag: "#flashcards",
        },
    );
}

describe("importNotes of a package", () => {
    test("writes one note per deck in folders that follow the deck tree, with tags and guids", async () => {
        const host = new FakeHost();
        const result = await runImport(host);

        expect(result).toMatchObject({
            cards: 6,
            decks: 2,
            mediaFiles: 2,
            duplicates: 0,
            skipped: 0,
            hasClozes: true,
            missingMedia: [],
        });
        expect(result.notePaths).toEqual([
            "Flashcards/Imported/Spanish/Spanish.md",
            "Flashcards/Imported/Spanish/Verbs/Verbs.md",
        ]);

        const spanish = host.texts.get("Flashcards/Imported/Spanish/Spanish.md");
        expect(spanish.split("\n")[0]).toBe("#flashcards/Spanish #greetings #week1");
        expect(spanish).toContain("hola\n?\n**hello**\n(a greeting)\n<!--anki:guid%2Dhola-->");
        expect(spanish).toContain("gracias\n??\nthanks\n<!--anki:guid%2Dgracias-->");
        expect(spanish).toContain(
            "What is this?\n![[cat.png]]\n?\nA cat ![[meow.mp3]]\n<!--anki:guid%2Dmedia-->",
        );

        const verbs = host.texts.get("Flashcards/Imported/Spanish/Verbs/Verbs.md");
        expect(verbs.split("\n")[0]).toBe("#flashcards/Spanish/Verbs #grammar/verbs");
        expect(verbs).toContain("Yo {{1;;hablo;;hablar}} y tu {{2;;hablas}}\n<br>\nPresent tense");
        expect(verbs).toContain("comer\n?\nto eat\n<br>\nYo como pan");
        expect(verbs).toContain("std:&#58;vector is a\n?\ncontainer");
    });

    test("writes the media into an attachments folder in the target folder", async () => {
        const host = new FakeHost();
        await runImport(host);
        expect(host.binaries.get("Flashcards/Imported/attachments/cat.png")).toEqual(IMAGE_BYTES);
        expect(host.binaries.get("Flashcards/Imported/attachments/meow.mp3")).toEqual(AUDIO_BYTES);
    });

    test("skips notes already imported, by guid, and imports only the new ones on a second run", async () => {
        const host = new FakeHost();
        await runImport(host);
        const before = new Map(host.texts);

        const again = await runImport(host);
        expect(again).toMatchObject({ cards: 0, decks: 0, duplicates: 6, mediaFiles: 0 });
        expect(host.texts).toEqual(before);
    });

    test("adds new notes to a deck's note that exists, and their tags to its tag line", async () => {
        const host = new FakeHost();
        const pack = await openAnkiPackage(apkg, SQL);
        const first = pack.notes.filter((note) => note.guid !== "guid-hola");
        const context = { host, htmlToMarkdown: simpleHtmlToMarkdown, flashcardTag: "#flashcards" };
        await importNotes(first, pack, options, context);
        const hola = pack.notes.find((note) => note.guid === "guid-hola");

        const result = await importNotes(pack.notes, pack, options, context);
        expect(result).toMatchObject({ cards: 1, duplicates: 5, decks: 1 });
        const spanish = host.texts.get("Flashcards/Imported/Spanish/Spanish.md");
        expect(spanish.split("\n")[0]).toBe("#flashcards/Spanish #greetings #week1");
        expect(findGuids(spanish)).toContain(hola.guid);
        expect(findGuids(spanish)).toHaveLength(3);
        expect(host.log.filter((entry) => entry.startsWith("process"))).toEqual([
            "process Flashcards/Imported/Spanish/Spanish.md",
        ]);
    });

    test("finds notes imported earlier anywhere in the target folder", async () => {
        const host = new FakeHost();
        host.texts.set(
            "Flashcards/Imported/Moved/elsewhere.md",
            "hola\n?\nhello\n<!--anki:guid-hola-->\n",
        );
        const result = await runImport(host);
        expect(result.duplicates).toBe(1);
        expect(result.cards).toBe(5);
    });

    test("keeps a media file that is already there, and renames one that differs", async () => {
        const host = new FakeHost();
        host.binaries.set("Flashcards/Imported/attachments/cat.png", IMAGE_BYTES);
        host.binaries.set("Flashcards/Imported/attachments/meow.mp3", new Uint8Array([1]));
        const result = await runImport(host);

        expect(result.mediaFiles).toBe(1);
        expect(host.binaries.get("Flashcards/Imported/attachments/meow 2.mp3")).toEqual(
            AUDIO_BYTES,
        );
        const spanish = host.texts.get("Flashcards/Imported/Spanish/Spanish.md");
        expect(spanish).toContain("![[cat.png]]");
        expect(spanish).toContain("![[meow 2.mp3]]");
    });

    test("writes basic notes on one line when asked, and leaves tags out when asked", async () => {
        const host = new FakeHost();
        await runImport(host, { basicStyle: "single", keepTags: false });
        const spanish = host.texts.get("Flashcards/Imported/Spanish/Spanish.md");
        expect(spanish.split("\n")[0]).toBe("#flashcards/Spanish");
        expect(spanish).toContain("gracias:::thanks\n");
        // A back with a line break does not fit on one line
        expect(spanish).toContain("hola\n?\n**hello**\n(a greeting)");
    });

    test("reports progress through every phase", async () => {
        const host = new FakeHost();
        const pack = await openAnkiPackage(apkg, SQL);
        const phases = new Set<string>();
        await importNotes(pack.notes, pack, options, {
            host,
            htmlToMarkdown: simpleHtmlToMarkdown,
            flashcardTag: "#flashcards",
            onProgress: (phase) => phases.add(phase),
        });
        expect([...phases]).toEqual(["media", "converting", "writing"]);
    });

    test("uses the tag from the settings for the tag line", async () => {
        const host = new FakeHost();
        const pack = await openAnkiPackage(apkg, SQL);
        await importNotes(pack.notes, pack, options, {
            host,
            htmlToMarkdown: simpleHtmlToMarkdown,
            flashcardTag: "#cards",
        });
        expect(host.texts.get("Flashcards/Imported/Spanish/Spanish.md")?.split("\n")[0]).toMatch(
            /^#cards\/Spanish/,
        );
    });
});

describe("importNotes edge cases", () => {
    const note = (fields: string[], overrides: Partial<AnkiNote> = {}): AnkiNote => ({
        guid: `g-${fields[0]}`,
        deck: "D",
        kind: "basic",
        noteTypeName: "Basic",
        fieldNames: ["Front", "Back"],
        fields,
        tags: [],
        ...overrides,
    });
    const context = (host: FakeHost) => ({
        host,
        htmlToMarkdown: simpleHtmlToMarkdown,
        flashcardTag: "#flashcards",
    });

    test("counts a note repeated in one batch once, and empty notes as skipped", async () => {
        const host = new FakeHost();
        const result = await importNotes(
            [note(["a", "b"]), note(["a", "b"]), note(["", "b"]), note(["c", ""], { guid: "x" })],
            NO_MEDIA,
            options,
            context(host),
        );
        expect(result).toMatchObject({ cards: 1, duplicates: 1, skipped: 2 });
    });

    test("reports media the package lacks, but not for a text file", async () => {
        const host = new FakeHost();
        const withImage = note(['<img src="gone.png">', "b"]);
        const missing = await importNotes(
            [withImage],
            { mediaNames: ["other.png"], readMedia: () => null },
            options,
            context(host),
        );
        expect(missing.missingMedia).toEqual(["gone.png"]);

        const unreadable = await importNotes(
            [note(['<img src="x.png">', "b"], { guid: "y" })],
            { mediaNames: ["x.png"], readMedia: () => null },
            options,
            context(new FakeHost()),
        );
        expect(unreadable.missingMedia).toEqual(["x.png"]);

        const textFile = await importNotes(
            [note(['<img src="local.png">', "b"], { guid: "z" })],
            NO_MEDIA,
            options,
            context(new FakeHost()),
        );
        expect(textFile.missingMedia).toEqual([]);
    });

    test("finds media by a percent-encoded reference and leaves web images alone", async () => {
        const host = new FakeHost();
        const result = await importNotes(
            [note(['<img src="my%20cat.png"> <img src="https://x.org/a.png">', "b"])],
            { mediaNames: ["my cat.png"], readMedia: () => IMAGE_BYTES },
            options,
            { ...context(host), htmlToMarkdown: simpleHtmlToMarkdown },
        );
        expect(result.mediaFiles).toBe(1);
        expect(host.binaries.has("Flashcards/Imported/attachments/my cat.png")).toBe(true);
        const text = host.texts.get("Flashcards/Imported/D/D.md");
        expect(text).toContain("![[my cat.png]]");
        expect(text).toContain("![](https://x.org/a.png)");
    });

    test("finds media given with a stray percent sign", async () => {
        const host = new FakeHost();
        const result = await importNotes(
            [note(['<img src="100%.png">', "b"])],
            { mediaNames: ["100%.png"], readMedia: () => IMAGE_BYTES },
            options,
            context(host),
        );
        expect(result.mediaFiles).toBe(1);
    });

    test("imports plain text as text when asked", async () => {
        const host = new FakeHost();
        await importNotes(
            [note(["a <b> c", "b & d"])],
            NO_MEDIA,
            { ...options, plainText: true },
            context(host),
        );
        expect(host.texts.get("Flashcards/Imported/D/D.md")).toContain("a <b> c\n?\nb & d");
    });
});

describe("sanitizeMediaName", () => {
    test.each([
        ["cat.png", "cat.png"],
        ["my cat #1.png", "my cat -1.png"],
        ["folder/sub\\a.jpg", "a.jpg"],
        ["noextension", "noextension"],
        ["archive.tar.gz", "archive.tar.gz"],
        ["weird.p?g", "weird.pg"],
        [".hidden", "_hidden"],
    ])("%p becomes %p", (name, expected) => {
        expect(sanitizeMediaName(name)).toBe(expected);
    });
});
