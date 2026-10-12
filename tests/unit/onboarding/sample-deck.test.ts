import { DEFAULT_SETTINGS } from "src/data/settings-model";
import { SAMPLE_DECK_PATH, sampleDeckMarkdown } from "src/onboarding/sample-deck";

import { UnitTestNoteFile } from "../support/memory-note";
import { SampleItemDecks } from "../support/sample-decks";
import { unitTestSetupStandardDataStoreAlgorithm } from "../support/setup";

describe("sample deck", () => {
    test("every example becomes a card", async () => {
        unitTestSetupStandardDataStoreAlgorithm({ ...DEFAULT_SETTINGS });
        const deck = await SampleItemDecks.createDeckFromFile(
            new UnitTestNoteFile(sampleDeckMarkdown(), SAMPLE_DECK_PATH),
        );
        const fronts = deck
            .toDeckArray()
            .flatMap((subdeck) => [...subdeck.newReviewItems, ...subdeck.dueReviewItems])
            .map((card) => card.front);

        // 1 single-line + 2 reversed + 2 multi-line + 1 + 2 clozes + 1 formula
        expect(fronts).toHaveLength(9);
        expect(fronts.some((front) => front.includes("FSRS"))).toBe(true);
        expect(fronts.some((front) => front.includes("Why does spaced repetition work"))).toBe(
            true,
        );
    });
});
