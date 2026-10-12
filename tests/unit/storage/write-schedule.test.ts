import { DataStore, Question } from "./api";
import { golden, load, scheduleFor, settingsWith, setUp, view } from "./helpers";

interface Op {
    q: number;
    c: number;
    set?: "sm2" | "fsrs" | "clear";
    due?: string;
    interval?: number;
    ease?: number;
    meta?: Record<string, unknown>;
}

interface Row {
    id: string;
    options: Record<string, unknown>;
    input: string;
    operations: Op[];
    writePath: "writeSchedule" | "writeQuestion" | "writeNoteFile";
    output: string;
    noteChanged: boolean;
    warnings: string[];
    reparse: ReturnType<typeof view>;
}

const rows = golden<Row[]>("write-schedule");

const sm2 = (due: string, id: string) => ({ schedule: `!${due},12,260`, id });
const none: { schedule: string | null; id: string | null } = { schedule: null, id: null };

// The rows whose result changed on purpose: the golden value was the bug (a write went to the first look-alike, or the
// note lost its line endings). Each is pinned to the corrected value.
const CHANGED: Record<string, Pick<Row, "output" | "reparse">> = {
    // fix 1: a write goes to the card it belongs to
    "w-dup-both": {
        output: "#flashcards\nQ::A\n<!--SR:!2026-11-01,12,260,id=012345-->\n\nQ::A\n<!--SR:!2026-12-01,12,260,id=6789ab-->",
        reparse: [
            { type: 0, cards: [sm2("2026-11-01", "012345")] },
            { type: 0, cards: [sm2("2026-12-01", "6789ab")] },
        ],
    },
    "w-dup-second": {
        output: "#flashcards\nQ::A\n\nQ::A\n<!--SR:!2026-10-20,12,260,id=012345-->",
        reparse: [
            { type: 0, cards: [none] },
            { type: 0, cards: [sm2("2026-10-20", "012345")] },
        ],
    },
    "w-substring": {
        output: "#flashcards\nQ::AB\n\nQ::A\n<!--SR:!2026-10-20,12,260,id=012345-->",
        reparse: [
            { type: 0, cards: [none] },
            { type: 0, cards: [sm2("2026-10-20", "012345")] },
        ],
    },
    // behaviour inventory section 15 item 13 (pinned in cards-clean-room as sl-sched-callout-nocomment): a metadata callout without a comment no longer swallows the next card, so R::S after the emptied wrapper is its own question
    "w-sl-callout-undo": {
        output: "#flashcards\nQ::A\n> [!sr|card-metadata] \n>\n\nR::S",
        reparse: [
            { type: 0, cards: [none] },
            { type: 0, cards: [none] },
        ],
    },
    // fix 5: the line endings of the note stay as they are
    "w-crlf": {
        output: "#flashcards\r\nQ::A\r\n<!--SR:!2026-10-20,12,260,id=012345-->\r\nR::S\r\n",
        reparse: [
            { type: 0, cards: [sm2("2026-10-20", "012345")] },
            { type: 0, cards: [none] },
        ],
    },
    "w-crlf-ml": {
        output: "#flashcards\r\nQ\r\n?\r\nA\r\n<!--SR:!2026-10-20,12,260,id=012345-->\r\n\r\nR::S\r\n",
        reparse: [
            { type: 2, cards: [sm2("2026-10-20", "012345")] },
            { type: 0, cards: [none] },
        ],
    },
};

describe.each(rows)("write: $id", (row) => {
    test("the note text, the flag and what loading it again gives", async () => {
        const settings = settingsWith(row.options);
        setUp(settings);
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const { vault, note } = await load(row.input, settings);
        const touched: Question[] = [];
        for (const op of row.operations) {
            const question = note.questionList[op.q];
            const card = question.cards[op.c];
            if (op.set === "clear") card.scheduleInfo = null;
            else if (op.set) card.scheduleInfo = scheduleFor({ ...op, set: op.set });
            if (op.meta) Object.assign(card.meta, op.meta);
            if (!touched.includes(question)) touched.push(question);
        }
        warn.mockClear();

        if (row.writePath === "writeNoteFile") {
            touched.forEach((question) => (question.hasChanged = true));
            await note.writeNoteFile(settings);
        } else {
            for (const question of touched) {
                if (row.writePath === "writeQuestion") await question.writeQuestion(settings);
                else await DataStore.getInstance().writeSchedule(question);
            }
        }

        const expected = { ...row, ...CHANGED[row.id] };
        const output = vault.texts.get("N.md");
        expect(output).toBe(expected.output);
        expect(output !== row.input).toBe(row.noteChanged);
        expect(warn.mock.calls.length).toBe(row.warnings.length);
        expect(view((await load(output, settings)).note)).toEqual(expected.reparse);
        warn.mockRestore();
    });
});
