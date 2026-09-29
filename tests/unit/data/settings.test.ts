import {
    cloneDefaultSettings,
    DEFAULT_SETTINGS,
    SettingsUtil,
    SRSettings,
    upgradeSettings,
} from "src/data/settings";
import { parserOptionsFromSettings } from "src/parser";

describe("SettingsUtil", () => {
    test("isPathInNoteIgnoreFolder", () => {
        const settings: SRSettings = { ...DEFAULT_SETTINGS, noteFoldersToIgnore: ["/test"] };
        expect(SettingsUtil.isPathInFoldersToIgnore(settings, "/test/test")).toEqual(true);
        expect(SettingsUtil.isPathInFoldersToIgnore(settings, "/notes/test2")).toEqual(false);
    });

    test("isAnyTagANoteReviewTag", () => {
        const settings: SRSettings = { ...DEFAULT_SETTINGS, tagsToReview: ["#review"] };
        expect(SettingsUtil.isAnyTagANoteReviewTag(settings, ["#review"])).toEqual(true);
        expect(SettingsUtil.isAnyTagANoteReviewTag(settings, ["#review", "#test"])).toEqual(true);
        expect(SettingsUtil.isAnyTagANoteReviewTag(settings, ["#test"])).toEqual(false);
    });

    test("isAnyTagIgnoredForFlashcards", () => {
        const simpleDeckSettings: SRSettings = {
            ...DEFAULT_SETTINGS,
            flashcardTagsToIgnore: ["#archived"],
        };
        expect(
            SettingsUtil.isAnyTagIgnoredForFlashcards(simpleDeckSettings, ["#archived"]),
        ).toEqual(true);
        expect(
            SettingsUtil.isAnyTagIgnoredForFlashcards(simpleDeckSettings, ["#archived/old"]),
        ).toEqual(true);
        expect(
            SettingsUtil.isAnyTagIgnoredForFlashcards(simpleDeckSettings, ["#flashcards"]),
        ).toEqual(false);
        expect(
            SettingsUtil.isAnyTagIgnoredForFlashcards(simpleDeckSettings, [
                "#flashcards",
                "#archived",
            ]),
        ).toEqual(true);

        const settingsNoIgnore: SRSettings = { ...DEFAULT_SETTINGS, flashcardTagsToIgnore: [] };
        expect(SettingsUtil.isAnyTagIgnoredForFlashcards(settingsNoIgnore, ["#archived"])).toEqual(
            false,
        );

        const complexDeckSettings: SRSettings = {
            ...DEFAULT_SETTINGS,
            flashcardTagsToIgnore: [
                "#archived",
                "#flashcards/Capitals/europa",
                "#flashcards/Capitals/africa/test/test/test",
            ],
        };

        expect(
            SettingsUtil.isAnyTagIgnoredForFlashcards(complexDeckSettings, [
                "#flashcards/Capitals",
            ]),
        ).toEqual(false);

        expect(
            SettingsUtil.isAnyTagIgnoredForFlashcards(complexDeckSettings, [
                "#flashcards/Capitals/test",
            ]),
        ).toEqual(false);

        expect(
            SettingsUtil.isAnyTagIgnoredForFlashcards(complexDeckSettings, [
                "#flashcards/Capitals/europa",
            ]),
        ).toEqual(true);

        expect(
            SettingsUtil.isAnyTagIgnoredForFlashcards(complexDeckSettings, [
                "#flashcards/Capitals/europa/germany",
            ]),
        ).toEqual(true);

        expect(
            SettingsUtil.isAnyTagIgnoredForFlashcards(complexDeckSettings, [
                "#flashcards/Capitals/eu",
            ]),
        ).toEqual(false);

        expect(
            SettingsUtil.isAnyTagIgnoredForFlashcards(complexDeckSettings, [
                "#flashcards/Capitals/eu/germany",
            ]),
        ).toEqual(false);

        expect(
            SettingsUtil.isAnyTagIgnoredForFlashcards(complexDeckSettings, [
                "#flashcards/Capitals/africa/test",
            ]),
        ).toEqual(false);

        expect(
            SettingsUtil.isAnyTagIgnoredForFlashcards(complexDeckSettings, [
                "#flashcards/Capitals/africa/test/test",
            ]),
        ).toEqual(false);

        expect(
            SettingsUtil.isAnyTagIgnoredForFlashcards(complexDeckSettings, [
                "#flashcards/Capitals/africa/test/test/test",
            ]),
        ).toEqual(true);

        expect(
            SettingsUtil.isAnyTagIgnoredForFlashcards(complexDeckSettings, [
                "#flashcards/Capitals/africa/test/test/test/test/test",
            ]),
        ).toEqual(true);

        expect(
            SettingsUtil.isTagInList(
                complexDeckSettings.flashcardTagsToIgnore,
                "#flashcards/Capitals/africa/test/test/test",
                true,
            ),
        ).toEqual(true);

        expect(
            SettingsUtil.isTagInList(
                complexDeckSettings.flashcardTagsToIgnore,
                "#flashcards/Capitals/africa/test/test/test/test",
                true,
            ),
        ).toEqual(false);
    });

    test("isAnyTagIgnoredForNotes", () => {
        const settings: SRSettings = {
            ...DEFAULT_SETTINGS,
            noteTagsToIgnore: ["#archived"],
        };
        expect(SettingsUtil.isAnyTagIgnoredForNotes(settings, ["#archived"])).toEqual(true);
        expect(SettingsUtil.isAnyTagIgnoredForNotes(settings, ["#archived/old"])).toEqual(true);
        expect(SettingsUtil.isAnyTagIgnoredForNotes(settings, ["#review"])).toEqual(false);
        expect(SettingsUtil.isAnyTagIgnoredForNotes(settings, ["#review", "#archived"])).toEqual(
            true,
        );
        const settingsNoIgnore: SRSettings = { ...DEFAULT_SETTINGS, noteTagsToIgnore: [] };
        expect(SettingsUtil.isAnyTagIgnoredForNotes(settingsNoIgnore, ["#archived"])).toEqual(
            false,
        );
    });

    test("upgradeSettings", () => {
        expect(DEFAULT_SETTINGS.reviewReminderMessage).toEqual("");

        let settings: SRSettings = { ...DEFAULT_SETTINGS };
        upgradeSettings(settings);
        expect(settings).toEqual(DEFAULT_SETTINGS);

        settings = {
            ...DEFAULT_SETTINGS,
            randomizeCardOrder: true,
            showRibbonIcon: true,
            flashcardCardOrder: null,
            flashcardDeckOrder: null,
            disableFileMenuReviewOptions: true,
        };
        upgradeSettings(settings);
        expect(settings).toEqual(DEFAULT_SETTINGS);

        settings = { ...DEFAULT_SETTINGS, clozePatterns: null, convertBoldTextToClozes: true };
        upgradeSettings(settings);
        expect(settings).toEqual({
            ...DEFAULT_SETTINGS,
            convertBoldTextToClozes: true,
            clozePatterns: ["==[123;;]answer[;;hint]==", "**[123;;]answer[;;hint]**"],
        });

        settings = { ...DEFAULT_SETTINGS, clozePatterns: null };
        upgradeSettings(settings);
        expect(settings).toEqual({
            ...DEFAULT_SETTINGS,
            convertHighlightsToClozes: true,
            clozePatterns: ["==[123;;]answer[;;hint]=="],
        });

        settings = {
            ...DEFAULT_SETTINGS,
            clozePatterns: null,
            convertHighlightsToClozes: false,
            convertCurlyBracketsToClozes: true,
        };
        upgradeSettings(settings);
        expect(settings).toEqual({
            ...DEFAULT_SETTINGS,
            convertCurlyBracketsToClozes: true,
            convertHighlightsToClozes: false,
            clozePatterns: ["{{[123;;]answer[;;hint]}}"],
        });

        settings = {
            ...DEFAULT_SETTINGS,
            scheduleDataVaultLocation: "   ",
        };
        upgradeSettings(settings);
        expect(settings.scheduleDataVaultLocation).toEqual(
            DEFAULT_SETTINGS.scheduleDataVaultLocation,
        );
        settings = {
            ...DEFAULT_SETTINGS,
            randomizeCardOrder: false,
            flashcardCardOrder: null,
            flashcardDeckOrder: null,
            fsrsDesiredRetention: undefined,
        };
        upgradeSettings(settings);
        expect(settings).toMatchObject({
            flashcardCardOrder: "DueFirstSequential",
            flashcardDeckOrder: "PrevDeckComplete_Sequential",
            randomizeCardOrder: undefined,
            fsrsDesiredRetention: DEFAULT_SETTINGS.fsrsDesiredRetention,
        });

        settings = {
            ...DEFAULT_SETTINGS,
            randomizeCardOrder: false,
            flashcardCardOrder: undefined,
            flashcardDeckOrder: undefined,
        };
        upgradeSettings(settings);
        expect(settings).toMatchObject({
            flashcardCardOrder: "DueFirstSequential",
            flashcardDeckOrder: "PrevDeckComplete_Sequential",
        });

        settings = {
            ...DEFAULT_SETTINGS,
            randomizeCardOrder: true,
            flashcardCardOrder: "ExistingCardOrder",
            flashcardDeckOrder: "ExistingDeckOrder",
            fsrsDesiredRetention: 0.87,
        };
        upgradeSettings(settings);
        expect(settings).toMatchObject({
            flashcardCardOrder: "ExistingCardOrder",
            flashcardDeckOrder: "ExistingDeckOrder",
            fsrsDesiredRetention: 0.87,
        });

        settings = {
            ...DEFAULT_SETTINGS,
            enableReviewReminders: undefined,
            reviewReminderIntervalMinutes: 0,
            reviewReminderCheckOnStartup: undefined,
            reviewReminderMessage: undefined,
            reviewReminderAutoOpen: undefined,
            reviewReminderShowNotice: undefined,
            reviewReminderPlaySound: undefined,
            reviewReminderBounceDock: undefined,
        };
        // This verifies fallback behavior for the shipped reminder schema only. We intentionally
        // do not encode compatibility expectations for unpublished draft field names here.
        upgradeSettings(settings);
        expect(settings).toMatchObject({
            enableReviewReminders: DEFAULT_SETTINGS.enableReviewReminders,
            reviewReminderIntervalMinutes: DEFAULT_SETTINGS.reviewReminderIntervalMinutes,
            reviewReminderCheckOnStartup: DEFAULT_SETTINGS.reviewReminderCheckOnStartup,
            reviewReminderMessage: DEFAULT_SETTINGS.reviewReminderMessage,
            reviewReminderAutoOpen: DEFAULT_SETTINGS.reviewReminderAutoOpen,
            reviewReminderShowNotice: DEFAULT_SETTINGS.reviewReminderShowNotice,
            reviewReminderPlaySound: DEFAULT_SETTINGS.reviewReminderPlaySound,
            reviewReminderBounceDock: DEFAULT_SETTINGS.reviewReminderBounceDock,
        });
    });
});

describe("cloneDefaultSettings", () => {
    test("returns settings that share nothing with the defaults", () => {
        const settings = cloneDefaultSettings();
        expect(settings).toEqual(
            JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS,
        );

        settings.flashcardTags.push("#changed");
        settings.newCardsPerDay = 1;
        expect(DEFAULT_SETTINGS.flashcardTags).not.toContain("#changed");
        expect(DEFAULT_SETTINGS.newCardsPerDay).toBe(20);
    });
});

// M3b: card syntax
describe("card syntax settings", () => {
    test("defaults do not change how a note parses, except that callout cards are on", () => {
        expect(DEFAULT_SETTINGS.multilineCardStartMarker).toBe("");
        expect(DEFAULT_SETTINGS.atomicClozes).toBe(false);
        expect(DEFAULT_SETTINGS.latexClozes).toBe(false);
        expect(DEFAULT_SETTINGS.calloutCardTypes).toEqual(["flashcard", "question", "card"]);
    });

    test("upgradeSettings fills in missing or invalid values", () => {
        const settings = {
            multilineCardStartMarker: 5,
            calloutCardTypes: "question",
            atomicClozes: "yes",
            latexClozes: null,
        } as unknown as SRSettings;

        upgradeSettings(settings);

        expect(settings).toMatchObject({
            multilineCardStartMarker: "",
            calloutCardTypes: ["flashcard", "question", "card"],
            atomicClozes: false,
            latexClozes: false,
        });
    });

    test("upgradeSettings keeps valid values, including an empty callout list", () => {
        const settings = {
            multilineCardStartMarker: "+++",
            calloutCardTypes: [],
            atomicClozes: true,
            latexClozes: true,
        } as unknown as SRSettings;

        upgradeSettings(settings);

        expect(settings).toMatchObject({
            multilineCardStartMarker: "+++",
            calloutCardTypes: [],
            atomicClozes: true,
            latexClozes: true,
        });
    });

    test("upgradeSettings gives the callout list its own array, not the shared default", () => {
        const settings = {} as unknown as SRSettings;

        upgradeSettings(settings);
        settings.calloutCardTypes.push("extra");

        expect(DEFAULT_SETTINGS.calloutCardTypes).toEqual(["flashcard", "question", "card"]);
    });

    test("the parser options carry every card syntax setting", () => {
        const options = parserOptionsFromSettings({
            ...DEFAULT_SETTINGS,
            multilineCardStartMarker: "+++",
            calloutCardTypes: ["card"],
            atomicClozes: true,
            latexClozes: true,
        });

        expect(options).toMatchObject({
            multilineCardStartMarker: "+++",
            calloutCardTypes: ["card"],
            atomicClozes: true,
            latexClozes: true,
            multilineCardEndMarker: DEFAULT_SETTINGS.multilineCardEndMarker,
        });
    });
});
