import "src/ui/obsidian-ui-components/content-container/card-container/card-screen.css";
import "src/ui/obsidian-ui-components/content-container/card-container/review-studio.css";
import "src/ui/obsidian-ui-components/content-container/card-container/study-additions.css";
import { App, Component, Platform, setIcon } from "obsidian";

import { Card } from "src/data/data-structures/card/flashcard";
import { CardType } from "src/data/data-structures/card/question";
import {
    isChoiceCorrect,
    parseMultipleChoice,
} from "src/data/data-structures/card/questions/multiple-choice";
import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { StudioSettings } from "src/data/settings-model";
import { t } from "src/lang/translate";
import { occlusionTypedTarget } from "src/occlusion/occlusion-view";
import { digitFromKeyCode, responseForDigit } from "src/scheduling/answer-keys";
import { formatScheduleInterval } from "src/scheduling/display";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { ScheduleState } from "src/scheduling/schedule/schedule-state";
import {
    compareTypedAnswer,
    normalizeAnswer,
    typedAnswerTarget,
} from "src/scheduling/typed-answer";
import { SessionSummary } from "src/stats/session";
import FlashcardStudioPlugin from "src/studio-plugin";
import { CardActions, FLAG_COUNT } from "src/ui/card-actions";
import { readableDeckName } from "src/ui/design/deck-identity";
import {
    ChoiceContext,
    ChoiceFrontHandle,
    ChoiceState,
    createChoiceState,
    renderChoiceBack,
    renderChoiceFront,
    revealChoiceResult,
} from "src/ui/obsidian-ui-components/content-container/card-container/choice-view";
import ContextSectionComponent from "src/ui/obsidian-ui-components/content-container/card-container/context-section/context-line";
import ResponseSectionComponent from "src/ui/obsidian-ui-components/content-container/card-container/response-section/answer-row";
import CardToolbarComponent from "src/ui/obsidian-ui-components/content-container/card-container/toolbar/card-toolbar";
import {
    renderTypedInput,
    renderTypedResult,
} from "src/ui/obsidian-ui-components/content-container/card-container/typed-answer-view";
import {
    CardState,
    SessionData,
} from "src/ui/obsidian-ui-components/content-container/session-data";
import {
    renderSessionSummary,
    SessionSummaryActions,
} from "src/ui/obsidian-ui-components/content-container/session-summary/session-summary";
import { ConfirmationModal } from "src/ui/obsidian-ui-components/modals/confirm-modal";
import { joinSpeech, pickVoice, speakableText, Speaker, speechAvailable } from "src/ui/speech";
import { formatAnswerTime, formatIntervalCompact } from "src/utils/format-interval";
import { CardMarkdown, CardRenderer } from "src/utils/markdown-render";
import { moment } from "src/utils/moment-en";
import { TextDirection } from "src/utils/text";

/** The star in the Studio card's corner stands for Anki's orange flag. */
const STAR_FLAG = 2;

const HIDDEN = "fs-is-hidden";

/** The time left on the waiting screen as H:MM:SS. */
function clockText(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** Whether keys typed here are text, not shortcuts. */
function isTextEntry(el: Element | null): boolean {
    if (el === null) return false;
    if (el.instanceOf(HTMLTextAreaElement)) return true;
    if (el.instanceOf(HTMLInputElement)) {
        return !["button", "checkbox", "radio", "submit", "reset", "range", "color"].includes(
            el.type,
        );
    }
    return (el as HTMLElement).isContentEditable === true;
}

/** Whether a focused element has a way of being pressed by itself, which the Enter and Space keys must leave alone. */
function isPressable(el: Element | null): boolean {
    if (el === null || el === el.ownerDocument.body) return false;
    return (
        el.closest("button, a[href], select, summary, [role='button'], [role='menuitem']") !== null
    );
}

/**
 * The card screen: toolbar, progress, the card itself, and the answer buttons. It draws what the content manager tells
 * it to, takes the review keys, and hands every action back to the manager.
 */
export default class CardContainer {
    private readonly view: HTMLDivElement;
    private readonly toolbar: CardToolbarComponent;
    private readonly scroller: HTMLDivElement;
    private readonly content: HTMLDivElement;
    private readonly starButton: HTMLButtonElement;
    private readonly response: ResponseSectionComponent;
    private readonly statusEl: HTMLDivElement;
    private readonly markdown: CardMarkdown;

    private cardState: CardState = CardState.Closed;
    // The waiting screen shows no card: the card keys have nothing to act on
    private waiting = false;
    private keyDocument: Document | null = null;
    // Whether the last thing the person did was press a key, which decides where the focus goes after the answer
    private usedKeyboard = false;

    // Multiple choice and typed answers: what is up on this card, and what the person did with it
    private choice: ChoiceState | null = null;
    private choiceHandle: ChoiceFrontHandle | null = null;
    private choiceComponent: Component | null = null;
    private typedInput: HTMLInputElement | null = null;
    private typedValue: string | null = null;
    private clozeInputs: HTMLInputElement[] = [];
    /** The menu's "Type answers" for this session; null follows the setting. */
    private typeAnswersOverride: boolean | null = null;
    private lastSession: { session: SessionData; settings: StudioSettings } | null = null;
    private readonly speaker = new Speaker();

    private toastEl: HTMLDivElement | null = null;
    private toastTimer: number | null = null;
    private summaryEl: HTMLElement | null = null;
    private waitTicker: number | null = null;

    constructor(
        private readonly app: App,
        private readonly plugin: FlashcardStudioPlugin,
        private readonly settings: StudioSettings,
        parentEl: HTMLElement,
        onDelete: () => void,
        onBackToDecks: () => Promise<void>,
        onEdit: () => void,
        private readonly onAnswer: (response: ReviewResponse) => Promise<void>,
        private readonly onSkip: () => void,
        private readonly onReveal: () => void,
        private readonly onJump: () => Promise<void>,
        onShowInfo: () => void,
        private readonly actions: CardActions,
        closeModal?: () => void,
    ) {
        this.view = parentEl.createDiv({ cls: "fs-container fs-card-container fs-is-hidden" });
        this.setCustomHotKeyState(settings.useCustomHotkeys);
        this.applyAppearance(settings);

        this.toolbar = new CardToolbarComponent(
            this.view,
            settings.showDeleteButtonInCardView,
            {
                deleteCard: onDelete,
                backToDecks: onBackToDecks,
                edit: onEdit,
                jumpToNote: onJump,
                showInfo: onShowInfo,
                skip: onSkip,
                resetProgress: () => this.askToResetCard(),
            },
            actions,
            closeModal,
        );
        this.toolbar.setTypeAnswersToggle({
            isOn: () => this.typeAnswersOn(),
            toggle: () => this.toggleTypeAnswers(),
        });
        this.toolbar.setSpeakHandler(() => this.readAloud());

        this.scroller = this.view.createDiv({ cls: "fs-scroll-wrapper" });
        this.content = this.scroller.createDiv({
            cls: "fs-content",
            attr: { role: "region", "aria-label": t("A11Y_CARD_REGION") },
        });
        this.markdown = new CardMarkdown(app, this.content);

        // Studio: a star in the card's corner, and tapping the question reveals the answer
        this.starButton = this.scroller.createEl("button", {
            cls: "fs-card-star",
            attr: { "aria-label": t("STAR_CARD"), "aria-pressed": "false" },
        });
        setIcon(this.starButton, "star");
        this.starButton.addEventListener("click", (event) => {
            event.stopPropagation();
            const flag = this.actions.currentFlag();
            void this.actions.setFlag(flag === STAR_FLAG ? 0 : STAR_FLAG);
        });
        this.content.addEventListener("click", (event) => {
            if (!this.view.hasClass("fs-look-studio")) return;
            if (this.cardState !== CardState.Front || this.waiting) return;
            const target = event.target as HTMLElement | null;
            if (target?.closest("a, input, button, .cloze-input, .fs-choices, .fs-typed")) return;
            // Selecting text ends in a click too; that is reading, not asking for the answer
            const selection = activeWindow.getSelection();
            if (
                selection !== null &&
                !selection.isCollapsed &&
                this.content.contains(selection.anchorNode)
            ) {
                return;
            }
            this.onReveal();
        });
        this.view.addEventListener("pointerdown", () => {
            this.usedKeyboard = false;
        });

        this.response = new ResponseSectionComponent(
            this.view,
            settings,
            () => this.onReveal(),
            (response) => this.onAnswer(response),
        );

        // What a screen reader is told as the card changes; sighted users never see it
        this.statusEl = this.view.createDiv({
            cls: "fs-live-region",
            attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
        });
    }

    // #region -> Opening and closing

    /**
     * Shows the screen on its first card. Does nothing when it is already showing, so repeated calls are harmless.
     */
    public async openSession(session: SessionData, settings: StudioSettings): Promise<void> {
        if (!this.view.hasClass(HIDDEN)) return;
        // Drawn while hidden, so the screen never flashes the card that was there last
        await this.drawCardFront(session, settings);
        this.view.removeClass(HIDDEN);
        this.keyDocument = activeDocument;
        this.keyDocument.addEventListener("keydown", this.keydownHandler);
        this.focusFrontField();
    }

    /**
     * The first card of a session is drawn while the view is still hidden, and a field cannot take focus until it is
     * shown. Focuses the field to type in (the answer, or the first cloze blank) once the view is visible.
     */
    private focusFrontField(): void {
        if (this.cardState !== CardState.Front || this.waiting) return;
        if (this.typedInput !== null) {
            if (!Platform.isMobile) this.typedInput.focus();
            return;
        }
        if (!Platform.isMobile) this.clozeInputs[0]?.focus();
    }

    public closeSession(): void {
        if (this.view.hasClass(HIDDEN)) return;
        this.stopWaitingClock();
        this.cardState = CardState.Closed;
        this.waiting = false;
        this.hideAnswerToast();
        this.hideSessionSummary();
        this.typeAnswersOverride = null;
        this.resetStudyAids();
        this.markdown.release();
        this.speaker.stop();
        this.keyDocument?.removeEventListener("keydown", this.keydownHandler);
        this.keyDocument = null;
        this.view.addClass(HIDDEN);
    }

    // #endregion

    public get isShowingSessionSummary(): boolean {
        return this.summaryEl !== null;
    }

    /** Whether the card on screen is a multiple choice card whose answer is still to be given: 1 to 9 choose an option. */
    public get choosesByNumber(): boolean {
        return this.cardState === CardState.Front && this.choiceHandle !== null;
    }

    private setCustomHotKeyState(custom: boolean): void {
        this.view.toggleClass("fs-custom-hotkeys", custom);
    }

    /**
     * Applies the review screen's look and the key hints for the chosen answer keys. Called on every draw, so a
     * settings change shows on the next card.
     */
    private applyAppearance(settings: StudioSettings): void {
        const studio = settings.reviewLook !== "classic";
        this.view.toggleClass("fs-look-studio", studio);
        this.view.toggleClass("fs-studio", studio);
        this.view.toggleClass("fs-look-classic", !studio);
        this.view.toggleClass("fs-keys-anki", settings.answerKeys === "anki");
        this.setCustomHotKeyState(settings.useCustomHotkeys);
    }

    /** Tells a screen reader something, once. */
    private announce(message: string): void {
        this.statusEl.setText(message);
    }

    // #region -> Session summary, flag, progress, toast

    /** Replaces the card with the summary of the session that just ended. */
    public showSessionSummary(summary: SessionSummary, actions: SessionSummaryActions): void {
        this.hideSessionSummary();
        // The toast of the previous answer would sit on top of the summary's buttons
        this.hideAnswerToast();
        this.toolbar.markSessionComplete();
        this.speaker.stop();
        this.stopWaitingClock();
        // No card is being shown, so the review shortcuts must do nothing
        this.cardState = CardState.Closed;
        this.waiting = false;
        this.view.addClass("fs-summary-open");
        this.scroller.addClass(HIDDEN);
        this.response.responseEl.addClass(HIDDEN);
        this.summaryEl = renderSessionSummary(this.view, summary, actions);
        this.announce(t("A11Y_SESSION_COMPLETE", { count: summary.reviews }));
    }

    /** Removes the session summary, if it is showing. The next card brings the rest of the screen back. */
    public hideSessionSummary(): void {
        if (this.summaryEl === null) return;
        this.summaryEl.remove();
        this.summaryEl = null;
        this.view.removeClass("fs-summary-open");
        this.scroller.removeClass(HIDDEN);
    }

    /** Shows the card's flag colour as a border on the card, or removes it for 0. */
    public showFlag(flag: number): void {
        for (let i = 1; i <= FLAG_COUNT; i++) this.scroller.removeClass(`fs-flag-${i}`);
        if (flag > 0) this.scroller.addClass(`fs-flag-${flag}`);
        this.starButton.toggleClass("is-on", flag === STAR_FLAG);
        this.starButton.setAttribute("aria-pressed", String(flag === STAR_FLAG));
    }

    /** Shows the answers given in this session in the progress bar. */
    public setSessionAnswers(responses: readonly ReviewResponse[]): void {
        this.toolbar.setSessionAnswers(responses);
    }

    /** Briefly shows what the last answer did, with a button to undo it. */
    public showAnswerToast(entry: ReviewLogEntry): void {
        this.hideAnswerToast();
        const rating = this.ratingName(entry.r);
        const interval = formatIntervalCompact(entry.ivl);
        const toast = this.view.createDiv({ cls: "fs-answer-toast" });
        toast.createSpan({ cls: `fs-answer-toast-rating fs-rating-${entry.r}`, text: rating });
        toast.createSpan({
            cls: "fs-answer-toast-interval",
            text: t("NEXT_REVIEW_IN", { interval }),
        });
        const undoButton = toast.createEl("button", {
            cls: "fs-answer-toast-undo",
            text: t("UNDO"),
        });
        undoButton.addEventListener("click", () => {
            this.hideAnswerToast();
            void this.actions.undo();
        });
        this.toastEl = toast;
        this.toastTimer = window.setTimeout(() => this.hideAnswerToast(), 4000);
        this.announce(t("A11Y_RATED", { rating, interval }));
    }

    public hideAnswerToast(): void {
        if (this.toastTimer !== null) {
            window.clearTimeout(this.toastTimer);
            this.toastTimer = null;
        }
        this.toastEl?.remove();
        this.toastEl = null;
    }

    /** The name of the answer a log entry holds (0 Reset, then Again to Easy), as the buttons call it. */
    private ratingName(logged: number): string {
        const names = [
            t("RATING_RESET"),
            this.settings.flashcardAgainText,
            this.settings.flashcardHardText,
            this.settings.flashcardGoodText,
            this.settings.flashcardEasyText,
        ];
        return names[logged] ?? "";
    }

    // #endregion

    // #region -> Drawing the front

    /**
     * Draws the front of the card in `session`: the question, with the aids to answer it (options, a field to type
     * in), and the "Show answer" button.
     */
    public async drawCardFront(session: SessionData, settings: StudioSettings): Promise<void> {
        this.stopWaitingClock();
        this.waiting = false;
        this.speaker.stop();
        this.hideSessionSummary();
        this.toolbar.setResetButtonDisabled(true);
        this.cardState = session.cardData.cardState;
        this.updateInfoBar(session);
        this.showFlag(session.cardData.currentCard?.meta.flag ?? 0);
        this.applyAppearance(settings);
        this.content.removeClass("fs-answer-shown");
        this.lastSession = { session, settings };

        // Multiple choice tiles, or a field to type the answer in, go under the question
        this.resetStudyAids();
        const choice = this.choiceFor(session, settings, false);
        const card = session.cardData.currentCard;
        const typedTarget =
            choice === null &&
            this.typeAnswersOn() &&
            session.currentQuestion.questionType !== CardType.Cloze
                ? this.typedTargetOf(session.currentQuestion.questionType, card?.back ?? "")
                : null;
        this.content.toggleClass("fs-choice-card", choice !== null);

        const markdown = this.markdown.startCard(session.currentNote.filePath);
        const front = await this.drawCardFrontContent(session, settings, markdown, choice);
        // The answer was shown, or the card changed, while the question rendered: that draw owns the screen now
        if (!front.stillUp) return;
        const choiceRoot = front.choiceRoot;
        const mobile = Platform.isMobile;
        let optionsRendered: Promise<void> = Promise.resolve();
        if (choice !== null && choiceRoot !== null) {
            this.choice = choice;
            this.choiceHandle = renderChoiceFront(
                choiceRoot,
                choice,
                this.choiceContext(session),
                () => this.onReveal(),
            );
            optionsRendered = this.choiceHandle.rendered;
        } else if (typedTarget !== null) {
            this.typedInput = renderTypedInput(this.content, {
                autofocus: !mobile,
                onSubmit: () => this.onReveal(),
                textDirection: session.currentQuestion.questionText.textDirection,
            });
        }
        if (this.view.hasClass("fs-look-studio")) {
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

        this.response.resetResponseButtons();
        // Choosing an option is what shows the answer of a multiple choice card
        if (this.choice !== null) this.response.hideAllButtons();

        // Blanks to type in: Enter checks, like the field for a typed answer
        this.clozeInputs = Array.from(
            this.content.querySelectorAll<HTMLInputElement>(".cloze-input"),
        );
        for (const input of this.clozeInputs) {
            input.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.key !== "Enter" || event.isComposing) return;
                event.preventDefault();
                event.stopPropagation();
                input.blur();
                this.onReveal();
            });
        }
        if (!this.view.hasClass(HIDDEN) && !mobile) this.clozeInputs[0]?.focus();

        this.announce(this.frontMessage(session));

        if (settings.readQuestionAloud) {
            // The options of a choice card fill in a moment after their tiles are made
            await optionsRendered;
            if (this.cardState === CardState.Front && session.cardData.currentCard === card) {
                this.readAloud();
            }
        }
    }

    /** "Card 4 of 17, deck Part 2, front. 5 due, 12 new in the queue." */
    private frontMessage(session: SessionData): string {
        const { deckData, totalCardsInSession } = session;
        const done = totalCardsInSession - deckData.chosenDeckStats.cardsInQueueCount;
        return t("A11Y_CARD_FRONT", {
            number: Math.min(done + 1, totalCardsInSession),
            total: totalCardsInSession,
            deck: readableDeckName(deckData.currentDeck.deckName),
            due: deckData.chosenDeckStats.dueCount,
            newCount: deckData.chosenDeckStats.newCount,
        });
    }

    private updateInfoBar(session: SessionData): void {
        const deckData = session.deckData;
        this.toolbar.updateInfo(
            deckData.chosenDeck,
            deckData.currentDeck,
            deckData.chosenDeckStats,
            deckData.currentDeckStats,
            session.totalCardsInSession,
            session.totalDecksInSession,
            deckData.currentDeckTotalCardsInQueue,
            this.settings.flashcardCardOrder,
        );
    }

    /** Empties the card and puts the line that says where it is from at the top, when that is switched on. */
    private resetContent(session: SessionData, settings: StudioSettings): void {
        this.content.empty();
        if (settings.showContextInCards) {
            new ContextSectionComponent(this.content).updateCardContext(
                true,
                session.currentQuestion,
                session.currentNote,
            );
        }
    }

    /**
     * @returns `choiceRoot`: the block that holds a multiple choice card (its label, question, tiles and explanation),
     *          or null for any other card, whose question is rendered straight into the content. `stillUp`: false
     *          when the card changed, or its answer was shown, while the question rendered; the caller must then add
     *          nothing more to the screen.
     */
    private async drawCardFrontContent(
        session: SessionData,
        settings: StudioSettings,
        markdown: CardRenderer,
        choice: ChoiceState | null = null,
    ): Promise<{ choiceRoot: HTMLElement | null; stillUp: boolean }> {
        this.resetContent(session, settings);
        const direction = session.currentQuestion.questionText.textDirection;
        let target: HTMLElement = this.content;
        let choiceRoot: HTMLElement | null = null;
        if (choice !== null) {
            choiceRoot = this.content.createDiv({ cls: "fs-choice-root" });
            if (direction === TextDirection.Rtl) choiceRoot.setAttribute("dir", "rtl");
            const kind = choiceRoot.createDiv({ cls: "fs-choice-kind" });
            setIcon(kind.createSpan({ cls: "fs-choice-kind-icon" }), "list-checks");
            kind.createSpan({ text: t("MULTIPLE_CHOICE") });
            target = choiceRoot.createDiv({ cls: "fs-choice-question" });
        }

        const front = session.cardData.currentCard?.front ?? "";
        const stillUp = await markdown.render(front.trimStart(), target, direction);
        // Set scroll position back to top (not when another card's draw has taken the screen over)
        if (stillUp) this.content.scrollTop = 0;
        return { choiceRoot, stillUp };
    }

    // #endregion

    // #region -> The waiting screen

    /**
     * Shows that nothing is due right now, and counts down to the next card that is. The countdown is the one thing
     * that moves; a screen reader is told once.
     */
    public drawPendingState(nextDueUnix: number): void {
        this.hideSessionSummary();
        this.toolbar.setResetButtonDisabled(true);
        this.speaker.stop();
        // A digit must not reach a card that is gone
        this.resetStudyAids();
        this.content.removeClass("fs-choice-card", "fs-answer-shown");
        this.cardState = CardState.Front;
        this.waiting = true;
        this.content.empty();
        this.response.hideAllButtons();

        const message = this.content.createDiv({ cls: "fs-centered" });
        const refresh = (): void => {
            message.setText(
                t("WAITING_FOR_NEXT_STEP", { time: clockText(nextDueUnix - Date.now()) }),
            );
        };
        refresh();
        this.stopWaitingClock();
        this.waitTicker = window.setInterval(refresh, 1000);
        this.announce(t("A11Y_WAITING", { time: formatAnswerTime(nextDueUnix - Date.now()) }));
    }

    private stopWaitingClock(): void {
        if (this.waitTicker === null) return;
        window.clearInterval(this.waitTicker);
        this.waitTicker = null;
    }

    // #endregion

    // #region -> Multiple choice and typed answers

    /**
     * The state of the multiple choice card that is up, or null when it is an ordinary card. A cloze card is never
     * multiple choice. With `reuse`, the state of this card's front is kept (its order of options and the choice).
     */
    private choiceFor(
        session: SessionData,
        settings: StudioSettings,
        reuse: boolean,
    ): ChoiceState | null {
        const card: Card | null = session.cardData.currentCard;
        if (card === null || session.currentQuestion.questionType === CardType.Cloze) {
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

    private choiceContext(session: SessionData): ChoiceContext {
        // A fresh owner for every card, so rendered options are cleaned up when the card changes
        this.choiceComponent?.unload();
        this.choiceComponent = new Component();
        this.choiceComponent.load();
        return {
            app: this.app,
            sourcePath: session.currentNote.filePath,
            component: this.choiceComponent,
            textDirection: session.currentQuestion.questionText.textDirection,
        };
    }

    /** Forgets the choice and the typed answer of the card that was up. */
    private resetStudyAids(): void {
        this.choice = null;
        this.choiceHandle = null;
        this.typedInput = null;
        this.typedValue = null;
        this.clozeInputs = [];
        this.choiceComponent?.unload();
        this.choiceComponent = null;
    }

    /**
     * The text to type for a card: its short plain answer, or for an occlusion card the label of the mask it asks
     * about. Null when the card has nothing to type.
     */
    private typedTargetOf(questionType: CardType, back: string): string | null {
        return questionType === CardType.ImageOcclusion
            ? occlusionTypedTarget(back)
            : typedAnswerTarget(back);
    }

    private typeAnswersOn(): boolean {
        return this.typeAnswersOverride ?? this.lastSession?.settings.typeAnswers ?? false;
    }

    private toggleTypeAnswers(): void {
        this.typeAnswersOverride = !this.typeAnswersOn();
        // The card that is up shows its field (or loses it) at once
        if (this.cardState === CardState.Front && !this.waiting && this.lastSession !== null) {
            void this.drawCardFront(this.lastSession.session, this.lastSession.settings);
        }
    }

    /**
     * Marks each typed cloze answer right or wrong. Case, spacing and trailing punctuation do not count, and accents
     * only when "Ignore accents" is on.
     *
     * @returns Whether every blank was right, or null when the card had no fields to type in.
     */
    private evaluateClozeAnswers(ignoreAccents: boolean): boolean | null {
        const answers = Array.from(this.content.querySelectorAll<HTMLElement>(".cloze-answer"));
        if (this.clozeInputs.length === 0 || answers.length !== this.clozeInputs.length) {
            return null;
        }
        let allRight = true;
        answers.forEach((answer, i) => {
            const typed = this.clozeInputs[i].value;
            const expected = answer.textContent ?? "";
            const right =
                normalizeAnswer(typed, ignoreAccents) === normalizeAnswer(expected, ignoreAccents);
            if (!right) allRight = false;
            answer.empty();
            answer.createSpan({
                cls: right ? "cloze-answer-correct" : "cloze-answer-incorrect",
                text: typed,
            });
            if (!right) {
                // The expected answer beside what was typed
                answer.appendText(" ");
                answer.createSpan({ cls: "cloze-answer-wrong", text: expected });
            }
        });
        return allRight;
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
            this.cardState === CardState.Closed ||
            this.waiting
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
            .querySelectorAll(".fs-context, .fs-reveal-hint, .fs-answer-pill, .fs-typed")
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

    // #region -> Drawing the back

    /**
     * Shows the answer: the question again with the answer under it (a cloze or occlusion card shows only the back, which
     * is the whole card), the answer typed or chosen marked right or wrong, and the rating buttons.
     *
     * @param scheduleFor - What an answer would schedule for the card, for the interval on its button.
     */
    public async drawBack(
        session: SessionData,
        reviewMode: FlashcardReviewMode,
        settings: StudioSettings,
        scheduleFor: (response: ReviewResponse) => ScheduleState | null,
    ): Promise<void> {
        this.applyAppearance(settings);
        this.waiting = false;
        this.cardState = CardState.Back;
        this.lastSession = { session, settings };
        this.speaker.stop();

        // What was typed or chosen on the front, before the content is rebuilt
        if (this.typedInput !== null) {
            this.typedValue = this.typedInput.value;
            this.typedInput = null;
        }
        this.choiceHandle = null;
        const choice = this.choiceFor(session, settings, true);
        if (choice !== null) {
            choice.locked = true;
            this.choice = choice;
        }
        this.content.toggleClass("fs-choice-card", choice !== null);
        const markdown = this.markdown.startCard(session.currentNote.filePath);
        this.toolbar.setResetButtonDisabled(false);
        this.showFlag(session.cardData.currentCard?.meta.flag ?? 0);
        const direction = session.currentQuestion.questionText.textDirection;

        // The rating the answer suggests, if there is one
        let suggestion: ReviewResponse | null = null;
        if (choice !== null) {
            // A multiple choice card shows its tiles marked right and wrong, and the explanation. A draw that finds
            // it is no longer current (another card was drawn while it rendered: bury, suspend, undo) adds nothing
            // more: no answer state and no rating buttons over the newer card.
            const { choiceRoot, stillUp } = await this.drawCardFrontContent(
                session,
                settings,
                markdown,
                choice,
            );
            if (!stillUp) return;
            if (choiceRoot !== null) {
                const choiceCtx = this.choiceContext(session);
                await renderChoiceBack(choiceRoot, choice, choiceCtx);
                // renderChoiceBack does not say, but drawing another card replaces the choice component
                if (this.choiceComponent !== choiceCtx.component) return;
            }
            if (choice.chosen.length > 0) {
                suggestion = isChoiceCorrect(choice.mc, choice.chosen)
                    ? ReviewResponse.Good
                    : ReviewResponse.Again;
            }
        } else {
            // A cloze card, and an image occlusion card, show only their back: it is the whole card
            const questionType = session.currentQuestion.questionType;
            if (questionType !== CardType.Cloze && questionType !== CardType.ImageOcclusion) {
                const front = await this.drawCardFrontContent(session, settings, markdown);
                if (!front.stillUp) return;
                this.content.createEl("hr");
            } else {
                this.resetContent(session, settings);
            }

            const backText = session.cardData.currentCard?.back ?? "";
            const typedTarget =
                this.typedValue !== null ? this.typedTargetOf(questionType, backText) : null;
            const renderBack = (): Promise<boolean> =>
                markdown.render(backText, this.content, direction);
            if (this.typedValue !== null && typedTarget !== null) {
                // The picture of an occlusion card is its answer, and the typed label is checked under it
                if (questionType === CardType.ImageOcclusion && !(await renderBack())) return;
                // The answer was typed: show it letter by letter against the expected one
                const comparison = compareTypedAnswer(
                    this.typedValue,
                    typedTarget,
                    settings.ignoreAccentsWhenTyping,
                );
                renderTypedResult(this.content, comparison, direction);
                suggestion = comparison.exact ? ReviewResponse.Good : ReviewResponse.Again;
            } else if (!(await renderBack())) {
                return;
            }

            const clozeRight = this.evaluateClozeAnswers(settings.ignoreAccentsWhenTyping);
            if (clozeRight !== null) {
                suggestion = clozeRight ? ReviewResponse.Good : ReviewResponse.Again;
            }
        }
        this.content.addClass("fs-answer-shown");
        if (choice === null && this.view.hasClass("fs-look-studio")) this.insertAnswerLabel();

        // The answer that the Enter and Space keys give is the one to remember for the screen reader
        const defaultResponse =
            reviewMode === FlashcardReviewMode.Cram ? ReviewResponse.Easy : ReviewResponse.Good;
        let defaultSchedule: ScheduleState | null = null;
        const { flashcardAgainText, flashcardHardText, flashcardGoodText, flashcardEasyText } =
            settings;
        this.response.showRatingButtons(
            reviewMode,
            ...([flashcardAgainText, flashcardHardText, flashcardGoodText, flashcardEasyText] as [
                string,
                string,
                string,
                string,
            ]),
            settings.showIntervalInReviewButtons,
            (response) => {
                const schedule = scheduleFor(response);
                if (response === defaultResponse) defaultSchedule = schedule;
                return schedule;
            },
        );
        this.response.setSuggested(suggestion);
        // With the answer tiles showing there may be too little room for the whole card
        if (choice !== null) revealChoiceResult(this.content);

        // After a key press the next key presses the default button, so the focus goes there; after a click it stays put
        if (this.usedKeyboard) this.response.defaultButton.buttonEl.focus({ preventScroll: true });

        this.announce(this.answerMessage(defaultResponse, defaultSchedule));
        if (settings.readAnswerAloud) this.readAloud();
    }

    private answerMessage(defaultResponse: ReviewResponse, schedule: ScheduleState | null): string {
        if (schedule === null || !this.settings.showIntervalInReviewButtons) {
            return t("A11Y_ANSWER_SHOWN");
        }
        const name =
            defaultResponse === ReviewResponse.Easy
                ? this.settings.flashcardEasyText
                : this.settings.flashcardGoodText;
        return t("A11Y_ANSWER_SHOWN_NEXT", {
            rating: name,
            interval: formatScheduleInterval(schedule, false),
        });
    }

    /** Studio: a green "Answer" label where the answer starts (after the question, or at the top of a cloze card). */
    private insertAnswerLabel(): void {
        const label = createDiv({ cls: "fs-pill fs-answer-pill", text: t("STUDIO_ANSWER") });
        const divider = this.content.querySelector(":scope > hr");
        const context = this.content.querySelector(":scope > .fs-context");
        if (divider) divider.after(label);
        else if (context) context.after(label);
        else this.content.prepend(label);
    }

    /** Slides a new card into place in the Studio look (not when the system asks for reduced motion). */
    private animateCardIn(): void {
        if (!this.view.hasClass("fs-look-studio")) return;
        if (activeWindow.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        this.content.animate(
            [
                { opacity: 0, transform: "translateY(14px) scale(0.985)" },
                { opacity: 1, transform: "none" },
            ],
            { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
    }

    // #endregion

    // #region -> Resetting a card

    private askToResetCard(): void {
        // The button looks disabled until the answer is up; the menu item is disabled the same way
        if (this.cardState !== CardState.Back) return;
        // The review keys stand down while the dialog is up, or a key typed in it would act on the card behind it
        const { uiManager: ui } = this.plugin;
        const restoreFocus = ui.isStudioInFocus;
        ui.setStudioViewInFocus(false);
        const texts = [
            t("DELETE_SCHEDULING_DATA_OF_CURRENT_CARD"),
            t("CONFIRM_SCHEDULING_DATA_DELETION_OF_CURRENT_CARD"),
            t("SCHEDULING_DATA_DELETION_IN_PROGRESS_OF_CURRENT_CARD"),
        ] as const;
        new ConfirmationModal(
            this.app,
            ...texts,
            () => this.onAnswer(ReviewResponse.Reset),
            () => ui.setStudioViewInFocus(restoreFocus),
        ).open();
    }

    // #endregion

    // #region -> Keys

    /**
     * The review keys. They stand down for anything that is not the card: a field being typed in, a button of its own,
     * a dialog on top, and a key that is held down does each thing once.
     */
    private readonly keydownHandler = (e: KeyboardEvent): void => {
        this.usedKeyboard = true;
        // A key that something else took (a button pressed with Space, a sidebar item) is not the card's as well
        if (e.defaultPrevented) return;
        if (!this.plugin.isInitialized) return;
        if (this.plugin.dataManager.data.settings.useCustomHotkeys) return;
        if (this.cardState === CardState.Closed) return;
        if (!this.plugin.uiManager.isStudioInFocus) return;
        const focused = activeDocument.activeElement;
        if (isTextEntry(focused) || isTextEntry(e.target as Element | null)) return;

        const consume = (): void => {
            e.preventDefault();
            e.stopPropagation();
        };
        // A held key does its thing once: the repeats are taken so they do not fall through to the page, and dropped
        const act = (action: () => void): void => {
            consume();
            if (!e.repeat) action();
        };

        // Anki's review shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+1..7 flag, - bury, @ suspend
        if (e.ctrlKey || e.metaKey) {
            if (e.code === "KeyZ" && !e.shiftKey) {
                act(() => void this.actions.undo());
            } else if (/^Digit[1-7]$/.test(e.code)) {
                const flag = Number(e.code.slice(5));
                act(
                    () => void this.actions.setFlag(this.actions.currentFlag() === flag ? 0 : flag),
                );
            }
            return;
        }
        if (e.altKey) return;

        // Nothing is up on the waiting screen: only taking back the last answer makes sense
        if (this.waiting) {
            if (e.code === "KeyU") act(() => void this.actions.undo());
            return;
        }

        // While an answer is being typed, the keys that are shortcuts (Space, s, u, -, @, digits) are letters. The field
        // is normally focused; if it is not, focus it, and the key then types into it.
        if (this.typedInput !== null && this.cardState === CardState.Front && e.key.length === 1) {
            this.typedInput.focus();
            return;
        }
        // The number row is read by place, not by the character it gives: on AZERTY the 6 key gives "-", and it is 6. With
        // Shift a number key gives its character ("@" on a US keyboard is Shift 2), which is suspend
        const digit = digitFromKeyCode(e.code);
        if (digit === null || e.shiftKey) {
            if (e.key === "@") {
                act(() => void this.actions.suspend());
                return;
            }
            if (e.key === "-") {
                act(() => void this.actions.bury());
                return;
            }
        }

        if (digit !== null && !e.shiftKey) {
            // On a multiple choice card the number keys choose an option until the answer is shown
            if (this.cardState === CardState.Front && this.choiceHandle !== null && digit >= 1) {
                const handle = this.choiceHandle;
                act(() => handle.chooseAt(digit - 1));
                return;
            }
            const response = responseForDigit(
                this.plugin.dataManager.data.settings.answerKeys,
                digit,
            );
            if (this.cardState === CardState.Back && response !== null) {
                act(() => void this.onAnswer(response));
            }
            return;
        }

        const isConfirmKey = e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space";
        if (isConfirmKey && focused !== null) {
            // Enter or Space on a focused option tile or answer button presses it, once
            const own =
                focused.matches(".fs-choices .fs-choice") || focused.closest(".fs-response");
            if (own && focused.instanceOf(HTMLElement)) {
                act(() => focused.click());
                return;
            }
            // Any other button, link or menu with the focus does what it does; the key is its own
            if (isPressable(focused)) return;
        }

        switch (e.code) {
            case "KeyU":
                act(() => void this.actions.undo());
                return;
            case "KeyS":
                act(() => this.onSkip());
                return;
            case "KeyJ":
                act(() => void this.onJump());
                return;
            case "KeyR":
                if (speechAvailable()) act(() => this.readAloud());
                return;
            case "Enter":
            case "NumpadEnter":
            case "Space":
                act(() => {
                    if (this.cardState === CardState.Front) this.onReveal();
                    else void this.onAnswer(this.defaultResponse());
                });
                return;
        }
    };

    /** Good, or Easy in Cram mode, which has no Good button. */
    private defaultResponse(): ReviewResponse {
        return this.response.responseEl.hasClass("is-cram")
            ? ReviewResponse.Easy
            : ReviewResponse.Good;
    }

    // #endregion
}
