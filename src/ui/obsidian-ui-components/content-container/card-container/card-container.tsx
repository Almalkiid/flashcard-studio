import "src/ui/obsidian-ui-components/content-container/card-container/card-container.css";
import "src/ui/obsidian-ui-components/content-container/card-container/review-studio.css";
import "src/ui/obsidian-ui-components/content-container/card-container/study-additions.css";
import { App, Component, Platform, setIcon } from "obsidian";

import { Card } from "src/data/data-structures/card/card";
import {
    isChoiceCorrect,
    parseMultipleChoice,
} from "src/data/data-structures/card/questions/multiple-choice";
import { CardType } from "src/data/data-structures/card/questions/question";
import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { SRSettings } from "src/data/settings";
import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { digitFromKeyCode, responseForDigit } from "src/scheduling/answer-keys";
import { FlashcardReviewMode } from "src/scheduling/flashcard-review-sequencer";
import {
    compareTypedAnswer,
    normalizeAnswer,
    typedAnswerTarget,
} from "src/scheduling/typed-answer";
import { SessionSummary } from "src/stats/session";
import { CardActions, FLAG_COUNT } from "src/ui/card-actions";
import {
    ChoiceContext,
    ChoiceFrontHandle,
    ChoiceState,
    createChoiceState,
    renderChoiceBack,
    renderChoiceFront,
    revealChoiceResult,
} from "src/ui/obsidian-ui-components/content-container/card-container/choice-view";
import ContextSectionComponent from "src/ui/obsidian-ui-components/content-container/card-container/context-section/context-section";
import ResponseSectionComponent from "src/ui/obsidian-ui-components/content-container/card-container/response-section/response-section";
import CardToolbarComponent from "src/ui/obsidian-ui-components/content-container/card-container/toolbar/toolbar";
import {
    renderTypedInput,
    renderTypedResult,
} from "src/ui/obsidian-ui-components/content-container/card-container/typed-answer-view";
import {
    CardState,
    SessionData,
} from "src/ui/obsidian-ui-components/content-container/content-manager";
import {
    renderSessionSummary,
    SessionSummaryActions,
} from "src/ui/obsidian-ui-components/content-container/session-summary/session-summary";
import { ConfirmationModal } from "src/ui/obsidian-ui-components/modals/confirmation-modal";
import { joinSpeech, pickVoice, speakableText, Speaker, speechAvailable } from "src/ui/speech";
import { moment } from "src/utils/dates";
import { escapeHtml } from "src/utils/escape-html";
import { formatIntervalCompact } from "src/utils/format-interval";
import EmulatedPlatform from "src/utils/platform-detector";
import { RenderMarkdownWrapper, wireInternalLinks } from "src/utils/renderers";
import { TextDirection } from "src/utils/strings";

const ANSWER_LABELS = ["Reset", "Again", "Hard", "Good", "Easy"];

/** The star in the Studio card's corner stands for Anki's orange flag. */
const STAR_FLAG = 2;

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

    // Multiple choice and typed answers: what is up on this card, and what the person did with it
    private choice: ChoiceState | null = null;
    private choiceHandle: ChoiceFrontHandle | null = null;
    private choiceComponent: Component | null = null;
    private typedInput: HTMLInputElement | null = null;
    private typedValue: string | null = null;
    /** The menu's "Type answers" for this session; null follows the setting. */
    private typeAnswersOverride: boolean | null = null;
    private lastSession: { sessionData: SessionData; settings: SRSettings } | null = null;
    private speaker = new Speaker();

    private processReviewHandler: (response: ReviewResponse) => Promise<void>;
    private skipCardHandler: () => void;
    private showAnswerHandler: () => void;
    private jumpToCardHandler: () => Promise<void>;
    private actions: CardActions;
    private answerToast: HTMLDivElement | null = null;
    private starButton: HTMLButtonElement;
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
        this.toolbar.setTypeAnswersToggle({
            isOn: () => this.typeAnswersOn(),
            toggle: () => this.toggleTypeAnswers(),
        });
        this.toolbar.setSpeakHandler(() => this.readAloud());

        this.scrollWrapper = this.view.createDiv();
        this.scrollWrapper.addClass("sr-scroll-wrapper");

        this.content = this.scrollWrapper.createDiv();
        this.content.addClass("sr-content");

        // Studio: a star in the card's corner, and tapping the question reveals the answer
        this.starButton = this.scrollWrapper.createEl("button", {
            cls: "fs-card-star",
            attr: { "aria-label": t("STAR_CARD") },
        });
        setIcon(this.starButton, "star");
        this.starButton.addEventListener("click", (event) => {
            event.stopPropagation();
            const flag = this.actions.currentFlag();
            void this.actions.setFlag(flag === STAR_FLAG ? 0 : STAR_FLAG);
        });
        this.content.addEventListener("click", (event) => {
            if (!this.view.hasClass("sr-look-studio") || this.cardState !== CardState.Front) return;
            const target = event.target as HTMLElement | null;
            if (target?.closest("a, input, button, .cloze-input, .fs-choices, .fs-typed")) return;
            this.showAnswerHandler();
        });

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
        this.focusFrontField();
    }

    /**
     * The first card of a session is drawn while the view is still hidden, and a field cannot take focus until it is
     * shown. Focuses the field to type in (the answer, or the first cloze blank) once the view is visible.
     */
    private focusFrontField(): void {
        if (this.cardState !== CardState.Front) return;
        if (this.typedInput !== null) {
            if (!(Platform.isMobile || EmulatedPlatform().isMobile)) this.typedInput.focus();
            return;
        }
        this.content.querySelector<HTMLInputElement>(".cloze-input")?.focus();
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
        this.typeAnswersOverride = null;
        this.resetStudyAids();
        this.speaker.stop();
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
        this.toolbar.markSessionComplete();
        this.speaker.stop();
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
        this.starButton.toggleClass("is-on", flag === STAR_FLAG);
    }

    /**
     * Shows the answers given in this session in the progress bar.
     */
    public setSessionAnswers(responses: readonly ReviewResponse[]): void {
        this.toolbar.setSessionAnswers(responses);
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
        this.speaker.stop();
        this.hideSessionSummary();
        this.toolbar.setResetButtonDisabled(true);
        // Update current deck info
        this.cardState = sessionData.cardData.currentCardState;

        this._updateInfoBar(sessionData, settings.flashcardCardOrder);
        this.showFlag(sessionData.cardData.currentCard?.meta.flag ?? 0);
        this.applyAppearance(settings);
        this.content.removeClass("sr-answer-shown");
        this.lastSession = { sessionData, settings };

        // Multiple choice tiles, or a field to type the answer in, go under the question
        this.resetStudyAids();
        const choice = this.choiceFor(sessionData, settings, false);
        const card = sessionData.cardData.currentCard;
        const typedTarget =
            choice === null &&
            this.typeAnswersOn() &&
            sessionData.currentQuestion.questionType !== CardType.Cloze
                ? typedAnswerTarget(card.back)
                : null;
        this.content.toggleClass("fs-choice-card", choice !== null);

        // Update card content
        const choiceRoot = await this.drawCardFrontContent(sessionData, settings, choice);
        const mobile = Platform.isMobile || EmulatedPlatform().isMobile;
        let optionsRendered: Promise<void> = Promise.resolve();
        if (choice !== null && choiceRoot !== null) {
            this.choice = choice;
            this.choiceHandle = renderChoiceFront(
                choiceRoot,
                choice,
                this.choiceContext(sessionData),
                () => this.showAnswerHandler(),
            );
            optionsRendered = this.choiceHandle.rendered;
        } else if (typedTarget !== null) {
            this.typedInput = renderTypedInput(this.content, {
                autofocus: !mobile,
                onSubmit: () => this.showAnswerHandler(),
                textDirection: sessionData.currentQuestion.questionText.textDirection,
            });
        }
        if (this.view.hasClass("sr-look-studio")) {
            const hint = this.content.createDiv({ cls: "fs-reveal-hint" });
            setIcon(hint.createSpan({ cls: "fs-reveal-hint-icon" }), "pointer");
            hint.createSpan({
                text: mobile
                    ? t("TAP_TO_REVEAL")
                    : this.typedInput !== null
                      ? t("TYPED_PRESS_ENTER")
                      : t("PRESS_SPACE_TO_REVEAL"),
            });
        }
        this.animateCardIn();

        // Update response buttons
        this.response.resetResponseButtons();
        // Choosing an option is what shows the answer of a multiple choice card
        if (this.choice !== null) this.response.hideAllButtons();

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

        if (settings.readQuestionAloud) {
            // The options of a choice card fill in a moment after their tiles are made
            await optionsRendered;
            if (this.cardState === CardState.Front && sessionData.cardData.currentCard === card) {
                this.readAloud();
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

    /**
     * @returns The block that holds a multiple choice card (its label, question, tiles and explanation), or null
     *          for any other card, whose question is rendered straight into the content.
     */
    private async drawCardFrontContent(
        sessionData: SessionData,
        settings: SRSettings,
        choice: ChoiceState | null = null,
    ): Promise<HTMLElement | null> {
        // Update card content
        this.content.empty();

        // Create context section
        this.drawCardContext(sessionData, settings);

        let target: HTMLElement = this.content;
        let choiceRoot: HTMLElement | null = null;
        if (choice !== null) {
            choiceRoot = this.content.createDiv({ cls: "fs-choice-root" });
            if (sessionData.currentQuestion.questionText.textDirection === TextDirection.Rtl) {
                choiceRoot.setAttribute("dir", "rtl");
            }
            const kind = choiceRoot.createDiv({ cls: "fs-choice-kind" });
            setIcon(kind.createSpan({ cls: "fs-choice-kind-icon" }), "list-checks");
            kind.createSpan({ text: t("MULTIPLE_CHOICE") });
            target = choiceRoot.createDiv({ cls: "fs-choice-question" });
        }

        // Build card content
        const wrapper: RenderMarkdownWrapper = new RenderMarkdownWrapper(
            this.app,
            this.plugin,
            sessionData.currentNote.filePath,
        );

        await wrapper.renderMarkdownWrapper(
            sessionData.cardData.currentCard.front.trimStart(),
            target,
            sessionData.currentQuestion.questionText.textDirection,
            // sessionData.cardData.currentCardState
        );
        // Set scroll position back to top
        this.content.scrollTop = 0;
        return choiceRoot;
    }

    // #region -> Multiple choice and typed answers

    /**
     * The state of the multiple choice card that is up, or null when it is an ordinary card. A cloze card is never
     * multiple choice. With `reuse`, the state of this card's front is kept (its order of options and the choice).
     */
    private choiceFor(
        sessionData: SessionData,
        settings: SRSettings,
        reuse: boolean,
    ): ChoiceState | null {
        const card: Card | null = sessionData.cardData.currentCard;
        if (card === null || sessionData.currentQuestion.questionType === CardType.Cloze) {
            return null;
        }
        const mc = parseMultipleChoice(card.back);
        if (mc === null) return null;
        const current = this.choice;
        if (
            reuse &&
            current !== null &&
            current.card === card &&
            current.mc.options.length === mc.options.length &&
            current.mc.options.every((option, i) => option.text === mc.options[i].text)
        ) {
            return current;
        }
        return createChoiceState(card, mc, settings.shuffleChoices);
    }

    private choiceContext(sessionData: SessionData): ChoiceContext {
        // A fresh owner for every card, so rendered options are cleaned up when the card changes
        this.choiceComponent?.unload();
        this.choiceComponent = new Component();
        this.choiceComponent.load();
        const sourcePath = sessionData.currentNote.filePath;
        return {
            app: this.app,
            sourcePath,
            component: this.choiceComponent,
            textDirection: sessionData.currentQuestion.questionText.textDirection,
            // Internal links in an option open their note, and do not choose the option
            onRendered: (el) => wireInternalLinks(el, this.app, this.plugin, sourcePath),
        };
    }

    /**
     * Forgets the choice and the typed answer of the card that was up.
     */
    private resetStudyAids(): void {
        this.choice = null;
        this.choiceHandle = null;
        this.typedInput = null;
        this.typedValue = null;
        this.choiceComponent?.unload();
        this.choiceComponent = null;
    }

    private typeAnswersOn(): boolean {
        return this.typeAnswersOverride ?? this.lastSession?.settings.typeAnswers ?? false;
    }

    private toggleTypeAnswers(): void {
        this.typeAnswersOverride = !this.typeAnswersOn();
        // The card that is up shows its field (or loses it) at once
        if (this.cardState === CardState.Front && this.lastSession !== null) {
            void this.drawCardFront(this.lastSession.sessionData, this.lastSession.settings);
        }
    }

    // #endregion

    // #region -> Read aloud

    /**
     * Reads the side of the card that is showing, with the chosen voice (see src/ui/speech.ts). Does nothing where
     * the device cannot speak.
     */
    public readAloud(): void {
        if (
            !speechAvailable() ||
            this.lastSession === null ||
            this.cardState === CardState.Closed
        ) {
            return;
        }
        const settings = this.lastSession.settings;
        const voice = pickVoice(
            activeWindow.speechSynthesis.getVoices(),
            settings.speechVoice,
            moment.locale(),
        );
        const rate = Math.min(2, Math.max(0.5, settings.speechRate || 1));
        this.speaker.speak(joinSpeech(this.speechParts()), voice, rate);
    }

    /**
     * What is worth reading on the visible side: the question and the options, or the answer and its explanation.
     * The context line, the hints and the fields to type in are left out.
     */
    private speechParts(): string[] {
        const back = this.cardState === CardState.Back;
        const choiceRoot = this.content.querySelector<HTMLElement>(".fs-choice-root");
        if (choiceRoot !== null) {
            const parts = back
                ? [".fs-choice.is-correct .fs-choice-text", ".fs-choice-explanation-text"]
                : [".fs-choice-question", ".fs-choice-lead", ".fs-choice-text"];
            return Array.from(choiceRoot.querySelectorAll<HTMLElement>(parts.join(","))).map(
                speakableText,
            );
        }

        const clone = this.content.cloneNode(true) as HTMLElement;
        clone
            .querySelectorAll(".sr-context, .fs-reveal-hint, .fs-answer-pill, .fs-typed")
            .forEach((el) => el.remove());
        if (back) {
            // The answer starts after the divider between it and the question (a cloze card has none)
            const divider = clone.querySelector(":scope > hr");
            while (divider?.previousSibling) divider.previousSibling.remove();
            divider?.remove();
            // A typed answer: the expected text, not what was typed as well
            if (clone.querySelector(".fs-typed-expected") !== null) {
                clone.querySelector(".fs-typed-typed")?.remove();
            }
        }
        return [speakableText(clone)];
    }

    // #endregion

    /**
     * Studio: a green "Answer" label where the answer starts (after the question, or at the top of a cloze card).
     */
    private insertAnswerLabel(): void {
        const label = createDiv({ cls: "fs-pill fs-answer-pill", text: t("STUDIO_ANSWER") });
        const divider = this.content.querySelector(":scope > hr");
        const context = this.content.querySelector(":scope > .sr-context");
        if (divider) divider.after(label);
        else if (context) context.after(label);
        else this.content.prepend(label);
    }

    /**
     * Slides a new card into place in the Studio look (not when the system asks for reduced motion).
     */
    private animateCardIn(): void {
        if (!this.view.hasClass("sr-look-studio")) return;
        if (activeWindow.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        this.content.animate(
            [
                { opacity: 0, transform: "translateY(14px) scale(0.985)" },
                { opacity: 1, transform: "none" },
            ],
            { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
    }

    /**
     * Applies the review screen's look and the key hints for the chosen answer keys. Called on every draw, so a
     * settings change shows on the next card.
     */
    private applyAppearance(settings: SRSettings): void {
        const studio = settings.reviewLook !== "classic";
        this.view.toggleClass("sr-look-studio", studio);
        this.view.toggleClass("fs-studio", studio);
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
    /**
     * Marks each typed cloze answer right or wrong. Case, spacing and trailing punctuation do not count, and accents
     * only when "Ignore accents" is on.
     *
     * @returns Whether every blank was right, or null when the card had no fields to type in.
     */
    private _evaluateClozeAnswers(ignoreAccents: boolean): boolean | null {
        this.clozeAnswers = activeDocument.querySelectorAll(".cloze-answer");

        if (
            this.clozeInputs === null ||
            this.clozeInputs.length === 0 ||
            this.clozeAnswers.length !== this.clozeInputs.length
        ) {
            return null;
        }
        let allRight = true;
        for (let i = 0; i < this.clozeAnswers.length; i++) {
            const clozeInput = this.clozeInputs[i];
            const clozeAnswer = this.clozeAnswers[i] as HTMLElement;

            const inputText = clozeInput.value.trim();
            const answerText = clozeAnswer.innerText.trim();
            const right =
                normalizeAnswer(inputText, ignoreAccents) ===
                normalizeAnswer(answerText, ignoreAccents);
            if (!right) allRight = false;

            clozeAnswer.empty();

            const answerElement = clozeAnswer.createSpan({
                text: escapeHtml(inputText),
                cls: "cloze-answer",
            });

            answerElement.addClass(right ? "cloze-answer-correct" : "cloze-answer-incorrect");

            if (!right) {
                clozeAnswer.createSpan({
                    text: escapeHtml(answerText),
                    cls: "cloze-answer-wrong",
                });
            }
        }
        return allRight;
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
        this.lastSession = { sessionData, settings };
        this.speaker.stop();

        // What was typed or chosen on the front, before the content is rebuilt
        if (this.typedInput !== null) {
            this.typedValue = this.typedInput.value;
            this.typedInput = null;
        }
        this.choiceHandle = null;
        const choice = this.choiceFor(sessionData, settings, true);
        if (choice !== null) {
            choice.locked = true;
            this.choice = choice;
        }
        this.content.toggleClass("fs-choice-card", choice !== null);
        // The rating the answer suggests, if there is one
        let suggestion: ReviewResponse | null = null;

        this.toolbar.setResetButtonDisabled(false);
        this.showFlag(sessionData.cardData.currentCard?.meta.flag ?? 0);

        if (choice !== null) {
            // A multiple choice card shows its tiles marked right and wrong, and the explanation
            const choiceRoot = await this.drawCardFrontContent(sessionData, settings, choice);
            if (choiceRoot !== null) {
                await renderChoiceBack(choiceRoot, choice, this.choiceContext(sessionData));
            }
            if (choice.chosen.length > 0) {
                suggestion = isChoiceCorrect(choice.mc, choice.chosen)
                    ? ReviewResponse.Good
                    : ReviewResponse.Again;
            }
        } else {
            // Show answer text. A cloze card, and an image occlusion card, show only their back: it is the whole card
            if (
                sessionData.currentQuestion.questionType !== CardType.Cloze &&
                sessionData.currentQuestion.questionType !== CardType.ImageOcclusion
            ) {
                await this.drawCardFrontContent(sessionData, settings);
                const hr: HTMLElement = createEl("hr");
                this.content.appendChild(hr);
            } else {
                this.content.empty();
                this.drawCardContext(sessionData, settings);
            }

            const backText = sessionData.cardData.currentCard.back;
            const typedTarget = this.typedValue !== null ? typedAnswerTarget(backText) : null;
            if (this.typedValue !== null && typedTarget !== null) {
                // The answer was typed: show it letter by letter against the expected one
                const comparison = compareTypedAnswer(
                    this.typedValue,
                    typedTarget,
                    settings.ignoreAccentsWhenTyping,
                );
                renderTypedResult(
                    this.content,
                    comparison,
                    sessionData.currentQuestion.questionText.textDirection,
                );
                suggestion = comparison.exact ? ReviewResponse.Good : ReviewResponse.Again;
            } else {
                const wrapper: RenderMarkdownWrapper = new RenderMarkdownWrapper(
                    this.app,
                    this.plugin,
                    sessionData.currentNote.filePath,
                );
                await wrapper.renderMarkdownWrapper(
                    backText,
                    this.content,
                    sessionData.currentQuestion.questionText.textDirection,
                    // sessionData.cardData.currentCardState,
                );
            }

            // Evaluate cloze answers
            const clozeRight = this._evaluateClozeAnswers(settings.ignoreAccentsWhenTyping);
            if (clozeRight !== null) {
                suggestion = clozeRight ? ReviewResponse.Good : ReviewResponse.Again;
            }
        }
        this.content.addClass("sr-answer-shown");
        if (choice === null && this.view.hasClass("sr-look-studio")) this.insertAnswerLabel();

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
        this.response.setSuggested(suggestion);
        // With the answer tiles showing there may be too little room for the whole card
        if (choice !== null) revealChoiceResult(this.content);
        // NEW: restore keyboard focus after cloze confirmation
        if (this.plugin.uiManager === null) throw new Error("UI manager not initialized!!!");
        this.plugin.uiManager.setSRViewInFocus(true);
        this.response.againButton.buttonEl.focus();

        if (settings.readAnswerAloud) this.readAloud();
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
        // While an answer is being typed, the keys that are shortcuts (Space, s, u, -, @, digits) are letters. The field
        // is normally focused; if it is not, focus it, and the key then types into it.
        if (this.typedInput !== null && this.cardState === CardState.Front && e.key.length === 1) {
            this.typedInput.focus();
            return;
        }
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
            // On a multiple choice card the number keys choose an option until the answer is shown
            if (this.cardState === CardState.Front && this.choiceHandle !== null && digit >= 1) {
                this.choiceHandle.chooseAt(digit - 1);
                consumeKeyEvent();
                return;
            }
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

        // Enter or Space on a focused option tile chooses that tile
        if (
            this.cardState === CardState.Front &&
            (e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space")
        ) {
            const focused = activeDocument.activeElement as HTMLElement | null;
            if (focused?.matches(".fs-choices .fs-choice")) {
                focused.click();
                consumeKeyEvent();
                return;
            }
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
            case "KeyR":
                if (speechAvailable()) {
                    this.readAloud();
                    consumeKeyEvent();
                }
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
