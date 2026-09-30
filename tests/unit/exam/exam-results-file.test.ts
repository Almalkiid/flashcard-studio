import {
    ExamAnswer,
    ExamCardInput,
    ExamResult,
    ExamSetup,
    pickExamQuestions,
    scoreExam,
} from "src/exam/exam";
import {
    examFileName,
    examFilePath,
    EXAMS_FOLDER,
    formatExamFile,
    lastExams,
    parseExamFile,
} from "src/exam/exam-results-file";

const SETUP: ExamSetup = {
    decks: ["CIA"],
    count: 4,
    minutes: 150,
    filter: "all",
    passPercent: 75,
    title: 'CIA Part 1 · "practice" run',
};

const CARDS: ExamCardInput[] = [
    {
        id: "c1",
        deck: "CIA/Part1",
        front: "Who approves the charter?\n\n![[charter.png]]",
        back: "- [ ] The CAE\n- [x] The board\n- [ ] External auditors\nThe board approves it (6.2).\n```\nnot a fence end\n```",
        isCloze: false,
        suspended: false,
        sourcePath: "CIA/Part1/Charter.md",
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
    {
        id: "c4",
        deck: "CIA/Part2",
        front: "Explain independence in Arabic: الاستقلالية",
        back: "Freedom from threats.\nIt is organisational and individual.",
        isCloze: false,
        suspended: false,
    },
];

function makeResult(): ExamResult {
    const questions = pickExamQuestions(CARDS, { ...SETUP, shuffleOptions: false }, () => 0);
    const empty: ExamAnswer = { chosen: [], typed: "", selfRight: null, flagged: false, ms: 0 };
    const answers: ExamAnswer[] = [
        { ...empty, chosen: [0, 1], ms: 4200 },
        { ...empty, typed: "Chief Audit Executive", ms: 6100, flagged: true },
        { ...empty, selfRight: false, ms: 9000 },
        empty,
    ];
    return scoreExam(
        { ...SETUP, shuffleOptions: false },
        questions,
        answers,
        Date.parse("2026-09-30T14:00:00Z"),
        Date.parse("2026-09-30T14:07:30Z"),
        false,
    );
}

describe("examFileName", () => {
    test("is the local date and time of the end, then exam", () => {
        expect(examFileName(new Date(2026, 8, 30, 14, 5).getTime())).toBe(
            "2026-09-30 1405 exam.md",
        );
        expect(examFileName(new Date(2026, 0, 2, 3, 4).getTime())).toBe("2026-01-02 0304 exam.md");
    });

    test("the exams go in the Exams folder of Flashcard Studio", () => {
        expect(EXAMS_FOLDER).toBe("Flashcard Studio/Exams");
    });
});

describe("examFilePath", () => {
    const ended = new Date(2026, 8, 30, 14, 5).getTime();

    test("is the exams folder and the file name", () => {
        expect(examFilePath(ended, () => false)).toBe(
            "Flashcard Studio/Exams/2026-09-30 1405 exam.md",
        );
    });

    test("an exam ended in the same minute as another gets its own name", () => {
        const taken = new Set([
            "Flashcard Studio/Exams/2026-09-30 1405 exam.md",
            "Flashcard Studio/Exams/2026-09-30 1405 exam 2.md",
        ]);
        expect(examFilePath(ended, (path) => taken.has(path))).toBe(
            "Flashcard Studio/Exams/2026-09-30 1405 exam 3.md",
        );
    });
});

describe("formatExamFile", () => {
    test("is a title, a summary table and one fenced block with a line per question", () => {
        const text = formatExamFile(makeResult());
        const lines = text.split("\n");
        expect(lines[0]).toBe('# CIA Part 1 · "practice" run');
        expect(text).toContain("| Score | 50% (2 of 4) |");
        expect(text).toContain("| Result | Not passed (pass mark 75%) |");
        expect(text).toContain("| Time taken | 7 min 30 s |");
        expect(text).toContain("| CIA/Part1 | 1 of 2 |");
        expect(text).toContain("| CIA/Part2 | 1 of 2 |");
        expect(text).not.toMatch(/^---/);

        const start = lines.indexOf("```fs-exam");
        const end = lines.indexOf("```", start + 1);
        expect(start).toBeGreaterThan(0);
        // one line for the exam, then a line per question
        expect(end - start - 1).toBe(1 + 4);
        for (const line of lines.slice(start + 1, end)) {
            expect(() => {
                JSON.parse(line);
            }).not.toThrow();
        }
    });

    test("a question's text with line breaks and code fences stays on its one line", () => {
        const lines = formatExamFile(makeResult()).split("\n");
        const start = lines.indexOf("```fs-exam");
        const questionLines = lines.slice(start + 2, lines.indexOf("```", start + 1));
        const first = questionLines.find((line) => line.includes("charter.png"));
        expect(first).toBeDefined();
        expect(first).not.toContain("\n");
    });
});

describe("parseExamFile", () => {
    test("reads back what formatExamFile wrote", () => {
        const result = makeResult();
        expect(parseExamFile(formatExamFile(result))).toEqual(result);
    });

    test("scores again from the questions, so a hand-edited summary cannot change it", () => {
        const text = formatExamFile(makeResult()).replace(
            "| Score | 50% (2 of 4) |",
            "| Score | 99% |",
        );
        expect(parseExamFile(text)?.percent).toBe(50);
    });

    test.each([
        ["nothing", ""],
        ["a note without the block", "# Some note\n\nJust text."],
        ["a block that is not closed", "# T\n```fs-exam\n{}\n"],
        ["a block without the exam line", "# T\n```fs-exam\n```\n"],
        ["a line that is not JSON", "# T\n```fs-exam\n{not json\n```\n"],
    ])("%s is not an exam", (_name, text) => {
        expect(parseExamFile(text)).toBeNull();
    });

    test("an exam line without a setup or times is not an exam", () => {
        expect(parseExamFile('# T\n```fs-exam\n{"kind":"exam"}\n```\n')).toBeNull();
        expect(
            parseExamFile(
                '# T\n```fs-exam\n{"kind":"exam","startedMs":"soon","endedMs":2,"setup":{}}\n```\n',
            ),
        ).toBeNull();
    });

    test("a question line with the wrong shape is not an exam", () => {
        const good = formatExamFile(makeResult());
        const broken = good.replace('"kind":"choice"', '"kind":"riddle"');
        expect(parseExamFile(broken)).toBeNull();
    });
});

describe("lastExams", () => {
    function file(endedMs: number, title: string): { name: string; text: string } {
        const result = makeResult();
        const shifted: ExamResult = {
            ...result,
            endedMs,
            startedMs: endedMs - 60_000,
            setup: { ...result.setup, title },
        };
        return { name: examFileName(endedMs), text: formatExamFile(shifted) };
    }

    test("lists the newest first, whatever order the files come in", () => {
        const files = [
            file(Date.parse("2026-09-28T10:00:00Z"), "Old"),
            file(Date.parse("2026-09-30T10:00:00Z"), "Newest"),
            file(Date.parse("2026-09-29T10:00:00Z"), "Middle"),
        ];
        expect(lastExams(files, 5).map((r) => r.setup.title)).toEqual(["Newest", "Middle", "Old"]);
    });

    test("keeps only the newest n", () => {
        const files = [
            file(Date.parse("2026-09-28T10:00:00Z"), "Old"),
            file(Date.parse("2026-09-30T10:00:00Z"), "Newest"),
            file(Date.parse("2026-09-29T10:00:00Z"), "Middle"),
        ];
        expect(lastExams(files, 2).map((r) => r.setup.title)).toEqual(["Newest", "Middle"]);
    });

    test("skips files that are not exams, without counting them against n", () => {
        const files = [
            { name: "notes.md", text: "# Just a note" },
            file(Date.parse("2026-09-30T10:00:00Z"), "Real"),
            { name: "broken.md", text: "# T\n```fs-exam\n{oops\n```" },
        ];
        expect(lastExams(files, 1).map((r) => r.setup.title)).toEqual(["Real"]);
    });
});
