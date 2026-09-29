import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { mergeImportedSettings } from "src/data/settings-import";
import { SRAlgorithmType } from "src/scheduling/algorithms/base/isr-algorithm";

describe("mergeImportedSettings", () => {
    const current: SRSettings = { ...DEFAULT_SETTINGS, baseEase: 250 };

    test("copies known settings with the right type and ignores the rest", () => {
        const { settings, importedKeys } = mergeImportedSettings(current, {
            settings: {
                algorithm: SRAlgorithmType.FSRS,
                convertFoldersToDecks: true,
                bogus: 1,
                baseEase: "x",
                flashcardTags: ["#cards"],
            },
        });

        expect(settings.algorithm).toBe(SRAlgorithmType.FSRS);
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

    test("keeps Cardwright-only settings", () => {
        const { settings } = mergeImportedSettings(
            { ...current, newCardsPerDay: 7 },
            { settings: { newCardsPerDay: 99 } },
        );
        expect(settings.newCardsPerDay).toBe(7);
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
