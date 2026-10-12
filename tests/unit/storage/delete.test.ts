import { DataStore } from "./api";
import { golden, load, settingsWith, setUp } from "./helpers";

interface Row {
    id: string;
    options: Record<string, unknown>;
    input: string;
    deletedQuestionIndex: number;
    deletedOriginalText: string;
    output: string;
    written: boolean;
}

const rows = golden<Row[]>("delete-question");

// Rows whose result changed on purpose, pinned to the corrected value
const CHANGED: Record<string, string> = {
    // fix 4: the tag line of a card directly under it stays; fix 5: line endings stay
    "d-ml": "#flashcards\n\n\nB::2\n",
    "d-crlf": "#flashcards\r\n\r\n\r\nB::2\r\n",
    // fix 1: the card that is deleted is the one asked for
    "d-dup": "#flashcards\nA::1\n\n\n",
};

// Two rows delete a question of a note that is not the text it was read from any more
const READ_FROM: Record<string, string> = {
    "d-note-changed": "#flashcards\nA::1\nB::2\n",
    "d-trimmed-match": "#flashcards\nA::1\nB::2\n",
};

describe.each(rows)("delete: $id", (row) => {
    test("the note text afterwards and whether it was written", async () => {
        const settings = settingsWith(row.options);
        setUp(settings);
        const { vault, note } = await load(READ_FROM[row.id] ?? row.input, settings, ["Root"]);
        vault.texts.set("N.md", row.input);
        const question = note.questionList[row.deletedQuestionIndex];
        expect(question.questionText.original).toBe(row.deletedOriginalText);

        await DataStore.getInstance().delete(question);

        const output = vault.texts.get("N.md");
        expect(output).toBe(CHANGED[row.id] ?? row.output);
        expect(output !== row.input || row.written === false).toBe(true);
        expect(output !== row.input).toBe(row.written);
    });
});
