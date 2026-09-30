import { ExamAnswer, ExamCardInput, ExamSetup, pickExamQuestions } from "src/exam/exam";
import { draftText, makeDraft } from "src/exam/exam-draft";
import {
    discardExamDraft,
    markExamGone,
    markExamLive,
    migrateExamDrafts,
    saveExamDraft,
    unfinishedExams,
    writeExamDraft,
} from "src/exam/exam-draft-store";
import type SRPlugin from "src/main";

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
};
const QUESTIONS = pickExamQuestions(CARDS, SETUP, () => 0);
const EMPTY: ExamAnswer = { chosen: [], typed: "", selfRight: null, flagged: false, ms: 0 };

const FOLDER = ".obsidian/plugins/flashcard-studio/exam-drafts";
const DEVICE = "mac-1a2b";

function draftAt(startedMs: number, savedMs: number, answer: Partial<ExamAnswer> = {}) {
    return makeDraft(
        {
            setup: SETUP,
            questions: QUESTIONS,
            answers: [{ ...EMPTY, ...answer }],
            current: 0,
            startedMs,
        },
        savedMs,
    );
}

/** A draft as the plugin's data held it: through JSON. */
function plain(draft: ReturnType<typeof draftAt>): unknown {
    return JSON.parse(JSON.stringify(draft)) as unknown;
}

function pause(ms = 10): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** The plugin folder as Obsidian's file adapter has it, in memory; a write takes `delayMs`. */
function fakePlugin(delayMs = 0, device = DEVICE) {
    const files = new Map<string, string>();
    const folders = new Set<string>();
    const writes: { path: string; text: string }[] = [];
    const removes: string[] = [];
    const behaviour = { failWrites: 0 };
    const adapter = {
        exists: (path: string) => Promise.resolve(files.has(path) || folders.has(path)),
        mkdir: (path: string) => {
            folders.add(path);
            return Promise.resolve();
        },
        write: async (path: string, text: string) => {
            await pause(delayMs);
            if (behaviour.failWrites > 0) {
                behaviour.failWrites--;
                throw new Error("disk full");
            }
            writes.push({ path, text });
            files.set(path, text);
        },
        read: (path: string) => {
            const text = files.get(path);
            return text === undefined
                ? Promise.reject(new Error("no file"))
                : Promise.resolve(text);
        },
        remove: (path: string) => {
            removes.push(path);
            files.delete(path);
            return Promise.resolve();
        },
        list: (folder: string) =>
            Promise.resolve({
                files: [...files.keys()].filter((path) => path.startsWith(`${folder}/`)),
                folders: [],
            }),
    };
    const plugin = {
        app: {
            vault: { adapter, configDir: ".obsidian" },
            loadLocalStorage: () => device,
            saveLocalStorage: (): void => undefined,
        },
        manifest: { id: "flashcard-studio", dir: ".obsidian/plugins/flashcard-studio" },
    };
    return { plugin: plugin as unknown as SRPlugin, files, writes, removes, behaviour };
}

describe("the exam draft store", () => {
    test("a draft is a file of its own in the plugin's folder, named for the exam and this device", async () => {
        const { plugin, files } = fakePlugin();
        await saveExamDraft(plugin, draftAt(1000, 5000));
        expect([...files.keys()]).toEqual([`${FOLDER}/1000-${DEVICE}.json`]);
        // The text is the draft's, without a second copy of the options
        expect(files.get(`${FOLDER}/1000-${DEVICE}.json`)).toBe(draftText(draftAt(1000, 5000)));
        expect(files.get(`${FOLDER}/1000-${DEVICE}.json`)).not.toContain('"choice":');
        expect((await unfinishedExams(plugin)).map((d) => d.id)).toEqual(["1000"]);
    });

    test("a draft is written when it has changed, not when only the clock has moved on", async () => {
        const { plugin, writes } = fakePlugin();
        await saveExamDraft(plugin, draftAt(1000, 1));
        // The same exam, the same answers, saved again later: nothing new to keep
        await saveExamDraft(plugin, draftAt(1000, 2));
        await saveExamDraft(plugin, draftAt(1000, 3));
        expect(writes).toHaveLength(1);
        // An answer is a change
        await saveExamDraft(plugin, draftAt(1000, 4, { chosen: [1] }));
        expect(writes).toHaveLength(2);
        // Going back to what the file had before is a change from what it holds now
        await saveExamDraft(plugin, draftAt(1000, 5));
        expect(writes).toHaveLength(3);
    });

    test("saving again replaces the draft of the same exam and keeps another exam's", async () => {
        const { plugin, files } = fakePlugin();
        await saveExamDraft(plugin, draftAt(1000, 5000));
        await saveExamDraft(plugin, draftAt(2000, 6000));
        await saveExamDraft(plugin, draftAt(1000, 7000, { typed: "x" }));
        expect(files.size).toBe(2);
        const drafts = await unfinishedExams(plugin);
        expect(drafts.map((d) => [d.id, d.savedMs])).toEqual([
            ["1000", 7000],
            ["2000", 6000],
        ]);
    });

    test("saves that pile up while one is being written are written once more, after it", async () => {
        const { plugin, writes } = fakePlugin(30);
        void saveExamDraft(plugin, draftAt(1000, 1, { typed: "a" }));
        // The first is being written
        await pause(5);
        void saveExamDraft(plugin, draftAt(1000, 2, { typed: "ab" }));
        void saveExamDraft(plugin, draftAt(1000, 3, { typed: "abc" }));
        await pause(200);
        // The first, and one for the rest: the last state is the one that ends up written
        expect(writes).toHaveLength(2);
        const last = JSON.parse(writes[1].text) as { answers: { typed: string }[] };
        expect(last.answers[0].typed).toBe("abc");
    });

    test("a discarded exam's file is gone, and discarding what is not there does nothing", async () => {
        const { plugin, files, removes } = fakePlugin();
        await saveExamDraft(plugin, draftAt(1000, 1));
        await discardExamDraft(plugin, "1000");
        expect(files.size).toBe(0);
        expect(removes).toHaveLength(1);
        await discardExamDraft(plugin, "1000");
        expect(removes).toHaveLength(1);
        expect(await unfinishedExams(plugin)).toEqual([]);
    });

    test("discarding right after a save leaves no file, and the save is not written again", async () => {
        const { plugin, files, writes } = fakePlugin(20);
        void saveExamDraft(plugin, draftAt(1000, 1));
        // The first is being written
        await pause(5);
        void saveExamDraft(plugin, draftAt(1000, 2, { typed: "later" }));
        await discardExamDraft(plugin, "1000");
        await pause(80);
        expect(files.size).toBe(0);
        // The first was on its way; the second was still waiting and never written
        expect(writes).toHaveLength(1);
        // The same exam saved after the discard is written again: the discard forgot it
        await saveExamDraft(plugin, draftAt(1000, 3));
        expect(files.size).toBe(1);
    });

    test("an exam that is open in this session is not offered for resuming", async () => {
        const { plugin } = fakePlugin();
        await saveExamDraft(plugin, draftAt(1000, 1));
        await saveExamDraft(plugin, draftAt(2000, 2));
        markExamLive("2000");
        expect((await unfinishedExams(plugin)).map((d) => d.id)).toEqual(["1000"]);
        markExamGone("2000");
        expect((await unfinishedExams(plugin)).map((d) => d.id)).toEqual(["2000", "1000"]);
    });

    test("only this device's drafts are offered, and a file that is not a whole draft is skipped", async () => {
        const { plugin, files } = fakePlugin();
        await saveExamDraft(plugin, draftAt(1000, 1));
        // Another device's exam, which syncs here, is that device's to resume
        files.set(`${FOLDER}/3000-iphone-81c2.json`, draftText(draftAt(3000, 9)));
        files.set(`${FOLDER}/4000-${DEVICE}.json`, "{ not json");
        files.set(`${FOLDER}/5000-${DEVICE}.json`, JSON.stringify({ id: "5000" }));
        files.set(`${FOLDER}/notes.txt`, "hello");
        expect((await unfinishedExams(plugin)).map((d) => d.id)).toEqual(["1000"]);
    });

    test("no folder is no drafts", async () => {
        const { plugin } = fakePlugin();
        expect(await unfinishedExams(plugin)).toEqual([]);
    });

    test("a write that fails is tried once more", async () => {
        const { plugin, files, behaviour } = fakePlugin();
        behaviour.failWrites = 1;
        await saveExamDraft(plugin, draftAt(1000, 1));
        expect(files.size).toBe(1);
    });

    test("a write that fails twice does not throw, and the same draft is written the next time it is saved", async () => {
        const { plugin, files, behaviour } = fakePlugin();
        const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
        behaviour.failWrites = 2;
        await saveExamDraft(plugin, draftAt(1000, 1));
        expect(files.size).toBe(0);
        expect(log).toHaveBeenCalledTimes(1);
        await saveExamDraft(plugin, draftAt(1000, 2));
        expect(files.size).toBe(1);
        log.mockRestore();
    });

    test("writeExamDraft says when the file could not be written", async () => {
        const { plugin, behaviour } = fakePlugin();
        behaviour.failWrites = 2;
        await expect(writeExamDraft(plugin, draftAt(1000, 1))).rejects.toThrow("disk full");
    });
});

describe("moving the drafts out of the plugin's data", () => {
    test("each draft that is whole is written as a file of this device's, and what is not is dropped", async () => {
        const { plugin, files } = fakePlugin();
        const stored = {
            "1000": plain(draftAt(1000, 1)),
            "2000": plain(draftAt(2000, 2, { chosen: [1] })),
            junk: { id: "junk" },
        };
        expect(await migrateExamDrafts(plugin, stored)).toBe(true);
        expect([...files.keys()].sort()).toEqual([
            `${FOLDER}/1000-${DEVICE}.json`,
            `${FOLDER}/2000-${DEVICE}.json`,
        ]);
        expect((await unfinishedExams(plugin)).map((d) => d.id)).toEqual(["2000", "1000"]);
    });

    test.each([
        ["nothing", undefined],
        ["an empty list of drafts", {}],
        ["something that is not one", "text"],
        ["a list", []],
    ])("%s is nothing to move, and nothing is written", async (_name, stored) => {
        const { plugin, files } = fakePlugin();
        expect(await migrateExamDrafts(plugin, stored)).toBe(true);
        expect(files.size).toBe(0);
    });

    test("when a draft cannot be written they are not all moved, so the data keeps them", async () => {
        const { plugin, behaviour } = fakePlugin();
        const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
        behaviour.failWrites = 2;
        expect(
            await migrateExamDrafts(plugin, {
                "1000": plain(draftAt(1000, 1)),
            }),
        ).toBe(false);
        log.mockRestore();
    });
});
