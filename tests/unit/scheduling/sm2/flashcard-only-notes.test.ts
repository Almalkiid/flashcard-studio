import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { ActiveScheduler } from "src/scheduling/schedule/scheduler-kind";
import { setupStaticDateProvider } from "src/utils/clock";

import { loadGolden } from "../golden/load-golden";
import { FakeVault, makeCore, scan } from "./fake-vault";
import { loadedState, vaultSettings } from "./vault-state";

interface LoadedRow {
    id: string;
    vault: string;
    clock: string;
    noteEaseList: Record<string, number>;
}
const golden = loadGolden<{ vaultRuns: ({ id: string } & Partial<LoadedRow>)[] }>(
    "histogram",
).vaultRuns;
const loaded = golden.filter((row): row is LoadedRow => row.id.endsWith("/loaded"));

/** Only `notes6` of the test vaults is a note with scheduled flashcards and no `sr-*` frontmatter. */
const FLASHCARD_ONLY = new Set(["notes6"]);

describe("D2 #3: flashcard-only notes feed their cards' average ease to the note ease list", () => {
    test.each(loaded.filter((row) => FLASHCARD_ONLY.has(row.vault)))(
        "$id: the two cards (230, 270) give the note 250 and leave the other numbers as they were",
        async (row) => {
            expect(row.noteEaseList).toEqual({});
            await loadedState(FakeVault.fromTestVault(row.vault), row.clock);
            const easeList = ActiveScheduler.getInstance().noteStats().dict;
            expect(Object.keys(easeList)).toEqual(["A.md"]);
            expect(easeList["A.md"]).toBeCloseTo(250, 9);
        },
    );

    test("a new card of such a note starts from that ease", async () => {
        const vault = FakeVault.fromTestVault("notes6");
        await loadedState(vault, "2023-09-06");
        const algorithm = ActiveScheduler.getInstance();
        algorithm.noteStats().setEaseForPath("A.md", 300);
        const schedule = algorithm.cardGetNewSchedule(ReviewResponse.Good, "A.md", undefined);
        expect(schedule.latestEase).toBe(300);
    });

    test("a note with neither flashcards nor a schedule teaches nothing", async () => {
        await loadedState(FakeVault.fromTestVault("notes1"), "2023-09-06");
        expect(ActiveScheduler.getInstance().noteStats().dict).toEqual({});
    });
});

describe("what the scan teaches the ease list from a note's cards", () => {
    const cards = "Q1::A1 <!--SR:!2024-05-22,4,300-->\nQ2::A2 <!--SR:!2024-05-25,4,300-->";
    const ease = async (text: string): Promise<number | undefined> => {
        const vault = new FakeVault({ "N.md": text });
        setupStaticDateProvider("2023-09-06");
        const { core } = makeCore(vault, vaultSettings());
        await scan(vault, core);
        return ActiveScheduler.getInstance().noteStats().dict["N.md"];
    };

    // The inventory's figure for two cards averaging 300 with base ease 250: 300 * 0.2203 + 250 * 0.7797
    test("two cards at ease 300 and no schedule of its own: the pulled-in average, 261.0161", async () => {
        expect(await ease(`#flashcards\n\n${cards}`)).toBeCloseTo(261.0161, 3);
    });

    test("with a schedule of its own (ease 270) the note gets the halfway point, 265.508", async () => {
        const text = `---\nsr-due: 2025-02-21\nsr-interval: 421\nsr-ease: 270\n---\n#flashcards\n\n${cards}`;
        expect(await ease(text)).toBeCloseTo(265.508, 2);
    });

    test("with a schedule of its own and no cards the note keeps its own ease", async () => {
        expect(
            await ease(
                "---\nsr-due: 2025-02-21\nsr-interval: 421\nsr-ease: 270\n---\n#review\n\ntext",
            ),
        ).toBe(270);
    });
});
