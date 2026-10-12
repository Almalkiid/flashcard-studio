import "src/ui/obsidian-ui-components/content-container/card-container/toolbar/card-toolbar.css";
import { Platform } from "obsidian";

import { Deck } from "src/data/decks/deck";
import { DeckStats } from "src/scheduling/review/deck-stats";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { CardActions } from "src/ui/card-actions";
import { createDeckTile, readableDeckName } from "src/ui/design/deck-identity";
import DeckInfoComponent from "src/ui/obsidian-ui-components/content-container/card-container/toolbar/deck-info/classic-deck-info";
import CardMenuButtonComponent, {
    TypeAnswersToggle,
} from "src/ui/obsidian-ui-components/content-container/card-container/toolbar/toolbar-buttons/card-menu";
import {
    createBackButton,
    createCloseButton,
    createEditButton,
    createResetButton,
    createSkipButton,
} from "src/ui/obsidian-ui-components/content-container/card-container/toolbar/toolbar-buttons/icon-buttons";
import SpeakButtonComponent from "src/ui/obsidian-ui-components/content-container/card-container/toolbar/toolbar-buttons/speak-button";
import { speechAvailable } from "src/ui/speech";
import StudioButton from "src/ui/studio-button";

/** Up to this many cards the desktop's progress bar draws a segment for each; above it, one continuous bar. */
const MAX_PROGRESS_SEGMENTS = 60;
/** Above this many answers the thin bar stops drawing a gap between them. */
const MANY_ANSWERS = 60;

const FULLY_RANDOM_ORDER = "EveryCardRandomDeckAndCard";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const ratingClass = (response: ReviewResponse): string =>
    `fs-session-answer-${ReviewResponse[response].toLowerCase()}`;

/** What the buttons of the bar do. */
export interface ToolbarHandlers {
    deleteCard: () => void;
    backToDecks: () => Promise<void>;
    edit: () => void;
    jumpToNote: () => Promise<void>;
    showInfo: () => void;
    skip: () => void;
    resetProgress: () => void;
}

/**
 * The bar above a card: back, the deck the card is from, how far the session is, and the buttons for the card. The
 * session's progress bar is drawn under it, as a sibling.
 */
export default class CardToolbarComponent {
    private readonly toolbar: HTMLDivElement;
    private readonly infoSection: DeckInfoComponent;
    private readonly progressFill: HTMLDivElement;
    private readonly counterEl: HTMLDivElement;
    private readonly titleDeckEl: HTMLDivElement;
    // One segment per card for the desktop's progress bar (the phone draws the fill above instead)
    private readonly segmentsEl: HTMLDivElement;
    private readonly resetButton: StudioButton;
    private readonly shortMenuButton: CardMenuButtonComponent;
    private readonly extendedMenuButton: CardMenuButtonComponent;
    private answers: readonly ReviewResponse[] = [];
    private drawnAnswers = 0;
    private totalCards = 0;
    private shownDeckKey: string | null = null;
    private speakHandler: (() => void) | null = null;

    constructor(
        parentEl: HTMLElement,
        showDeleteButton: boolean,
        handlers: ToolbarHandlers,
        actions: CardActions | null,
        closeModal?: () => void,
    ) {
        const isModal = closeModal !== undefined;
        const { deleteCard, backToDecks, edit, jumpToNote, showInfo, skip, resetProgress } =
            handlers;
        // A phone gets raised buttons, everything else plain icons
        const look = [Platform.isPhone ? "mod-raised" : "clickable-icon"];
        this.toolbar = parentEl.createDiv({ cls: "fs-card-toolbar" });

        createBackButton(this.toolbar, backToDecks, look);
        this.toolbar.createDiv({ cls: "fs-flex-spacer fs-center-spacer" });
        this.infoSection = new DeckInfoComponent(this.toolbar);

        // Studio shows the card's deck over a plain "4 / 17" instead of the deck badge
        const title = this.toolbar.createDiv({ cls: "fs-card-title" });
        this.titleDeckEl = title.createDiv({ cls: "fs-card-title-deck" });
        this.counterEl = title.createDiv({ cls: "fs-card-counter" });
        this.toolbar.createDiv({ cls: "fs-flex-spacer" });

        // Read aloud, on devices that can speak
        if (speechAvailable()) {
            new SpeakButtonComponent(this.toolbar, () => this.speakHandler?.(), look);
        }
        createEditButton(this.toolbar, edit, look);
        this.resetButton = createResetButton(this.toolbar, resetProgress, look);
        this.resetButton.buttonEl.addClass("mod-disabled");
        createSkipButton(this.toolbar, skip, look);
        this.toolbar.createDiv({ cls: "fs-divider" });

        const menu = (isExtended: boolean, extra: string): CardMenuButtonComponent =>
            new CardMenuButtonComponent(
                this.toolbar,
                isExtended,
                showDeleteButton,
                isModal,
                true,
                deleteCard,
                edit,
                jumpToNote,
                showInfo,
                skip,
                resetProgress,
                actions,
                closeModal,
                [extra, ...look],
            );
        this.shortMenuButton = menu(false, "fs-short-menu-button");
        this.extendedMenuButton = menu(true, "fs-extended-menu-button");
        if (closeModal) createCloseButton(this.toolbar, closeModal, look);

        this.segmentsEl = parentEl.createDiv({ cls: "fs-session-segments is-off" });
        // A slim bar under the toolbar showing how much of this session is done
        const progress = parentEl.createDiv({ cls: "fs-session-progress" });
        this.progressFill = progress.createDiv({ cls: "fs-session-progress-fill" });
    }

    /** What the speaker button does when it is pressed. */
    public setSpeakHandler(handler: () => void): void {
        this.speakHandler = handler;
    }

    /** Adds the "Type answers" switch for this session to both card menus. */
    public setTypeAnswersToggle(toggle: TypeAnswersToggle): void {
        this.extendedMenuButton.typeAnswersToggle = toggle;
        this.shortMenuButton.typeAnswersToggle = toggle;
    }

    public setResetButtonDisabled(disabled: boolean): void {
        this.resetButton.buttonEl.toggleClass("mod-disabled", disabled);
        this.shortMenuButton.setResetButtonDisabled(disabled);
        this.extendedMenuButton.setResetButtonDisabled(disabled);
    }

    /**
     * Colours the session's progress bar by the answers given so far, one segment per answer, oldest first. An answer
     * added to the end only adds its segment; any other change draws the bar again.
     */
    public setSessionAnswers(responses: readonly ReviewResponse[]): void {
        const appended = responses === this.answers && responses.length === this.drawnAnswers + 1;
        this.answers = responses;
        this.drawSegments();
        this.progressFill.toggleClass("fs-has-answers", responses.length > 0);
        this.progressFill.toggleClass("fs-many-answers", responses.length > MANY_ANSWERS);
        if (!appended) {
            this.progressFill.empty();
            this.drawnAnswers = 0;
        }
        for (let i = this.drawnAnswers; i < responses.length; i++) {
            this.progressFill.createDiv({ cls: `fs-session-answer ${ratingClass(responses[i])}` });
        }
        this.drawnAnswers = responses.length;
    }

    public updateInfo(
        chosenDeck: Deck,
        currentDeck: Deck,
        chosenDeckStats: DeckStats,
        currentDeckStats: DeckStats,
        totalCardsInSession: number,
        totalDecksInSession: number,
        currentDeckTotalCards: number,
        cardOrder: string,
    ): void {
        const done = totalCardsInSession - chosenDeckStats.cardsInQueueCount;
        this.totalCards = totalCardsInSession;
        this.drawSegments();
        const ratio = totalCardsInSession > 0 ? clamp01(done / totalCardsInSession) : 0;
        this.progressFill.setCssProps({ "--fs-progress": ratio.toFixed(4) });
        this.counterEl.setText(
            totalCardsInSession > 0
                ? `${Math.min(done + 1, totalCardsInSession)} / ${totalCardsInSession}`
                : "",
        );

        this.drawDeckTitle(currentDeck);

        const chosenPath = chosenDeck.getTopicPath().path.join("/");
        const currentPath = currentDeck.getTopicPath().path.join("/");
        this.infoSection.updateInfo(
            chosenDeck.deckName,
            totalCardsInSession,
            done,
            totalDecksInSession,
            totalDecksInSession - chosenDeckStats.decksInQueueOfThisDeckCount,
            currentDeck.deckName,
            currentDeckTotalCards,
            currentDeckTotalCards - currentDeckStats.cardsInQueueCount,
            cardOrder === FULLY_RANDOM_ORDER,
            chosenPath === currentPath,
        );
    }

    /** The deck tile and the breadcrumb of the card's deck; kept as they are while the deck stays the same. */
    private drawDeckTitle(currentDeck: Deck): void {
        const deckPath = currentDeck.getTopicPath().path;
        const key = deckPath.join("/");
        if (key === this.shownDeckKey) return;
        this.shownDeckKey = key;
        this.titleDeckEl.empty();
        if (deckPath.length === 0) return;
        createDeckTile(this.titleDeckEl, currentDeck.deckName);
        // One span per name, so the desktop layout can draw the path as a breadcrumb; the text is the same
        const path = this.titleDeckEl.createSpan();
        deckPath.forEach((name, index) => {
            if (index > 0) path.createSpan({ cls: "fs-crumb-sep", text: " – " });
            path.createSpan({ cls: "fs-crumb", text: readableDeckName(name) });
        });
    }

    /**
     * Draws a segment for each card of the session: those answered in the colour of the answer, the card on screen
     * marked. Left off for a long session, where the continuous bar is clearer.
     */
    private drawSegments(): void {
        this.segmentsEl.empty();
        const shown = this.totalCards > 0 && this.totalCards <= MAX_PROGRESS_SEGMENTS;
        this.segmentsEl.toggleClass("is-off", !shown);
        if (!shown) return;
        for (let i = 0; i < this.totalCards; i++) {
            const segment = this.segmentsEl.createEl("i");
            if (i < this.answers.length) segment.addClass(ratingClass(this.answers[i]));
            else if (i === this.answers.length) segment.addClass("is-current");
        }
    }

    /** Shows the session as finished: a full progress bar and every card counted as done. */
    public markSessionComplete(): void {
        this.progressFill.setCssProps({ "--fs-progress": "1" });
        const total = this.counterEl.getText().split("/")[1]?.trim();
        if (total) this.counterEl.setText(`${total} / ${total}`);
        this.infoSection.markChosenDeckComplete();
    }
}
