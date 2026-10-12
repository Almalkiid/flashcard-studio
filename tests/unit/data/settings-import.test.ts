import { mergeImportedSettings } from "src/data/settings-import";
import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";

describe("mergeImportedSettings", () => {
    const current: StudioSettings = { ...DEFAULT_SETTINGS, baseEase: 250 };

    test("copies known settings with the right type and ignores the rest", () => {
        const { settings, importedKeys } = mergeImportedSettings(current, {
            settings: {
                algorithm: SchedulerKind.FSRS,
                convertFoldersToDecks: true,
                bogus: 1,
                baseEase: "x",
                flashcardTags: ["#cards"],
            },
        });

        expect(settings.algorithm).toBe(SchedulerKind.FSRS);
        expect(settings.convertFoldersToDecks).toBe(true);
        expect(settings.flashcardTags).toEqual(["#cards"]);
        expect(settings.baseEase).toBe(250);
        expect((settings as unknown as Record<string, unknown>).bogus).toBeUndefined();
        expect(importedKeys.sort()).toEqual([
            "algorithm",
            "convertFoldersToDecks",
            "flashcardTags",
        ]);
    });

    test("does not change the settings it was given", () => {
        mergeImportedSettings(current, { settings: { baseEase: 300 } });
        expect(current.baseEase).toBe(250);
    });

    test("keeps Flashcard Studio-only settings", () => {
        const { settings } = mergeImportedSettings(
            { ...current, newCardsPerDay: 7 },
            { settings: { newCardsPerDay: 99 } },
        );
        expect(settings.newCardsPerDay).toBe(7);
    });

    test("keeps the FSRS and answer key settings that only Flashcard Studio has", () => {
        const { settings } = mergeImportedSettings(
            { ...current, fsrsLearningSteps: "5m", answerKeys: "anki" },
            { settings: { fsrsLearningSteps: "1d", answerKeys: "original" } },
        );
        expect(settings.fsrsLearningSteps).toBe("5m");
        expect(settings.answerKeys).toBe("anki");
    });

    test.each([[null], ["text"], [42], [{}], [{ settings: "x" }], [{ settings: [1] }]])(
        "ignores %p",
        (imported: unknown) => {
            const { settings, importedKeys } = mergeImportedSettings(current, imported);
            expect(settings).toEqual(current);
            expect(importedKeys).toEqual([]);
        },
    );
});

describe("mergeImportedSettings: values the settings screen would refuse are not imported", () => {
    const base: StudioSettings = { ...DEFAULT_SETTINGS, baseEase: 250, maximumInterval: 36525 };

    test.each([
        ["baseEase", 50],
        ["baseEase", 1500],
        ["maximumInterval", 0],
        ["maxNDaysNotesReviewQueue", 0],
        ["reviewReminderIntervalMinutes", 0],
        ["startOfDay", "25:99"],
        ["startOfDay", "soon"],
    ])("%s = %p is left out", (key, value) => {
        const { settings, importedKeys } = mergeImportedSettings(base, {
            settings: { [key]: value },
        });
        expect((settings as unknown as Record<string, unknown>)[key]).toEqual(
            (base as unknown as Record<string, unknown>)[key],
        );
        expect(importedKeys).toEqual([]);
    });

    test("a start of day is written the way the settings screen writes it", () => {
        const { settings, importedKeys } = mergeImportedSettings(base, {
            settings: { startOfDay: "4:30" },
        });
        expect(settings.startOfDay).toBe("04:30:00");
        expect(importedKeys).toEqual(["startOfDay"]);
    });

    test("valid values still come in", () => {
        const { settings } = mergeImportedSettings(base, {
            settings: { baseEase: 300, maximumInterval: 100 },
        });
        expect([settings.baseEase, settings.maximumInterval]).toEqual([300, 100]);
    });
});
