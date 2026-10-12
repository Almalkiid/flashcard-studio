import { Deck } from "src/data/decks/deck";
import { TopicPath } from "src/data/decks/topic-path";
import { DEFAULT_SETTINGS } from "src/data/settings-model";
import { Note } from "src/note-review/note";
import { NoteFileLoader } from "src/note-review/note-file-loader";
import { ReviewItemState } from "src/scheduling/schedule/review-item";
import { TextDirection } from "src/utils/text";

import { UnitTestNoteFile } from "../support/memory-note";
import { stripCardIds } from "../support/setup";
import { unitTestSetupStandardDataStoreAlgorithm } from "../support/setup";

// The Note and the NoteFileLoader (spec 5.1 and 5.2): a note read from text, its cards in decks, and its questions
// written back when a schedule was cut.

const settings = { ...DEFAULT_SETTINGS };

async function load(text: string, path = "n.md") {
    unitTestSetupStandardDataStoreAlgorithm(settings);
    const file = new UnitTestNoteFile(text, path);
    const note = await new NoteFileLoader(settings).load(
        file,
        TextDirection.Ltr,
        TopicPath.emptyPath,
    );
    return { file, note };
}

test("the loader reads the questions of a note", async () => {
    const { note } = await load("#flashcards/test\nQ1::A1\nQ2::A2\n");
    expect(note.questionList).toHaveLength(2);
    expect(note.filePath).toBe("n.md");
    expect(note.hasChanged).toBe(false);
    expect(note.questionList.every((q) => q.note === note)).toBe(true);
});

test("a note without a flashcard tag has no questions", async () => {
    const { note } = await load("Q1::A1\n");
    expect(note.questionList).toEqual([]);
    expect(note.hasChanged).toBe(false);
});

describe("appendCardsToDeck", () => {
    test("each card goes into the deck of its topic, in question order", async () => {
        const { note } = await load("#flashcards/test\nQ1::A1\nQ2::A2\nQ3::A3\n");
        const root = new Deck("Root", null);
        note.appendCardsToDeck(root);
        const deck = root.getDeck(new TopicPath(["flashcards", "test"]));
        expect(
            deck?.listOf(ReviewItemState.NewItem).map((c) => (c as { front?: string }).front),
        ).toEqual(["Q1", "Q2", "Q3"]);
    });

    test("a card of two topics is in both decks (the same card object)", async () => {
        const { note } = await load("#flashcards/a #flashcards/b\nQ1::A1\n");
        const root = new Deck("Root", null);
        note.appendCardsToDeck(root);
        const a = root.getDeck(new TopicPath(["flashcards", "a"]))?.listOf(ReviewItemState.NewItem);
        const b = root.getDeck(new TopicPath(["flashcards", "b"]))?.listOf(ReviewItemState.NewItem);
        expect(a).toHaveLength(1);
        expect(a?.[0]).toBe(b?.[0]);
    });

    test("it is not idempotent: twice makes duplicates", async () => {
        const { note } = await load("#flashcards/test\nQ1::A1\n");
        const root = new Deck("Root", null);
        note.appendCardsToDeck(root);
        note.appendCardsToDeck(root);
        const deck = root.getDeck(new TopicPath(["flashcards", "test"]));
        expect(deck?.listOf(ReviewItemState.NewItem)).toHaveLength(2);
    });
});

describe("writeNoteFile", () => {
    test("surplus schedule segments are left out of the cards and stay in the note", async () => {
        const text =
            "#flashcards\nQ1::A1\n<!--SR:!2023-09-02,4,270!2023-09-03,5,250-->\n\nQ2:::A2\n<!--SR:!2023-09-02,4,270!2023-09-03,5,250-->\n";
        const { file, note } = await load(text);
        expect(note.questionList[0].cards).toHaveLength(1);
        expect(note.hasChanged).toBe(false);
        const edit = jest.spyOn(file, "edit");
        const write = jest.spyOn(file, "write");
        await note.writeNoteFile(settings);
        expect(file.content).toBe(text);
        expect(write).not.toHaveBeenCalled();
        expect(edit).toHaveBeenCalledTimes(1);
    });

    test("a changed question is rewritten through one edit, and the changed flag is cleared", async () => {
        const { file, note } = await load("#flashcards\nQ1::A1\n<!--SR:!2023-09-02,4,270-->\n");
        note.questionList[0].cards[0].scheduleInfo = null;
        note.questionList[0].hasChanged = true;
        const edit = jest.spyOn(file, "edit");
        await note.writeNoteFile(settings);
        expect(stripCardIds(file.content)).toBe("#flashcards\nQ1::A1\n");
        expect(edit).toHaveBeenCalledTimes(1);
        expect(note.hasChanged).toBe(false);
    });

    test("it writes nothing when the text would stay the same (no new modification time)", async () => {
        const { file, note } = await load("#flashcards\nQ1::A1\n");
        const write = jest.spyOn(file, "write");
        await note.writeNoteFile(settings);
        expect(write).not.toHaveBeenCalled();
        expect(file.content).toBe("#flashcards\nQ1::A1\n");
    });

    test("a note with no questions stays as it is", async () => {
        const file = new UnitTestNoteFile("plain\n", "p.md");
        const note = new Note(file, []);
        await note.writeNoteFile(settings);
        expect(file.content).toBe("plain\n");
        expect(note.hasChanged).toBe(false);
    });
});
