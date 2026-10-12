/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- the golden vectors are untyped JSON */
import {
    cloneDefaultSettings,
    DEFAULT_SETTINGS,
    SettingsUtil,
    StudioSettings,
    upgradeSettings,
} from "src/data/settings-model";

import { loadGolden } from "./golden";

interface UpgradeCase {
    name: string;
    input: Record<string, unknown>;
    changes: Record<string, { from: unknown; to: unknown }>;
}

const golden = loadGolden("settings-upgrade.json");
const ABSENT = { $absent: true };
const UNDEFINED = { $undefined: true };
const DEFAULT_CLOZE = ["==[123;;]answer[;;hint]=="];

/** The keys the upgrade changed, in the golden files' shape. */
function changesMade(before: Record<string, unknown>, after: Record<string, unknown>) {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const from = key in before ? (before[key] === undefined ? UNDEFINED : before[key]) : ABSENT;
        const to = key in after ? (after[key] === undefined ? UNDEFINED : after[key]) : ABSENT;
        if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
    }
    return changes;
}

/**
 * What the golden run recorded, with the one deliberate difference: a block with no cloze list and none of the three
 * cloze switches gets the default list (bug 1) where the old code left an empty one.
 */
function expectedChanges(c: UpgradeCase) {
    const expected = JSON.parse(JSON.stringify(c.changes)) as UpgradeCase["changes"];
    const noSwitches = [
        "convertHighlightsToClozes",
        "convertBoldTextToClozes",
        "convertCurlyBracketsToClozes",
    ].every((key) => c.input[key] === undefined || c.input[key] === null);
    if (noSwitches && expected.clozePatterns && c.input.clozePatterns === undefined) {
        expected.clozePatterns.to = DEFAULT_CLOZE;
    }
    return expected;
}

describe("upgradeSettings against the golden vectors (settings-upgrade.json)", () => {
    // The golden file lists, for each case, the keys that case is about; the keys every block gets filled in with
    // (the first case, an empty block) may change in any of them
    // (and the two FSRS load-balancing switches, which the golden run did not have)
    const filledIn = new Set([
        ...Object.keys(golden.cases[0].changes),
        "fsrsLoadBalance",
        "fsrsEasyDays",
    ]);

    test.each(golden.cases.map((c: UpgradeCase) => [c.name, c]))("%s", (_name, c: UpgradeCase) => {
        const settings = JSON.parse(JSON.stringify(c.input)) as Record<string, unknown>;
        upgradeSettings(settings as unknown as StudioSettings);
        const made = changesMade(c.input, settings);
        const expected = expectedChanges(c);
        for (const [key, change] of Object.entries(expected))
            expect([key, made[key]]).toEqual([key, change]);
        for (const key of Object.keys(made)) {
            expect(key in expected || filledIn.has(key) || key in c.input).toBe(true);
        }

        // Running it again changes nothing
        const once = JSON.stringify(settings);
        upgradeSettings(settings as unknown as StudioSettings);
        expect(JSON.stringify(settings)).toBe(once);
    });

    test("the full defaults pass through unchanged", () => {
        const settings = cloneDefaultSettings();
        const before = JSON.stringify(settings);
        upgradeSettings(settings);
        expect(JSON.stringify(settings)).toBe(before);
    });
});

describe("the fixes in upgradeSettings", () => {
    test("a block without a cloze list and without the cloze switches gets the default pattern, a copy", () => {
        const settings = { openViewInNewTab: true } as unknown as StudioSettings;
        upgradeSettings(settings);
        expect(settings.clozePatterns).toEqual(DEFAULT_CLOZE);
        expect(settings.clozePatterns).not.toBe(DEFAULT_SETTINGS.clozePatterns);
    });

    test("switches that are all off stay off: the list is empty because the user turned it off", () => {
        const settings = {
            convertHighlightsToClozes: false,
            convertBoldTextToClozes: false,
            convertCurlyBracketsToClozes: false,
        } as unknown as StudioSettings;
        upgradeSettings(settings);
        expect(settings.clozePatterns).toEqual([]);
    });

    test("a user who had turned the file menu items off keeps them off", () => {
        const settings = { disableFileMenuReviewOptions: true } as unknown as StudioSettings;
        upgradeSettings(settings);
        expect(settings.showFileMenuReviewOptions).toBe(false);
        expect(settings.disableFileMenuReviewOptions).toBeUndefined();
    });

    test("an explicit show setting wins over the old switch, and a false switch changes nothing else", () => {
        const explicit = {
            disableFileMenuReviewOptions: true,
            showFileMenuReviewOptions: true,
        } as unknown as StudioSettings;
        upgradeSettings(explicit);
        expect(explicit.showFileMenuReviewOptions).toBe(true);
        const off = { disableFileMenuReviewOptions: false } as unknown as StudioSettings;
        upgradeSettings(off);
        expect("showFileMenuReviewOptions" in off).toBe(false);
    });
});

describe("SettingsUtil against the golden vectors", () => {
    const { util } = golden;
    const withTags = (key: keyof StudioSettings, list: string[]): StudioSettings => ({
        ...cloneDefaultSettings(),
        [key]: list,
    });

    test("isSubTagContainedInTag; a trailing slash in the setting is ignored (bug 13)", () => {
        for (const row of util.isSubTagContainedInTag) {
            const expected = row.tag === "#a/" ? row.subTag.startsWith("#a") : row.result;
            expect([row, SettingsUtil.isSubTagContainedInTag(row.tag, row.subTag)]).toEqual([
                row,
                expected,
            ]);
        }
        expect(SettingsUtil.isSubTagContainedInTag("#a/", "#a/b")).toBe(true);
        expect(SettingsUtil.isSubTagContainedInTag("#a/", "#ab")).toBe(false);
    });

    test("isTagInList", () => {
        for (const row of util.isTagInList) {
            expect(SettingsUtil.isTagInList(row.list, row.tag, row.exact)).toBe(row.result);
        }
    });

    test("isFlashcardTag", () => {
        const settings = cloneDefaultSettings();
        for (const row of util.isFlashcardTag) {
            expect(SettingsUtil.isFlashcardTag(settings, row.tag)).toBe(row.result);
        }
    });

    test("isAnyTagANoteReviewTag", () => {
        const settings = cloneDefaultSettings();
        for (const row of util.isAnyTagANoteReviewTag) {
            expect(SettingsUtil.isAnyTagANoteReviewTag(settings, row.tags)).toBe(row.result);
        }
    });

    test("filterForNoteReviewTag lists each matching review tag once, in the settings' order (bug 13)", () => {
        for (const row of util.filterForNoteReviewTag) {
            const settings = withTags("tagsToReview", row.settingTagsToReview);
            expect(SettingsUtil.filterForNoteReviewTag(settings, row.tags)).toEqual([
                ...new Set(row.result),
            ]);
        }
    });

    test("isAnyTagIgnoredForFlashcards and isAnyTagIgnoredForNotes", () => {
        for (const row of util.isAnyTagIgnoredForFlashcards) {
            const settings = withTags("flashcardTagsToIgnore", row.ignoreList);
            expect(SettingsUtil.isAnyTagIgnoredForFlashcards(settings, row.tags)).toBe(row.result);
        }
        for (const row of util.isAnyTagIgnoredForNotes) {
            const settings = withTags("noteTagsToIgnore", row.ignoreList);
            expect(SettingsUtil.isAnyTagIgnoredForNotes(settings, row.tags)).toBe(row.result);
        }
    });

    test("isPathInFoldersToIgnore", () => {
        for (const row of util.isPathInFoldersToIgnore) {
            const settings = withTags("noteFoldersToIgnore", [row.pattern]);
            for (const [path, expected] of Object.entries(row.results)) {
                expect([
                    row.pattern,
                    path,
                    SettingsUtil.isPathInFoldersToIgnore(settings, path),
                ]).toEqual([row.pattern, path, expected]);
            }
        }
    });
});

describe("the defaults", () => {
    test("the defaults snapshot of the golden run, plus the new review order", () => {
        const snapshot = golden.defaultsSnapshot as Record<string, unknown>;
        const expected: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(snapshot)) {
            expected[key] = value;
        }
        const clone = cloneDefaultSettings() as unknown as Record<string, unknown>;
        const { reviewOrder, ...rest } = clone;
        expect(reviewOrder).toBe("dueDate");
        for (const key of Object.keys(expected)) {
            if (
                typeof expected[key] === "object" &&
                expected[key] !== null &&
                "$undefined" in expected[key]
            )
                continue;
            expect([key, rest[key]]).toEqual([key, expected[key]]);
        }
    });

    test("the copy shares nothing with the defaults", () => {
        const copy = cloneDefaultSettings();
        copy.flashcardTags.push("#x");
        expect(DEFAULT_SETTINGS.flashcardTags).toEqual(["#flashcards"]);
    });
});
