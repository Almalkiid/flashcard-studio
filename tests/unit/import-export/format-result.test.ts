import { ImportResult } from "src/import-export/anki-importer";
import { countOf, summariseExport, summariseImport } from "src/import-export/format-result";

const result: ImportResult = {
    cards: 839,
    decks: 30,
    mediaFiles: 12,
    duplicates: 3,
    skipped: 0,
    hasClozes: false,
    missingMedia: [],
    notePaths: [],
};

describe("countOf", () => {
    test("uses the singular for one and the plural for the rest, zero included", () => {
        expect(countOf(1, "ANKI_UNIT_CARDS")).toBe("1 card");
        expect(countOf(2, "ANKI_UNIT_CARDS")).toBe("2 cards");
        expect(countOf(0, "ANKI_UNIT_MEDIA")).toBe("0 media files");
        expect(countOf(1, "ANKI_UNIT_DUPLICATES")).toBe("1 duplicate");
    });
});

describe("summariseImport", () => {
    test("tells what was imported, with the media and the notes skipped as duplicates", () => {
        const summary = summariseImport(result, "Flashcards/Imported", false);
        expect(summary.headline).toBe("Imported 839 cards in 30 decks (12 media files).");
        expect(summary.details).toEqual([
            "3 duplicates skipped, already imported.",
            "The notes are in Flashcards/Imported.",
        ]);
    });

    test("leaves out the media when there is none, and says so for one of each", () => {
        const summary = summariseImport(
            { ...result, cards: 1, decks: 1, mediaFiles: 0, duplicates: 0 },
            "Target",
            false,
        );
        expect(summary.headline).toBe("Imported 1 card in 1 deck.");
        expect(summary.details).toEqual(["The notes are in Target."]);
    });

    test("names skipped notes, missing media, clozes and the settings change", () => {
        const summary = summariseImport(
            {
                ...result,
                duplicates: 0,
                skipped: 2,
                hasClozes: true,
                missingMedia: ["a.png", "b.png", "c.png", "d.png", "e.png", "f.png", "g.png"],
            },
            "Target",
            true,
        );
        expect(summary.details).toEqual([
            "2 cards skipped because they have no front, no back or a broken cloze.",
            "Not in the package, so left out: a.png, b.png, c.png, d.png, e.png, +2",
            "Cloze notes were written as {{1;;answer;;hint}}.",
            "Turned on the cloze pattern {{[123;;]answer[;;hint]}} in the settings, which imported cloze cards need.",
            "The notes are in Target.",
        ]);
    });

    test("does not point at a folder when nothing was imported", () => {
        const summary = summariseImport(
            { ...result, cards: 0, decks: 0, mediaFiles: 0, duplicates: 5 },
            "Target",
            false,
        );
        expect(summary.headline).toBe("Imported 0 cards in 0 decks.");
        expect(summary.details).toEqual(["5 duplicates skipped, already imported."]);
    });
});

describe("summariseExport", () => {
    test("tells what was exported and where", () => {
        const summary = summariseExport(
            { cards: 12, decks: 3, mediaFiles: 0, missingMedia: [] },
            0,
            "Flashcards/Exports/All-2026-09-29.apkg",
        );
        expect(summary.headline).toBe(
            "Exported 12 cards in 3 decks to Flashcards/Exports/All-2026-09-29.apkg.",
        );
        expect(summary.details).toEqual([]);
    });

    test("names the media, skipped cards and files not found", () => {
        const summary = summariseExport(
            { cards: 1, decks: 1, mediaFiles: 1, missingMedia: ["gone.png"] },
            2,
            "x.apkg",
        );
        expect(summary.headline).toBe("Exported 1 card in 1 deck (1 media file) to x.apkg.");
        expect(summary.details).toEqual([
            "2 cards skipped because Anki cannot show them.",
            "Not found in the vault, so left out: gone.png",
        ]);
    });
});
