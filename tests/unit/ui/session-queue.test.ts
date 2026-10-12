import { DeckOrder, PickOrder } from "src/data/decks/walker";
import { cloneDefaultSettings } from "src/data/settings-model";
import { iteratorOrderFor } from "src/ui/session-queue";

describe("iteratorOrderFor", () => {
    test("reads the two settings by the names of the orders", () => {
        expect(
            iteratorOrderFor({
                ...cloneDefaultSettings(),
                flashcardCardOrder: "NewFirstRandom",
                flashcardDeckOrder: "PrevDeckComplete_Random",
            }),
        ).toMatchObject({
            pickOrder: PickOrder.NewFirstRandom,
            deckOrder: DeckOrder.PrevDeckComplete_Random,
        });
    });

    test.each(["", "Nonsense", "0", "toString"])(
        "falls back to due first and sequential decks for %j",
        (value) => {
            expect(
                iteratorOrderFor({
                    ...cloneDefaultSettings(),
                    flashcardCardOrder: value,
                    flashcardDeckOrder: value,
                }),
            ).toMatchObject({
                pickOrder: PickOrder.DueFirstSequential,
                deckOrder: DeckOrder.PrevDeckComplete_Sequential,
            });
        },
    );
});
