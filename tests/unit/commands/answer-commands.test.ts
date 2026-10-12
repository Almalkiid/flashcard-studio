import { answerCommandAvailable, AnswerContext } from "src/commands/answer-commands";
import { UIState } from "src/ui/ui-state";

const ready: AnswerContext = {
    ready: true,
    inFocus: true,
    hasReview: true,
    isMobile: false,
    typing: false,
    state: UIState.CardBack,
};

describe("answerCommandAvailable", () => {
    test("is available in a listed state with the review in front on a computer", () => {
        expect(answerCommandAvailable([UIState.CardBack], ready)).toBe(true);
    });

    test.each([UIState.Closed, UIState.DeckList, UIState.CardFront, UIState.EditModal])(
        "is not available in state %d when only the back of the card is listed",
        (state) => {
            expect(answerCommandAvailable([UIState.CardBack], { ...ready, state })).toBe(false);
        },
    );

    test("a command listed for front and back is available in both", () => {
        const both = [UIState.CardFront, UIState.CardBack];
        expect(answerCommandAvailable(both, { ...ready, state: UIState.CardFront })).toBe(true);
        expect(answerCommandAvailable(both, { ...ready, state: UIState.CardBack })).toBe(true);
    });

    test.each([
        ["the plugin is not ready", { ready: false }],
        ["the review has not got the keyboard", { inFocus: false }],
        ["no review is on screen", { hasReview: false }],
        ["on a phone or tablet", { isMobile: true }],
        ["a text box has the cursor", { typing: true }],
    ])("is not available when %s", (_name, change) => {
        expect(answerCommandAvailable([UIState.CardBack], { ...ready, ...change })).toBe(false);
    });
});
