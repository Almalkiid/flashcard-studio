import { DEFAULT_SETTINGS } from "src/data/settings";
import { SAMPLE_DECK_PATH, sampleDeckMarkdown } from "src/onboarding/sample-deck";

import { UnitTestSRFile } from "../helpers/unit-test-file";
import { unitTestSetupStandardDataStoreAlgorithm } from "../helpers/unit-test-setup";
import { SampleItemDecks } from "../sample-items";

describe("sample deck", () => {
    test("every example becomes a card", async () => {
        unitTestSetupStandardDataStoreAlgorithm({ ...DEFAULT_SETTINGS });
        const deck = await SampleItemDecks.createDeckFromFile(
            new UnitTestSRFile(sampleDeckMarkdown(), SAMPLE_DECK_PATH),
        );
        const fronts = deck
            .toDeckArray()
            .flatMap((subdeck) => [...subdeck.newRepItems, ...subdeck.dueRepItems])
            .map((card) => card.front);

        // 1 single-line + 2 reversed + 2 multi-line + 1 + 2 clozes + 1 formula
        expect(fronts).toHaveLength(9);
        expect(fronts.some((front) => front.includes("FSRS"))).toBe(true);
        expect(fronts.some((front) => front.includes("Why does spaced repetition work"))).toBe(
            true,
        );
    });
});
