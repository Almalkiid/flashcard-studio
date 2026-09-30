/**
 * @jest-environment node
 */
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { CURLY_CLOZE_PATTERN } from "src/import-export/anki-cloze";
import { ankiDeckName, collectExportNotes } from "src/import-export/export-collector";
import { formatGuidComment } from "src/import-export/guid-comment";

import { unitTestSetupStandardDataStoreAlgorithm } from "../helpers/unit-test-setup";
import { deckFromText } from "./helpers/deck-from-text";

const settings: SRSettings = { ...DEFAULT_SETTINGS };

beforeAll(() => {
    unitTestSetupStandardDataStoreAlgorithm(settings);
});

describe("ankiDeckName", () => {
    test("leaves out the flashcard tag when something follows it", () => {
        expect(ankiDeckName(["flashcards", "CIA", "Part1"], ["#flashcards"])).toBe("CIA::Part1");
        expect(ankiDeckName(["Flashcards", "CIA"], ["#flashcards"])).toBe("CIA");
        expect(ankiDeckName(["flashcards"], ["#flashcards"])).toBe("flashcards");
        expect(ankiDeckName(["Flashcards", "Imported", "Spanish"], ["#other"])).toBe(
            "Flashcards::Imported::Spanish",
        );
        expect(ankiDeckName([], ["#flashcards"])).toBe("Default");
    });
});

describe("collectExportNotes", () => {
    test("collects one note per question with deck, kind, front and back", async () => {
        const deck = await deckFromText(
            [
                "#flashcards/Spanish/Verbs",
                "",
                "hablar\n?\nto speak\nto talk",
                "",
                "gracias:::thanks",
                "",
                "One::Two",
                "",
                "El ==perro== es ==marron==",
                "",
            ].join("\n"),
            settings,
        );
        const { notes, skipped } = await collectExportNotes(deck, settings);

        expect(skipped).toBe(0);
        expect(notes.map((note) => [note.deck, note.kind, note.front, note.back])).toEqual([
            ["Spanish::Verbs", "basic", "hablar", "to speak\nto talk"],
            ["Spanish::Verbs", "reversed", "gracias", "thanks"],
            ["Spanish::Verbs", "basic", "One", "Two"],
            ["Spanish::Verbs", "cloze", "El {{c1::perro}} es {{c2::marron}}", ""],
        ]);
        expect(notes.every((note) => note.sourcePath === "Notes/a.md")).toBe(true);
    });

    test("takes each question once even when it is in several decks, and orders by deck tree", async () => {
        const deck = await deckFromText(
            "#flashcards/B #flashcards/A\n\nQ1::A1\n\n#flashcards/A\nQ2::A2\n",
            settings,
        );
        const { notes } = await collectExportNotes(deck, settings);
        expect(notes.map((note) => note.front).sort()).toEqual(["Q1", "Q2"]);
    });

    test("exports notes with the Anki guid an import left, and gives others a stable id", async () => {
        const text = [
            "#flashcards/Spanish",
            "",
            `single::card\n${formatGuidComment("i>WU5-->liws")}`,
            "",
            `multi\n?\nline\n${formatGuidComment("guid-2")}`,
            "",
            "own::card",
            "",
            "own::card",
            "",
        ].join("\n");
        const first = (await collectExportNotes(await deckFromText(text, settings), settings))
            .notes;
        expect(first.map((note) => note.guid).slice(0, 2)).toEqual(["i>WU5-->liws", "guid-2"]);
        expect(first[2].guid).toMatch(/^cw-[0-9a-f]+$/);
        // The same card twice in a deck is two notes, which need two guids
        expect(first[3].guid).toBe(`${first[2].guid}-2`);

        const second = (await collectExportNotes(await deckFromText(text, settings), settings))
            .notes;
        expect(second.map((note) => note.guid)).toEqual(first.map((note) => note.guid));
    });

    test("exports the tags of the note as Anki tags, without the flashcard tag", async () => {
        const deck = await deckFromText(
            "#flashcards/Spanish #grammar/verbs #exam\n\nQ::A\n",
            settings,
        );
        const { notes } = await collectExportNotes(deck, settings);
        expect(notes[0].tags).toEqual(["exam", "grammar::verbs"]);
    });

    test("reads clozes under the patterns of the settings, curly ones included", async () => {
        const custom = {
            ...settings,
            clozePatterns: [...settings.clozePatterns, CURLY_CLOZE_PATTERN],
        };
        const deck = await deckFromText(
            "#flashcards\n\nYo {{1;;hablo;;hablar}} y tu {{2;;hablas}}\n",
            custom,
        );
        const { notes } = await collectExportNotes(deck, custom);
        expect(notes[0]).toMatchObject({
            deck: "flashcards",
            kind: "cloze",
            front: "Yo {{c1::hablo::hablar}} y tu {{c2::hablas}}",
        });
    });

    test("skips a cloze that the current patterns cannot read", async () => {
        const deck = await deckFromText("#flashcards\n\nA ==cloze== card\n", settings);
        const { notes, skipped } = await collectExportNotes(deck, {
            ...settings,
            clozePatterns: [],
        });
        expect(notes).toEqual([]);
        expect(skipped).toBe(1);
    });

    test("exports each mask of an image occlusion block as a basic note: the question and the picture, and the label", async () => {
        const text = [
            "#flashcards/Anatomy",
            "",
            "```image-occlusion",
            "image: [[Heart.png]]",
            "question: Name the chamber",
            "mask: a rect 0 0 .5 .5 | Left **ventricle**",
            "mask: b rect .5 .5 .5 .5 |",
            "```",
            "",
            "```image-occlusion",
            "image: ![](folder/my%20heart.png)",
            "mask: c ellipse 0 0 .5 .5 | Aorta",
            "```",
            "",
        ].join("\n");
        const { notes, skipped } = await collectExportNotes(
            await deckFromText(text, settings),
            settings,
        );

        expect(skipped).toBe(0);
        expect(notes.map((note) => [note.kind, note.front, note.back])).toEqual([
            ["basic", "Name the chamber\n\n![[Heart.png]]", "Left **ventricle**"],
            ["basic", "Name the chamber\n\n![[Heart.png]]", "Mask 2"],
            ["basic", "What is hidden?\n\n![[folder/my heart.png]]", "Aorta"],
        ]);
        expect(new Set(notes.map((note) => note.guid)).size).toBe(3);
        expect(notes.every((note) => note.deck === "Anatomy")).toBe(true);
    });

    test("an image occlusion block that is not valid is skipped without harm to the other cards", async () => {
        const deck = await deckFromText(
            "#flashcards\n\n```image-occlusion\nnothing useful\n```\n\nQ::A\n",
            settings,
        );
        const { notes } = await collectExportNotes(deck, settings);
        expect(notes.map((note) => note.front)).toEqual(["Q"]);
    });

    test("collects a single deck of the tree", async () => {
        const deck = await deckFromText(
            "#flashcards/A\n\nQ1::A1\n\n#flashcards/B\nQ2::A2\n",
            settings,
        );
        const subdeck = deck.getDeckByTopicTag("#flashcards/B") ?? deck;
        const { notes } = await collectExportNotes(subdeck, settings);
        expect(notes.map((note) => note.front)).toEqual(["Q2"]);
    });
});
