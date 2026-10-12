import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { ActiveScheduler } from "src/scheduling/schedule/scheduler-kind";
import { setupStaticDateProvider } from "src/utils/clock";

import { FakeVault, makeCore, scan } from "./fake-vault";
import { asCounts, asLines, vaultSettings } from "./vault-state";

afterEach(() => {
    jest.restoreAllMocks();
});

describe("P3-R2, P3-R7: a note whose schedule cannot be read is a new note", () => {
    test.each([
        ["sr-due: garbage\nsr-interval: 4\nsr-ease: 270"],
        ["sr-due: true\nsr-interval: 4\nsr-ease: 270"],
        ["sr-due: next tuesday\nsr-interval: 4\nsr-ease: 270"],
        ["sr-due: 2023-09-10\nsr-interval: abc\nsr-ease: 270"],
        ["sr-due: 2023-09-10\nsr-interval: 4\nsr-ease: abc"],
        ["sr-due: 2023-09-10\nsr-interval: null\nsr-ease: 270"],
    ])("%s", async (scheduleLines) => {
        const vault = new FakeVault({
            "N.md": `---\n${scheduleLines}\n---\n#review\n\ntext`,
        });
        setupStaticDateProvider("2023-09-06");
        const { core, queue } = makeCore(vault, vaultSettings());
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        await scan(vault, core);
        const deck = queue.reviewDecks.get("#review");
        expect(deck.newNotes.map((file) => file.path)).toEqual(["N.md"]);
        expect(deck.scheduledNotes).toEqual([]);
        expect(asCounts(core.dueDateNoteHistogram.dueDatesMap)).toEqual({});
        expect(ActiveScheduler.getInstance().noteStats().dict).toEqual({});
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("N.md"));
        warn.mockRestore();
    });

    test("reviewing it gives a first-review schedule", async () => {
        const vault = new FakeVault({
            "N.md": "---\nsr-due: garbage\nsr-interval: 4\nsr-ease: 270\n---\n#review\n\ntext",
        });
        setupStaticDateProvider("2023-09-06");
        const { core } = makeCore(vault, vaultSettings());
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
        await scan(vault, core);
        await core.saveNoteReviewResponse(vault.file("N.md"), ReviewResponse.Good, vaultSettings());
        expect(asLines(vault.frontmatter.get("N.md"))).toEqual({
            "sr-due": "2023-09-09",
            "sr-interval": "3",
            "sr-ease": "250",
        });
    });
});
