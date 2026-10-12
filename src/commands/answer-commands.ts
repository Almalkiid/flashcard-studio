import { Platform } from "obsidian";

import { t } from "src/lang/translate";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import type FlashcardStudioPlugin from "src/studio-plugin";
import type ContentManager from "src/ui/obsidian-ui-components/content-container/review-screen";
import { UIState } from "src/ui/ui-state";

/** What decides whether an answer command can run right now. */
export interface AnswerContext {
    ready: boolean;
    /** The review has the keyboard. */
    inFocus: boolean;
    /** A review is on screen. */
    hasReview: boolean;
    isMobile: boolean;
    /** A text box has the cursor, so keys belong to it. */
    typing: boolean;
    state: UIState;
}

/**
 * Whether a command that works on the card being reviewed is available: only with the review in front, on a
 * computer, while no text box has the cursor, and in one of the states `allowed` lists.
 */
export function answerCommandAvailable(allowed: UIState[], context: AnswerContext): boolean {
    return (
        context.ready &&
        context.inFocus &&
        context.hasReview &&
        !context.isMobile && // No keyboard events on mobile
        !context.typing &&
        allowed.includes(context.state)
    );
}

interface AnswerCommand {
    id: string;
    name: () => string;
    allowed: UIState[];
    run: (review: ContentManager) => void;
}

const FRONT = [UIState.CardFront];
const BACK = [UIState.CardBack];

function answerCommands(plugin: FlashcardStudioPlugin): AnswerCommand[] {
    const settings = () => plugin.dataManager.settingsManager.settings;
    const rate = (id: string, label: () => string, response: ReviewResponse): AnswerCommand => ({
        id,
        name: () => t("REVIEW_CARD_DIFFICULTY_CMD", { difficulty: label() }),
        allowed: BACK,
        run: (review) => void review._processReview(response),
    });
    return [
        rate("card-review-again", () => settings().flashcardAgainText, ReviewResponse.Again),
        rate("card-review-hard", () => settings().flashcardHardText, ReviewResponse.Hard),
        rate("card-review-good", () => settings().flashcardGoodText, ReviewResponse.Good),
        rate("card-review-easy", () => settings().flashcardEasyText, ReviewResponse.Easy),
        {
            id: "card-review-show-answer",
            name: () => t("SHOW_ANSWER"),
            allowed: FRONT,
            run: (review) => void review._showAnswer(),
        },
        {
            id: "card-review-skip",
            name: () => t("SKIP"),
            allowed: [UIState.CardFront, UIState.CardBack],
            run: (review) => void review._skipCurrentCard(),
        },
        {
            id: "card-review-reset",
            name: () => t("RESET_CARD_PROGRESS"),
            allowed: BACK,
            run: (review) => void review._processReview(ReviewResponse.Reset),
        },
        {
            id: "card-review-open-in-background",
            name: () => t("OPEN_IN_BACKGROUND"),
            allowed: BACK,
            run: (review) => void review._jumpToCurrentCard(),
        },
    ];
}

/** Registers the eight answer commands, for people who answer with Obsidian's own hotkeys. */
export function addAnswerCommands(plugin: FlashcardStudioPlugin): void {
    for (const command of answerCommands(plugin)) {
        plugin.addCommand({
            id: command.id,
            name: command.name(),
            checkCallback: (checking: boolean) => {
                if (!plugin.isInitialized) return false;
                const ui = plugin.uiManager;
                const review = ui.contentManager;
                const typing = ["TEXTAREA", "INPUT"].includes(
                    activeDocument.activeElement?.nodeName ?? "",
                );
                const available = answerCommandAvailable(command.allowed, {
                    ready: plugin.isInitialized,
                    inFocus: ui.isStudioInFocus,
                    hasReview: review !== null,
                    isMobile: Platform.isMobile,
                    typing,
                    state: ui.uiState,
                });
                if (available && review !== null && !checking) command.run(review);
                return available;
            },
        });
    }
}

/** Takes the eight answer commands away again. */
export function removeAnswerCommands(plugin: FlashcardStudioPlugin): void {
    for (const command of answerCommands(plugin)) plugin.removeCommand(command.id);
}
