import { Sm2NoteStore } from "src/data/data-store/notes/comment-algorithm";
import { NotesDataStore } from "src/data/data-store/notes/notes-store";
import { DataStore, DataStoreAlgorithm, type IFileModifier } from "src/data/data-store/store";
import { TopicPath } from "src/data/decks/topic-path";
import { DEFAULT_SETTINGS } from "src/data/settings-model";
import { Note } from "src/note-review/note";
import { NoteFileLoader } from "src/note-review/note-file-loader";
import { Sm2State } from "src/scheduling/schedule/sm2-state";
import { setupStaticDateProvider } from "src/utils/clock";
import { TextDirection } from "src/utils/text";

import { FakeVault } from "../../scheduling/sm2/fake-vault";

// D2 #2: writing a question says whether it happened. When the note no longer holds the question as it was read, the
// note is not written at all (before, its unchanged text was written back and the caller could not tell).

const settings = { ...DEFAULT_SETTINGS };

async function load(text: string): Promise<{ vault: FakeVault; note: Note }> {
    setupStaticDateProvider("2023-09-06");
    DataStore.instance = new NotesDataStore(settings, {} as IFileModifier);
    DataStoreAlgorithm.instance = new Sm2NoteStore(settings);
    const vault = new FakeVault({ "N.md": text });
    const note = await new NoteFileLoader(settings).load(
        vault.file("N.md"),
        TextDirection.Ltr,
        new TopicPath(["Root"]),
    );
    return { vault, note };
}

test("a question still in its note is written, and the store says so", async () => {
    const { vault, note } = await load("#flashcards Q1::A1\n");
    const card = note.questionList[0].cards[0];
    card.scheduleInfo = Sm2State.fromDueDateStr("2023-09-09", 3, 250);

    expect(await DataStore.getInstance().writeSchedule(note.questionList[0])).toBe(true);
    expect(vault.texts.get("N.md")).toMatch(/^#flashcards Q1::A1\n<!--SR:!2023-09-09,3,250,id=/);
});

test("a question edited elsewhere is not written, and the store says so", async () => {
    const { vault, note } = await load("#flashcards Q1::A1\n");
    vault.texts.set("N.md", "#flashcards Q1 edited::A1\n");
    const modify = jest.spyOn(vault.vault, "modify");
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const question = note.questionList[0];
    question.cards[0].scheduleInfo = Sm2State.fromDueDateStr("2023-09-09", 3, 250);

    expect(await DataStore.getInstance().write(question)).toBe(false);
    expect(await question.writeQuestion(settings)).toBe(false);
    expect(modify).not.toHaveBeenCalled();
    expect(vault.texts.get("N.md")).toBe("#flashcards Q1 edited::A1\n");
    // The question keeps the text it was read with
    expect(question.questionText.original).toBe("#flashcards Q1::A1");
    warn.mockRestore();
});

test("rewriting inside a text gives null when the question is not there, and the old method keeps the text", async () => {
    const { note } = await load("#flashcards Q1::A1\n");
    const question = note.questionList[0];
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(question.rewriteWithinNoteText("something else\n", settings)).toBeNull();
    expect(question.updateQuestionWithinNoteText("something else\n", settings)).toBe(
        "something else\n",
    );
    warn.mockRestore();
});
