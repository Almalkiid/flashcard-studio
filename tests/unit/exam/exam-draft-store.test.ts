import { ExamAnswer, ExamCardInput, ExamSetup, pickExamQuestions } from "src/exam/exam";
import { makeDraft } from "src/exam/exam-draft";
import {
    discardExamDraft,
    markExamGone,
    markExamLive,
    saveExamDraft,
    unfinishedExams,
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

function draftAt(startedMs: number, savedMs: number) {
    return makeDraft(
        { setup: SETUP, questions: QUESTIONS, answers: [{ ...EMPTY }], current: 0, startedMs },
        savedMs,
    );
}

/** A plugin that has plugin data, and counts the writes; a write takes `delayMs`. */
function fakePlugin(delayMs = 0) {
    const writes: string[] = [];
    const data: { examDrafts?: Record<string, unknown> } = {};
    const plugin = {
        dataManager: {
            data,
            pluginDataManager: {
                savePluginData: async () => {
                    // What is written is what the data holds when the write starts
                    writes.push(JSON.stringify(data.examDrafts ?? {}));
                    await new Promise((resolve) => window.setTimeout(resolve, delayMs));
                },
            },
        },
    };
    return { plugin: plugin as unknown as SRPlugin, data, writes };
}

describe("the exam draft store", () => {
    test("a saved draft is in the plugin's data and is written", async () => {
        const { plugin, data, writes } = fakePlugin();
        saveExamDraft(plugin, draftAt(1000, 5000));
        expect(Object.keys(data.examDrafts ?? {})).toEqual(["1000"]);
        await new Promise((resolve) => window.setTimeout(resolve, 10));
        expect(writes).toHaveLength(1);
        expect(unfinishedExams(plugin).map((d) => d.id)).toEqual(["1000"]);
    });

    test("saving again replaces the draft of the same exam and keeps another exam's", () => {
        const { plugin } = fakePlugin();
        saveExamDraft(plugin, draftAt(1000, 5000));
        saveExamDraft(plugin, draftAt(2000, 6000));
        saveExamDraft(plugin, draftAt(1000, 7000));
        const drafts = unfinishedExams(plugin);
        expect(drafts.map((d) => [d.id, d.savedMs])).toEqual([
            ["1000", 7000],
            ["2000", 6000],
        ]);
    });

    test("saves that pile up while one is being written are written once more, after it", async () => {
        const { plugin, writes } = fakePlugin(30);
        saveExamDraft(plugin, draftAt(1000, 1));
        saveExamDraft(plugin, draftAt(1000, 2));
        saveExamDraft(plugin, draftAt(1000, 3));
        await new Promise((resolve) => window.setTimeout(resolve, 150));
        // The first, and one for the rest: the last state is the one that ends up written
        expect(writes).toHaveLength(2);
        expect((JSON.parse(writes[1]) as Record<string, { savedMs: number }>)["1000"].savedMs).toBe(
            3,
        );
    });

    test("a discarded exam is gone from the data and the change is written", async () => {
        const { plugin, data, writes } = fakePlugin();
        saveExamDraft(plugin, draftAt(1000, 1));
        await new Promise((resolve) => window.setTimeout(resolve, 10));
        discardExamDraft(plugin, "1000");
        expect(data.examDrafts).toEqual({});
        await new Promise((resolve) => window.setTimeout(resolve, 10));
        expect(writes).toHaveLength(2);
        // Discarding what is not there writes nothing
        discardExamDraft(plugin, "1000");
        await new Promise((resolve) => window.setTimeout(resolve, 10));
        expect(writes).toHaveLength(2);
    });

    test("an exam that is open in this session is not offered for resuming", () => {
        const { plugin } = fakePlugin();
        saveExamDraft(plugin, draftAt(1000, 1));
        saveExamDraft(plugin, draftAt(2000, 2));
        markExamLive("2000");
        expect(unfinishedExams(plugin).map((d) => d.id)).toEqual(["1000"]);
        markExamGone("2000");
        expect(unfinishedExams(plugin).map((d) => d.id)).toEqual(["2000", "1000"]);
    });

    test("a write that fails does not throw, and the next one goes ahead", async () => {
        const { plugin } = fakePlugin();
        const manager = (
            plugin as unknown as {
                dataManager: { pluginDataManager: { savePluginData: () => Promise<void> } };
            }
        ).dataManager.pluginDataManager;
        let calls = 0;
        manager.savePluginData = () => {
            calls++;
            return calls === 1 ? Promise.reject(new Error("disk full")) : Promise.resolve();
        };
        const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
        saveExamDraft(plugin, draftAt(1000, 1));
        await new Promise((resolve) => window.setTimeout(resolve, 10));
        saveExamDraft(plugin, draftAt(1000, 2));
        await new Promise((resolve) => window.setTimeout(resolve, 10));
        expect(calls).toBe(2);
        expect(log).toHaveBeenCalledTimes(1);
        log.mockRestore();
    });
});
