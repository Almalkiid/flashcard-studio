import {
    addAnswerCommands,
    answerCommandAvailable,
    AnswerContext,
} from "src/commands/answer-commands";
import { UIState } from "src/ui/ui-state";

const ready: AnswerContext = {
    ready: true,
    inFocus: true,
    hasReview: true,
    isMobile: false,
    typing: false,
    state: UIState.CardBack,
};

test("checking the edit command does not open the editor; invoking it edits the focused card", () => {
    Object.assign(window, { activeDocument: document });
    const edit = jest.fn();
    const ui = {
        isStudioInFocus: true,
        contentManager: { _editQuestion: edit },
        uiState: UIState.CardFront,
    };
    const addCommand = jest.fn<
        void,
        [{ id: string; checkCallback: (checking: boolean) => boolean }]
    >();
    const settings = {
        flashcardAgainText: "Again",
        flashcardHardText: "Hard",
        flashcardGoodText: "Good",
        flashcardEasyText: "Easy",
    };
    addAnswerCommands({
        isInitialized: true,
        uiManager: ui,
        dataManager: { settingsManager: { settings } },
        addCommand,
    } as never);
    const command = addCommand.mock.calls
        .map(([cmd]) => cmd)
        .find((cmd) => cmd.id === "card-review-edit");
    if (command === undefined) throw new Error("no edit command");
    expect(command.checkCallback(true)).toBe(true);
    expect(edit).not.toHaveBeenCalled();
    expect(command.checkCallback(false)).toBe(true);
    expect(edit).toHaveBeenCalledTimes(1);
    ui.uiState = UIState.EditModal;
    expect(command.checkCallback(false)).toBe(false);
    expect(edit).toHaveBeenCalledTimes(1);
});

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
