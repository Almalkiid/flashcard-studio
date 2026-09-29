import "src/ui/obsidian-ui-components/content-container/card-container/card-container.css";
import "src/ui/obsidian-ui-components/content-container/card-container/review-studio.css";
import { App, Platform } from "obsidian";

import { CardType } from "src/data/data-structures/card/questions/question";
import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { SRSettings } from "src/data/settings";
import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { digitFromKeyCode, responseForDigit } from "src/scheduling/answer-keys";
import { FlashcardReviewMode } from "src/scheduling/flashcard-review-sequencer";
import { SessionSummary } from "src/stats/session";
import { CardActions, FLAG_COUNT } from "src/ui/card-actions";
import ContextSectionComponent from "src/ui/obsidian-ui-components/content-container/card-container/context-section/context-section";
import ResponseSectionComponent from "src/ui/obsidian-ui-components/content-container/card-container/response-section/response-section";
import CardToolbarComponent from "src/ui/obsidian-ui-components/content-container/card-container/toolbar/toolbar";
import {
    CardState,
    SessionData,
} from "src/ui/obsidian-ui-components/content-container/content-manager";
import {
    renderSessionSummary,
    SessionSummaryActions,
} from "src/ui/obsidian-ui-components/content-container/session-summary/session-summary";
import { ConfirmationModal } from "src/ui/obsidian-ui-components/modals/confirmation-modal";
import { moment } from "src/utils/dates";
import { escapeHtml } from "src/utils/escape-html";
import { formatIntervalCompact } from "src/utils/format-interval";
import EmulatedPlatform from "src/utils/platform-detector";
import { RenderMarkdownWrapper } from "src/utils/renderers";

const ANSWER_LABELS = ["Reset", "Again", "Hard", "Good", "Easy"];

// TODO: Refactor cloze rendering into the renderers file
export class CardContainer {
    private app: App;
    private plugin: SRPlugin;
    private cardState: CardState;

    private view: HTMLDivElement;

    private toolbar: CardToolbarComponent;
    private contextSection: ContextSectionComponent | null = null;

    private scrollWrapper: HTMLDivElement;
    private content: HTMLDivElement;
    private pendingClock: HTMLDivElement | null = null;
    private pendingResumeTimeout: number | null = null;

    private response: ResponseSectionComponent;

    private clozeInputs: NodeListOf<HTMLInputElement> | null = null;
    private clozeAnswers: NodeListOf<Element> | null = null;

    private processReviewHandler: (response: ReviewResponse) => Promise<void>;
    private skipCardHandler: () => void;
    private showAnswerHandler: () => void;
    private jumpToCardHandler: () => Promise<void>;
    private actions: CardActions;
    private answerToast: HTMLDivElement | null = null;
    private answerToastTimeout: number | null = null;
    private summaryEl: HTMLElement | null = null;

    constructor(
        app: App,
        plugin: SRPlugin,
        settings: SRSettings,
        parentEl: HTMLElement,
        deleteCurrentCard: () => void,
        backToDeckHandler: () => Promise<void>,
        editCardHandler: () => void,
        processReviewHandler: (response: ReviewResponse) => Promise<void>,
        skipCardHandler: () => void,
        showAnswerHandler: () => void,
        jumpToCurrentCardHandler: () => Promise<void>,
        displayCurrentCardInfoNoticeHandler: () => void,
        actions: CardActions,
        closeModal?: () => void,
    ) {
        // Init properties
        this.app = app;
        this.plugin = plugin;
        this.cardState = CardState.Closed;
        this.processReviewHandler = processReviewHandler;
        this.skipCardHandler = skipCardHandler;
        this.showAnswerHandler = showAnswerHandler;
        this.jumpToCardHandler = jumpToCurrentCardHandler;
        this.actions = actions;

        // Build ui
        this.view = parentEl.createDiv();
        this.view.addClasses(["sr-container", "sr-card-container", "sr-is-hidden"]);

        this.setCustomHotKeyState(settings.useCustomHotkeys);
        this.applyAppearance(settings);

        this.toolbar = new CardToolbarComponent(
            this.view,
            settings.showDeleteButtonInCardView,
            deleteCurrentCard,
            backToDeckHandler,
            editCardHandler,
            jumpToCurrentCardHandler,
            displayCurrentCardInfoNoticeHandler,
            this.skipCardHandler,
            () => {
                new ConfirmationModal(
                    app,
                    t("DELETE_SCHEDULING_DATA_OF_CURRENT_CARD"),
                    t("CONFIRM_SCHEDULING_DATA_DELETION_OF_CURRENT_CARD"),
                    t("SCHEDULING_DATA_DELETION_IN_PROGRESS_OF_CURRENT_CARD"),
                    async () => {
                        await this.processReviewHandler(ReviewResponse.Reset);
                    },
                ).open();
            },
            actions,
            closeModal,
        );

        this.scrollWrapper = this.view.createDiv();
        this.scrollWrapper.addClass("sr-scroll-wrapper");

        this.content = this.scrollWrapper.createDiv();
        this.content.addClass("sr-content");

        this.response = new ResponseSectionComponent(
            this.view,
            settings,
            this.showAnswerHandler,
            this.processReviewHandler,
        );
    }

    // #region -> public methods

    /**
     * Shows the FlashcardView if it is hidden
     */
    async openSession(sessionData: SessionData, settings: SRSettings) {
        // Prevents rest of code, from running if this was executed multiple times after one another
        if (!this.view.hasClass("sr-is-hidden")) {
            return;
        }

        await this.drawCardFront(sessionData, settings);

        this.view.removeClass("sr-is-hidden");
        activeDocument.addEventListener("keydown", this._keydownHandler);
    }

    /**
     * Hides the FlashcardView if it is visible
     */
    closeSession() {
        // Prevents the rest of code, from running if this was executed multiple times after one another

        if (this.view.hasClass("sr-is-hidden")) {
            return;
        }
        if (this.pendingResumeTimeout !== null) {
            window.clearTimeout(this.pendingResumeTimeout);
            this.pendingResumeTimeout = null;
        }
        this.cardState = CardState.Closed;
        this.hideAnswerToast();
        this.hideSessionSummary();
        activeDocument.removeEventListener("keydown", this._keydownHandler);
        this.view.addClass("sr-is-hidden");
    }

    public get isShowingSessionSummary(): boolean {
        return this.summaryEl !== null;
    }

    /**
     * Replaces the card with the summary of the session that just ended.
     */
    public showSessionSummary(summary: SessionSummary, actions: SessionSummaryActions): void {
        this.hideSessionSummary();
        // The toast of the previous answer would sit on top of the summary's buttons
        this.hideAnswerToast();
        // No card is being shown, so the review shortcuts must do nothing
        this.cardState = CardState.Closed;
        this.view.addClass("sr-summary-open");
        this.scrollWrapper.addClass("sr-is-hidden");
        this.response.responseEl.addClass("sr-is-hidden");
        this.summaryEl = renderSessionSummary(this.view, summary, actions);
    }

    /**
     * Removes the session summary, if it is showing. The next card brings the rest of the screen back.
     */
    public hideSessionSummary(): void {
        if (this.summaryEl === null) return;
        this.summaryEl.remove();
        this.summaryEl = null;
        this.view.removeClass("sr-summary-open");
        this.scrollWrapper.removeClass("sr-is-hidden");
    }

    /**
     * Shows the card's flag colour as a border on the card, or removes it for 0.
     */
    public showFlag(flag: number): void {
        for (let i = 1; i <= FLAG_COUNT; i++) this.scrollWrapper.removeClass(`sr-flag-${i}`);
        if (flag > 0) this.scrollWrapper.addClass(`sr-flag-${flag}`);
    }

    /**
     * Briefly shows what the last answer did, with a button to undo it.
     */
    public showAnswerToast(entry: ReviewLogEntry): void {
        this.hideAnswerToast();
        const toast = this.view.createDiv({ cls: "sr-answer-toast" });
        toast.createSpan({
            cls: `sr-answer-toast-rating sr-rating-${entry.r}`,
            text: ANSWER_LABELS[entry.r],
        });
        toast.createSpan({
            cls: "sr-answer-toast-interval",
            text: t("NEXT_REVIEW_IN", { interval: formatIntervalCompact(entry.ivl) }),
        });
        const undoButton = toast.createEl("button", {
            cls: "sr-answer-toast-undo",
            text: t("UNDO"),
        });
        undoButton.addEventListener("click", () => {
            this.hideAnswerToast();
            void this.actions.undo();
        });
        this.answerToast = toast;
        this.answerToastTimeout = window.setTimeout(() => this.hideAnswerToast(), 4000);
    }

    public hideAnswerToast(): void {
        if (this.answerToastTimeout !== null) {
            window.clearTimeout(this.answerToastTimeout);
            this.answerToastTimeout = null;
        }
        this.answerToast?.remove();
        this.answerToast = null;
    }

    /**
     * Blocks the key input to the FlashcardView
     *
     * @param block
     */
    blockKeyInput(block: boolean) {
        if (block) {
            activeDocument.addEventListener("keydown", this._keydownHandler);
        } else {
            activeDocument.removeEventListener("keydown", this._keydownHandler);
        }
    }

    public async drawCardFront(sessionData: SessionData, settings: SRSettings) {
        this.hideSessionSummary();
        this.toolbar.setResetButtonDisabled(true);
        // Update current deck info
        this.cardState = sessionData.cardData.currentCardState;

        this._updateInfoBar(sessionData, settings.flashcardCardOrder);
        this.showFlag(sessionData.cardData.currentCard?.meta.flag ?? 0);
        this.applyAppearance(settings);
        this.content.removeClass("sr-answer-shown");

        // Update card content
        await this.drawCardFrontContent(sessionData, settings);

        // Update response buttons
        this.response.resetResponseButtons();

        // Setup cloze input listeners
        this._setupClozeInputListeners();

        // auto-focus the first cloze input if this card is a cloze card
        if (sessionData.currentQuestion.questionType === CardType.Cloze) {
            const firstInput: HTMLInputElement | null =
                activeDocument.querySelector(".cloze-input");
            if (firstInput) {
                firstInput.focus();
            }
        }
    }

    private drawCardContext(sessionData: SessionData, settings: SRSettings) {
        if (settings.showContextInCards) {
            this.contextSection = new ContextSectionComponent(this.content);
            this.contextSection.updateCardContext(
                settings.showContextInCards,
                sessionData.currentQuestion,
                sessionData.currentNote,
            );
        }
    }

    private async drawCardFrontContent(sessionData: SessionData, settings: SRSettings) {
        // Update card content
        this.content.empty();

        // Create context section
        this.drawCardContext(sessionData, settings);

        // Build card content
        const wrapper: RenderMarkdownWrapper = new RenderMarkdownWrapper(
            this.app,
            this.plugin,
            sessionData.currentNote.filePath,
        );

        await wrapper.renderMarkdownWrapper(
            sessionData.cardData.currentCard.front.trimStart(),
            this.content,
            sessionData.currentQuestion.questionText.textDirection,
            // sessionData.cardData.currentCardState
        );
        // Set scroll position back to top
        this.content.scrollTop = 0;
    }

    /**
     * Applies the review screen's look and the key hints for the chosen answer keys. Called on every draw, so a
     * settings change shows on the next card.
     */
    private applyAppearance(settings: SRSettings): void {
        const studio = settings.reviewLook !== "classic";
        this.view.toggleClass("sr-look-studio", studio);
        this.view.toggleClass("sr-look-classic", !studio);
        this.view.toggleClass("sr-keys-anki", settings.answerKeys === "anki");
    }

    public drawPendingState(nextPendingDueUnix: number): void {
        this.hideSessionSummary();
        this.toolbar.setResetButtonDisabled(true);
        this.cardState = CardState.Front;
        this.content.empty();
        this.response.hideAllButtons();
        this.pendingClock = this.content.createDiv({
            cls: "sr-centered",
        });

        const updatePendingClock = () => {
            const startTime = moment();
            const endTime = moment(nextPendingDueUnix);

            // Calculate the difference in milliseconds
            const duration = moment.duration(endTime.diff(startTime));

            const hours = Math.floor(duration.asHours());
            const minutes = duration.minutes();
            const seconds = duration.seconds();

            const formatted = `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

            this.pendingClock?.setText(
                `Waiting for the next FSRS review step. Next card due in ${formatted} (HH:mm:ss).`,
            );
            this.pendingResumeTimeout = window.setTimeout(() => {
                updatePendingClock();
            }, 1000);
        };

        updatePendingClock();
    }

    // #region -> Deck Info

    private setCustomHotKeyState(state: boolean) {
        if (state) {
            if (!this.view.hasClass("sr-custom-hotkeys")) {
                this.view.addClass("sr-custom-hotkeys");
            }
        } else {
            if (this.view.hasClass("sr-custom-hotkeys")) {
                this.view.removeClass("sr-custom-hotkeys");
            }
        }
    }

    private _updateInfoBar(sessionData: SessionData, flashcardCardOrder: string) {
        if (sessionData.deckData.chosenDeck === null || sessionData.deckData.currentDeck === null)
            return;

        this.toolbar.updateInfo(
            sessionData.deckData.chosenDeck,
            sessionData.deckData.currentDeck,
            sessionData.deckData.chosenDeckStats,
            sessionData.deckData.currentDeckStats,
            sessionData.totalCardsInSession,
            sessionData.totalDecksInSession,
            sessionData.deckData.currentDeckTotalCardsInQueue,
            flashcardCardOrder,
        );
    }

    private _setupClozeInputListeners(): void {
        this.clozeInputs = activeDocument.querySelectorAll(".cloze-input");

        this.clozeInputs.forEach((input) => {
            input.addEventListener("keydown", (e: KeyboardEvent) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    (input as HTMLElement).blur();
                    this.showAnswerHandler();
                }
            });
        });
    }
    private _evaluateClozeAnswers(): void {
        this.clozeAnswers = activeDocument.querySelectorAll(".cloze-answer");

        if (this.clozeInputs !== null && this.clozeAnswers.length === this.clozeInputs.length) {
            for (let i = 0; i < this.clozeAnswers.length; i++) {
                const clozeInput = this.clozeInputs[i];
                const clozeAnswer = this.clozeAnswers[i] as HTMLElement;

                const inputText = clozeInput.value.trim();
                const answerText = clozeAnswer.innerText.trim();

                clozeAnswer.empty();

                const answerElement = clozeAnswer.createSpan({
                    text: escapeHtml(inputText),
                    cls: "cloze-answer",
                });

                answerElement.addClass(
                    inputText === answerText ? "cloze-answer-correct" : "cloze-answer-incorrect",
                );

                if (inputText !== answerText) {
                    clozeAnswer.createSpan({
                        text: escapeHtml(answerText),
                        cls: "cloze-answer-wrong",
                    });
                }
            }
        }
    }

    public async drawBack(
        sessionData: SessionData,
        reviewMode: FlashcardReviewMode,
        settings: SRSettings,
        determineButtonSchedule: (response: ReviewResponse) => RepItemScheduleInfo | null,
    ) {
        this.setCustomHotKeyState(settings.useCustomHotkeys);
        this.applyAppearance(settings);
        this.cardState = sessionData.cardData.currentCardState;

        this.toolbar.setResetButtonDisabled(false);
        this.showFlag(sessionData.cardData.currentCard?.meta.flag ?? 0);

        // Show answer text
        if (sessionData.currentQuestion.questionType !== CardType.Cloze) {
            await this.drawCardFrontContent(sessionData, settings);
            const hr: HTMLElement = createEl("hr");
            this.content.appendChild(hr);
        } else {
            this.content.empty();
            this.drawCardContext(sessionData, settings);
        }

        const wrapper: RenderMarkdownWrapper = new RenderMarkdownWrapper(
            this.app,
            this.plugin,
            sessionData.currentNote.filePath,
        );
        await wrapper.renderMarkdownWrapper(
            sessionData.cardData.currentCard.back,
            this.content,
            sessionData.currentQuestion.questionText.textDirection,
            // sessionData.cardData.currentCardState,
        );

        // Evaluate cloze answers
        this._evaluateClozeAnswers();
        this.content.addClass("sr-answer-shown");

        // Show response buttons
        this.response.showRatingButtons(
            reviewMode,
            settings.flashcardAgainText,
            settings.flashcardHardText,
            settings.flashcardGoodText,
            settings.flashcardEasyText,
            settings.showIntervalInReviewButtons,
            determineButtonSchedule,
        );
        // NEW: restore keyboard focus after cloze confirmation
        if (this.plugin.uiManager === null) throw new Error("UI manager not initialized!!!");
        this.plugin.uiManager.setSRViewInFocus(true);
        this.response.againButton.buttonEl.focus();
    }

    private _keydownHandler = (e: KeyboardEvent) => {
        if (!this.plugin.isInitialized) throw new Error("SR plugin or data not initialized!!!");
        if (this.plugin.uiManager === null) throw new Error("UI manager not initialized!!!");
        // Prevents any input, if the edit modal is open or if the view is not in focus
        if (
            this.plugin.dataManager.data.settings.useCustomHotkeys ||
            (activeDocument.activeElement !== null &&
                (activeDocument.activeElement.nodeName === "TEXTAREA" ||
                    activeDocument.activeElement.nodeName === "INPUT")) ||
            this.cardState === CardState.Closed ||
            !this.plugin.uiManager.getSRInFocusState() ||
            Platform.isMobile || // No keyboard events on mobile
            EmulatedPlatform().isMobile
        ) {
            return;
        }

        const consumeKeyEvent = () => {
            e.preventDefault();
            e.stopPropagation();
        };

        // Anki's review shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+1..7 flag, - bury, @ suspend
        if (e.ctrlKey || e.metaKey) {
            if (e.code === "KeyZ" && !e.shiftKey) {
                void this.actions.undo();
                consumeKeyEvent();
            } else if (/^Digit[1-7]$/.test(e.code)) {
                const flag = Number(e.code.slice(5));
                void this.actions.setFlag(this.actions.currentFlag() === flag ? 0 : flag);
                consumeKeyEvent();
            }
            return;
        }
        if (e.altKey) return;
        if (e.key === "@") {
            void this.actions.suspend();
            consumeKeyEvent();
            return;
        }
        if (e.key === "-") {
            void this.actions.bury();
            consumeKeyEvent();
            return;
        }

        // M3a: scheduling. The number keys answer as the "Answer keys" setting says
        const digit = digitFromKeyCode(e.code);
        if (digit !== null) {
            const response = responseForDigit(
                this.plugin.dataManager.data.settings.answerKeys,
                digit,
            );
            if (this.cardState === CardState.Back && response !== null) {
                void this.processReviewHandler(response);
                consumeKeyEvent();
            }
            return;
        }

        switch (e.code) {
            case "KeyU":
                void this.actions.undo();
                consumeKeyEvent();
                break;
            case "KeyS":
                this.skipCardHandler();
                consumeKeyEvent();
                break;
            case "KeyJ":
                void this.jumpToCardHandler();
                consumeKeyEvent();
                break;
            case "Enter":
            case "NumpadEnter":
            case "Space":
                if (this.cardState === CardState.Front) {
                    this.showAnswerHandler();
                    consumeKeyEvent();
                } else if (this.cardState === CardState.Back) {
                    void this.processReviewHandler(ReviewResponse.Good);
                    consumeKeyEvent();
                }
                break;
            default:
                break;
        }
    };
}
