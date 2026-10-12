import { DataManager } from "src/data/data-hub";
import { SettingsUtil } from "src/data/settings-model";
import { inPathOrder } from "src/note-review/path-order";
import { ReviewResponse } from "src/scheduling/schedule/review-item";

import { settingsWith } from "./helpers/scenario";

let mockTags: string[] = [];
jest.mock("src/data/data-structures/file/vault-note", () => ({
    ...jest.requireActual<object>("src/data/data-structures/file/vault-note"),
    VaultNoteFile: class {
        getAllTagsFromCache() {
            return mockTags;
        }
    },
}));
jest.mock("obsidian", () => jest.requireActual<object>("./helpers/obsidian-dom-mock.cjs"));
jest.mock("src/ui/obsidian-ui-components/item-views/review-queue.css", () => ({}));
jest.mock("src/ui/obsidian-ui-components/modals/confirm-modal.css", () => ({}));

const notices = (require("obsidian") as { __log: { notices: string[] } }).__log.notices;

describe("bug 9: review tags match without regard to case, as Obsidian treats tags", () => {
    const settings = settingsWith({
        tagsToReview: ["#review", "#Study/Deep"],
        noteTagsToIgnore: ["#Skip"],
    });

    test("a tag under a review tag", () => {
        expect(SettingsUtil.isAnyTagANoteReviewTag(settings, ["#Review"])).toBe(true);
        expect(SettingsUtil.isAnyTagANoteReviewTag(settings, ["#REVIEW/sub"])).toBe(true);
        expect(SettingsUtil.isAnyTagANoteReviewTag(settings, ["#study/deep/x"])).toBe(true);
        expect(SettingsUtil.isAnyTagANoteReviewTag(settings, ["#reviewer", "#review-2"])).toBe(
            false,
        );
    });

    test("the deck is named by the setting, not by the note's own spelling", () => {
        expect(SettingsUtil.filterForNoteReviewTag(settings, ["#REVIEW", "#study/DEEP"])).toEqual([
            "#review",
            "#Study/Deep",
        ]);
    });

    test("a tag to ignore", () => {
        expect(SettingsUtil.isAnyTagIgnoredForNotes(settings, ["#skip"])).toBe(true);
        expect(SettingsUtil.isAnyTagIgnoredForNotes(settings, ["#SKIP/more"])).toBe(true);
        expect(SettingsUtil.isAnyTagIgnoredForNotes(settings, ["#skipper"])).toBe(false);
    });
});

describe("bug 10: a note with an ignore tag cannot be rated", () => {
    function setup(tags: string[]) {
        const settings = settingsWith({ noteTagsToIgnore: ["#ignore-me"] });
        const save = jest.fn(() => Promise.resolve());
        const plugin = {
            app: { vault: {}, metadataCache: {}, fileManager: {} },
            nextNoteReviewHandler: { autoReviewNextNote: jest.fn() },
        };
        const manager = new DataManager(plugin as never, {} as never, { settings } as never);
        (manager as unknown as { vaultIndex: unknown }).vaultIndex = {
            saveNoteReviewResponse: save,
        };
        mockTags = tags;
        return { manager, save };
    }
    const file = { path: "inbox/n.md" } as never;

    beforeEach(() => {
        notices.length = 0;
    });

    test("it is refused with a notice, and nothing is written", async () => {
        const { manager, save } = setup(["#review", "#ignore-me"]);
        await manager.saveNoteReviewResponse(file, ReviewResponse.Good);
        expect(save).not.toHaveBeenCalled();
        expect(notices).toEqual(["Note has a tag that is excluded from review (check settings)."]);
    });

    test("a note without it is rated", async () => {
        const { manager, save } = setup(["#review"]);
        await manager.saveNoteReviewResponse(file, ReviewResponse.Good);
        expect(save).toHaveBeenCalledTimes(1);
        expect(notices).toEqual(["Rating saved."]);
    });

    test("a note with no review tag is still asked to be tagged", async () => {
        const { manager, save } = setup(["#other"]);
        await manager.saveNoteReviewResponse(file, ReviewResponse.Good);
        expect(save).not.toHaveBeenCalled();
        expect(notices).toEqual([
            "Give this note one of your review tags first. They are listed in settings.",
        ]);
    });
});

describe("bug 8: the scan has an order", () => {
    test("files come in path order, whatever order the vault lists them in", () => {
        const paths = ["b/x.md", "B.md", "a.md", "a/b.md", "a-c.md", "é.md"];
        const listed = paths.map((path) => ({ path }));
        const expected = [...paths].sort();
        expect(inPathOrder(listed).map((f) => f.path)).toEqual(expected);
        expect(inPathOrder([...listed].reverse()).map((f) => f.path)).toEqual(expected);
        expect(listed.map((f) => f.path)).toEqual(paths);
    });
});
