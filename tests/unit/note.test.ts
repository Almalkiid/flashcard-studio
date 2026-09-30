import { Deck } from "src/data/data-structures/deck/deck";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { DEFAULT_SETTINGS } from "src/data/settings";
import { Note } from "src/note/note";
import { NoteFileLoader } from "src/note/note-file-loader";
import { NoteParser } from "src/note/note-parser";
import { TextDirection } from "src/utils/strings";

import { UnitTestSRFile } from "./helpers/unit-test-file";
import { stripCardIds } from "./helpers/unit-test-helper";
import { unitTestSetupStandardDataStoreAlgorithm } from "./helpers/unit-test-setup";

const parser: NoteParser = new NoteParser(DEFAULT_SETTINGS);
const noteFileLoader: NoteFileLoader = new NoteFileLoader(DEFAULT_SETTINGS);

beforeAll(() => {
    unitTestSetupStandardDataStoreAlgorithm(DEFAULT_SETTINGS);
});

describe("appendCardsToDeck", () => {
    test("Multiple questions, single card per question", async () => {
        const noteText: string = `#flashcards/test
Q1::A1
Q2::A2
Q3::A3
`;
        const file: UnitTestSRFile = new UnitTestSRFile(noteText);
        const folderTopicPath = TopicPath.emptyPath;
        const note: Note = await parser.parse(file, TextDirection.Ltr, folderTopicPath);
        const deck: Deck = Deck.emptyDeck;
        note.appendCardsToDeck(deck);
        const subdeck: Deck = deck.getDeck(new TopicPath(["flashcards", "test"]));
        expect(subdeck.newRepItems[0].front).toEqual("Q1");
        expect(subdeck.newRepItems[1].front).toEqual("Q2");
        expect(subdeck.newRepItems[2].front).toEqual("Q3");
        expect(subdeck.dueRepItems.length).toEqual(0);
    });

    test("Multiple questions, multiple cards per question", async () => {
        const noteText: string = `#flashcards/test
Q1:::A1
Q2:::A2
Q3:::A3
`;
        const file: UnitTestSRFile = new UnitTestSRFile(noteText);
        const folderTopicPath = TopicPath.emptyPath;
        const note: Note = await parser.parse(file, TextDirection.Ltr, folderTopicPath);
        const deck: Deck = Deck.emptyDeck;
        note.appendCardsToDeck(deck);
        const subdeck: Deck = deck.getDeck(new TopicPath(["flashcards", "test"]));
        expect(subdeck.newRepItems.length).toEqual(6);
        const frontList = subdeck.newRepItems.map((card) => card.front);

        expect(frontList).toEqual(["Q1", "A1", "Q2", "A2", "Q3", "A3"]);
        expect(subdeck.dueRepItems.length).toEqual(0);
    });
});

describe("writeNoteFile", () => {
    test("Multiple questions, some with too many schedule details", async () => {
        const originalText: string = `#flashcards/test
Q1::A1
#flashcards Q2::A2
<!--SR:!2023-09-02,4,270!2023-09-02,5,270-->
Q3:::A3
<!--SR:!2023-09-02,4,270!2023-09-02,5,270!2023-09-02,6,270!2023-09-02,7,270-->
`;
        const file: UnitTestSRFile = new UnitTestSRFile(originalText);
        const note: Note = await noteFileLoader.load(file, TextDirection.Ltr, TopicPath.emptyPath);

        await note.writeNoteFile(DEFAULT_SETTINGS);
        const updatedText: string = file.content;

        const expectedText: string = `#flashcards/test
Q1::A1
#flashcards Q2::A2
<!--SR:!2023-09-02,4,270-->
Q3:::A3
<!--SR:!2023-09-02,4,270!2023-09-02,5,270-->
`;
        expect(stripCardIds(updatedText)).toEqual(expectedText);
    });
});

describe("image occlusion blocks that are not valid", () => {
    // Hand-edited into something that is not a block (no image, or no mask that reads): not a card, so nothing about it
    // may be rewritten when the note is loaded, and the schedules in the comment after it must survive
    const comment = "<!--SR:!2023-09-02,4,270!2023-09-02,5,270-->";
    test.each([
        [
            "no image",
            "```image-occlusion\nmask: a rect 0 0 .5 .5 | A\nmask: b rect .5 .5 .5 .5 | B\n```",
        ],
        [
            "no valid mask",
            "```image-occlusion\nimage: [[h.png]]\nmask: a rect zero 0 .5 .5 | A\n```",
        ],
    ])("a block with %s keeps its comment through a load and a write", async (_name, block) => {
        const originalText = `#flashcards/test\nQ1::A1\n\n${block}\n${comment}\n`;
        const file: UnitTestSRFile = new UnitTestSRFile(originalText);
        const note: Note = await noteFileLoader.load(file, TextDirection.Ltr, TopicPath.emptyPath);

        // What the data manager does after a load: a note with a changed question is written back
        expect(note.hasChanged).toBe(false);
        await note.writeNoteFile(DEFAULT_SETTINGS);
        expect(file.content).toEqual(originalText);
        expect(note.questionList.map((question) => question.lineNo)).toEqual([1]);
    });
});
