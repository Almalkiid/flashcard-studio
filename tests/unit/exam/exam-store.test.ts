import { App, TFile } from "obsidian";

import { ExamCardInput, ExamSetup, pickExamQuestions, scoreExam } from "src/exam/exam";
import { EXAMS_FOLDER, formatExamFile } from "src/exam/exam-results-file";
import { readExamResults } from "src/exam/exam-store";

const CARDS: ExamCardInput[] = [
    {
        id: "c1",
        deck: "CIA",
        front: "Who approves the charter?",
        back: "- [ ] The CAE\n- [x] The board",
        isCloze: false,
        suspended: false,
    },
];
const SETUP: ExamSetup = {
    decks: [],
    count: 1,
    minutes: null,
    filter: "all",
    passPercent: 75,
    title: "Exam",
    shuffleOptions: false,
};

/** The file of an exam called `title` that ended at `endedMs`, a minute after it started. */
function examText(title: string, endedMs: number): string {
    const setup = { ...SETUP, title };
    const questions = pickExamQuestions(CARDS, setup, () => 0);
    return formatExamFile(scoreExam(setup, questions, [], endedMs - 60_000, endedMs, false));
}

/** A vault whose exams folder holds these files, by name, in no particular order; records which files are read. */
function vaultWith(files: Record<string, string>): { app: App; read: string[] } {
    const read: string[] = [];
    const children = Object.keys(files).map((name) =>
        Object.assign(new TFile(), { name, extension: "md", path: `${EXAMS_FOLDER}/${name}` }),
    );
    const vault = {
        getFolderByPath: (path: string) => (path === EXAMS_FOLDER ? { children } : null),
        cachedRead: (file: TFile) => {
            read.push(file.name);
            return Promise.resolve(files[file.name]);
        },
    };
    return { app: { vault } as unknown as App, read };
}

describe("readExamResults", () => {
    test("of two exams that ended in the same minute, the later one is the last exam", async () => {
        // The second gets the name `... exam 2.md`, which comes before `... exam.md` when names are sorted newest first
        const { app } = vaultWith({
            "2026-09-30 1405 exam.md": examText("First", Date.parse("2026-09-30T14:05:02Z")),
            "2026-09-30 1405 exam 2.md": examText("Second", Date.parse("2026-09-30T14:05:42Z")),
            "2026-09-30 1300 exam.md": examText("Earlier", Date.parse("2026-09-30T13:00:00Z")),
        });
        const [last] = await readExamResults(app, 1);
        expect(last.setup.title).toBe("Second");
        expect((await readExamResults(app, 2)).map((exam) => exam.setup.title)).toEqual([
            "Second",
            "First",
        ]);
    });

    test("an exam that ended after the clocks went back is the last exam, though its name is earlier", async () => {
        // New York: one exam ends at 01:50 summer time; half an hour later the clocks have gone back and read 01:20
        const { app } = vaultWith({
            "2026-11-01 0150 exam.md": examText("Before", Date.parse("2026-11-01T05:50:00Z")),
            "2026-11-01 0120 exam.md": examText("After", Date.parse("2026-11-01T06:20:00Z")),
        });
        const [last] = await readExamResults(app, 1);
        expect(last.setup.title).toBe("After");
    });

    test("stops reading at files named more than a day before the last exam needed", async () => {
        const { app, read } = vaultWith({
            "2026-09-30 1405 exam.md": examText("Newest", Date.parse("2026-09-30T14:05:00Z")),
            "2026-09-29 1300 exam.md": examText("Day before", Date.parse("2026-09-29T13:00:00Z")),
            "2026-09-20 0900 exam.md": examText("Old", Date.parse("2026-09-20T09:00:00Z")),
            "2026-09-10 0900 exam.md": examText("Older", Date.parse("2026-09-10T09:00:00Z")),
        });
        expect((await readExamResults(app, 1)).map((exam) => exam.setup.title)).toEqual(["Newest"]);
        expect(read).toEqual(["2026-09-30 1405 exam.md", "2026-09-29 1300 exam.md"]);
    });

    test("skips files that are not exams, without counting them", async () => {
        const { app } = vaultWith({
            "2026-09-30 1405 exam.md": "# Just a note",
            "notes.md": "# Also a note",
            "2026-09-29 0900 exam.md": examText("Real", Date.parse("2026-09-29T09:00:00Z")),
        });
        expect((await readExamResults(app, 1)).map((exam) => exam.setup.title)).toEqual(["Real"]);
    });

    test("no exams folder is no exams", async () => {
        const app = { vault: { getFolderByPath: (): null => null } } as unknown as App;
        expect(await readExamResults(app, 1)).toEqual([]);
    });
});
