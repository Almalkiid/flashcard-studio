import { ExamAnswer, ExamCardInput, ExamSetup, pickExamQuestions } from "src/exam/exam";
import {
    draftKey,
    draftStatus,
    draftText,
    ExamDraft,
    makeDraft,
    newDraftId,
    readDraft,
    resumeOf,
    startFromDraft,
    unfinishedDrafts,
} from "src/exam/exam-draft";

const CARDS: ExamCardInput[] = [
    {
        id: "c1",
        deck: "CIA/Part1",
        front: "Who approves the charter?",
        back: "- [ ] The CAE\n- [x] The board\n- [ ] External auditors",
        isCloze: false,
        suspended: false,
        sourcePath: "CIA/Charter.md",
    },
    {
        id: "c2",
        deck: "CIA/Part1",
        front: "Which are lines of defence?",
        back: "- [x] Management\n- [x] Risk and compliance\n- [ ] The audit committee",
        isCloze: false,
        suspended: false,
    },
    {
        id: "c3",
        deck: "CIA/Part2",
        front: "What does CAE stand for?",
        back: "Chief Audit Executive",
        isCloze: false,
        suspended: false,
    },
];

const SETUP: ExamSetup = {
    decks: [],
    count: 3,
    minutes: 150,
    filter: "all",
    passPercent: 75,
    title: "Exam · CIA",
    shuffleOptions: false,
};

const QUESTIONS = pickExamQuestions(CARDS, SETUP, () => 0);
const EMPTY: ExamAnswer = { chosen: [], typed: "", selfRight: null, flagged: false, ms: 0 };
const START = Date.parse("2026-09-30T14:00:00Z");
const MINUTE = 60_000;

function answers(): ExamAnswer[] {
    return [
        { ...EMPTY, chosen: [0, 1], ms: 4000 },
        { ...EMPTY, chosen: [], flagged: true },
        { ...EMPTY, chosen: [] },
    ];
}

function draft(overrides: Partial<Parameters<typeof makeDraft>[0]> = {}): ExamDraft {
    return makeDraft(
        {
            setup: SETUP,
            questions: QUESTIONS,
            answers: answers(),
            current: 1,
            startedMs: START,
            ...overrides,
        },
        START + 10 * MINUTE,
    );
}

describe("makeDraft", () => {
    test("names the exam by when it started, and keeps everything needed to carry on", () => {
        const d = draft();
        expect(newDraftId(START)).toBe(String(START));
        expect(d).toMatchObject({
            version: 1,
            id: String(START),
            current: 1,
            startedMs: START,
            savedMs: START + 10 * MINUTE,
        });
        expect(d.setup).toEqual(SETUP);
        expect(d.questions).toEqual(QUESTIONS);
        expect(d.answers).toEqual(answers());
    });

    test("keeps the id it is given, so an exam that was taken up again saves under the name it had", () => {
        const d = draft({ id: "earlier" });
        expect(d.id).toBe("earlier");
        expect(d.startedMs).toBe(START);
    });

    test("the deadline is the start plus the limit, or nothing without a limit", () => {
        expect(draft().deadlineMs).toBe(START + 150 * MINUTE);
        expect(draft({ setup: { ...SETUP, minutes: null } }).deadlineMs).toBeNull();
    });

    test("holds a copy of the answers, which go on changing", () => {
        const live = answers();
        const d = draft({ answers: live });
        live[0].chosen.push(2);
        live[2].typed = "later";
        expect(d.answers[0].chosen).toEqual([0, 1]);
        expect(d.answers[2].typed).toBe("");
    });
});

describe("draftText", () => {
    test("keeps a multiple choice question's options once: in its answer text, not again as `choice`", () => {
        const text = draftText(draft());
        const stored = JSON.parse(text) as { questions: Record<string, unknown>[] };
        for (const question of stored.questions) expect(question).not.toHaveProperty("choice");
        // "External auditors" is an option of the first question, and is written where the answer text has it
        expect(text.match(/External auditors/g)).toHaveLength(1);
        expect(text.length).toBeLessThan(JSON.stringify(draft()).length);
    });

    test("reads back as the draft it was written from, the options worked out again", () => {
        const d = draft();
        const read = readDraft(JSON.parse(draftText(d)));
        expect(read).toEqual(d);
        const charter = read?.questions.find((q) => q.cardId === "c1");
        expect(charter?.choice?.options.map((option) => option.text)).toEqual([
            "The CAE",
            "The board",
            "External auditors",
        ]);
    });
});

describe("draftKey", () => {
    test("is the same for a draft that only differs in when it was written", () => {
        const first = draft();
        const later = makeDraft(
            {
                setup: SETUP,
                questions: QUESTIONS,
                answers: answers(),
                current: 1,
                startedMs: START,
            },
            START + 20 * MINUTE,
        );
        expect(later.savedMs).not.toBe(first.savedMs);
        expect(draftKey(later)).toBe(draftKey(first));
    });

    test.each([
        ["an answer", { answers: [{ ...EMPTY }, { ...EMPTY }, { ...EMPTY }] }],
        ["the question that is up", { current: 2 }],
        [
            "a flag",
            { answers: [{ ...EMPTY, chosen: [0, 1], ms: 4000, flagged: true }, EMPTY, EMPTY] },
        ],
    ])("differs with %s", (_name, change) => {
        expect(draftKey(draft(change))).not.toBe(draftKey(draft()));
    });
});

describe("readDraft", () => {
    test("reads back what makeDraft made, through JSON as the plugin's data does", () => {
        const d = draft();
        expect(readDraft(JSON.parse(JSON.stringify(d)))).toEqual(d);
    });

    test("works the options out from the answer text, whatever was stored as `choice`", () => {
        const raw = JSON.parse(JSON.stringify(draft())) as {
            questions: { choice: unknown }[];
        };
        raw.questions[0].choice = { lead: "", options: [], explanation: "", multiSelect: false };
        expect(readDraft(raw)?.questions[0].choice?.options).toHaveLength(3);
    });

    test("a multiple choice question whose answer text has no options makes the draft damaged", () => {
        const raw = JSON.parse(draftText(draft())) as { questions: { back: string }[] };
        raw.questions[0].back = "just text";
        expect(readDraft(raw)).toBeNull();
    });

    test("works the deadline out from the setup and the start, not from what was written", () => {
        const raw = JSON.parse(JSON.stringify(draft())) as Record<string, unknown>;
        raw.deadlineMs = 5;
        expect(readDraft(raw)?.deadlineMs).toBe(START + 150 * MINUTE);
    });

    test.each([
        ["nothing", null],
        ["text", "exam"],
        ["a list", []],
    ])("%s is not a draft", (_name, raw) => {
        expect(readDraft(raw)).toBeNull();
    });

    function withField(field: string, value: unknown): unknown {
        return {
            ...(JSON.parse(JSON.stringify(draft())) as Record<string, unknown>),
            [field]: value,
        };
    }

    test.each([
        ["another version", "version", 2],
        ["no id", "id", 5],
        ["a setup that is not one", "setup", { title: "x" }],
        ["no questions", "questions", []],
        ["questions that are not a list", "questions", "many"],
        ["a question that is broken", "questions", [{ cardId: "c1" }]],
        ["a different number of answers", "answers", [EMPTY]],
        ["an answer that is broken", "answers", [{}, {}, {}]],
        ["a position past the end", "current", 3],
        ["a negative position", "current", -1],
        ["a fractional position", "current", 0.5],
        ["a start that is not a number", "startedMs", "yesterday"],
        ["a save time that is not a number", "savedMs", null],
    ])("a draft with %s is not one", (_name, field, value) => {
        expect(readDraft(withField(field, value))).toBeNull();
    });
});

describe("draftStatus", () => {
    test("says where the exam was, how much is answered and how long is left", () => {
        const status = draftStatus(draft(), START + 47 * MINUTE);
        expect(status).toEqual({
            position: 2,
            total: 3,
            answered: 1,
            leftMs: 103 * MINUTE,
            timeUp: false,
        });
    });

    test("time keeps passing while the exam is closed: it is the deadline that counts", () => {
        const d = draft();
        // Saved at ten minutes, looked at three hours later
        expect(draftStatus(d, START + 3 * 60 * MINUTE)).toMatchObject({ leftMs: 0, timeUp: true });
        // At the deadline itself the time is up
        expect(draftStatus(d, START + 150 * MINUTE)).toMatchObject({ leftMs: 0, timeUp: true });
        expect(draftStatus(d, START + 150 * MINUTE - 1)).toMatchObject({ timeUp: false });
    });

    test("an exam without a limit has no time left to speak of, and its time is never up", () => {
        const d = draft({ setup: { ...SETUP, minutes: null } });
        expect(draftStatus(d, START + 999 * MINUTE)).toMatchObject({ leftMs: null, timeUp: false });
    });
});

describe("resumeOf", () => {
    test("carries the answers, the position and the start, as copies", () => {
        const d = draft();
        const resume = resumeOf(d);
        expect(resume).toEqual({
            id: String(START),
            answers: answers(),
            current: 1,
            startedMs: START,
        });
        resume.answers[0].chosen.push(2);
        expect(d.answers[0].chosen).toEqual([0, 1]);
    });
});

describe("startFromDraft", () => {
    test("is the exam to take again: its setup, its questions as they were, and where it was", () => {
        const d = draft();
        const start = startFromDraft(d);
        expect(start.setup).toEqual(SETUP);
        expect(start.questions).toEqual(QUESTIONS);
        expect(start.resume).toEqual({
            id: String(START),
            answers: answers(),
            current: 1,
            startedMs: START,
        });
    });
});

describe("unfinishedDrafts", () => {
    const older = { ...draft(), id: "older", savedMs: 100 };
    const newer = { ...draft(), id: "newer", savedMs: 200 };

    test("lists the good drafts, newest first, and skips what is not one", () => {
        const stored = [older, { id: "junk" }, newer, "x"];
        expect(unfinishedDrafts(stored, new Set()).map((d) => d.id)).toEqual(["newer", "older"]);
    });

    test("leaves out an exam that is on screen in this session", () => {
        expect(unfinishedDrafts([older, newer], new Set(["newer"])).map((d) => d.id)).toEqual([
            "older",
        ]);
    });

    test("nothing stored is no drafts", () => {
        expect(unfinishedDrafts([], new Set())).toEqual([]);
    });
});
