import "src/ui/obsidian-ui-components/content-container/card-container/toolbar/toolbar.css";
import { Platform } from "obsidian";

import { Deck } from "src/data/data-structures/deck/deck";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { DeckStats } from "src/scheduling/flashcard-review-sequencer";
import { CardActions } from "src/ui/card-actions";
import { createDeckTile, readableDeckName } from "src/ui/design/deck-identity";
import DeckInfoComponent from "src/ui/obsidian-ui-components/content-container/card-container/toolbar/deck-info/deck-info";
import BackButtonComponent from "src/ui/obsidian-ui-components/content-container/card-container/toolbar/toolbar-buttons/back-button";
import CardMenuButtonComponent, {
    TypeAnswersToggle,
} from "src/ui/obsidian-ui-components/content-container/card-container/toolbar/toolbar-buttons/card-menu-button";
import EditButtonComponent from "src/ui/obsidian-ui-components/content-container/card-container/toolbar/toolbar-buttons/edit-button";
import ResetButtonComponent from "src/ui/obsidian-ui-components/content-container/card-container/toolbar/toolbar-buttons/reset-button";
import SkipButtonComponent from "src/ui/obsidian-ui-components/content-container/card-container/toolbar/toolbar-buttons/skip-button";
import SpeakButtonComponent from "src/ui/obsidian-ui-components/content-container/card-container/toolbar/toolbar-buttons/speak-button";
import ModalCloseButtonComponent from "src/ui/obsidian-ui-components/content-container/modal-close-button";
import { speechAvailable } from "src/ui/speech";
import EmulatedPlatform from "src/utils/platform-detector";

export default class CardToolbarComponent {
    private toolbar: HTMLDivElement;
    private infoSection: DeckInfoComponent;
    private resetButton: ResetButtonComponent;
    private extendedMenuButton: CardMenuButtonComponent;
    private shortMenuButton: CardMenuButtonComponent;
    private progressFill: HTMLDivElement;
    private counterEl: HTMLDivElement;
    private titleDeckEl: HTMLDivElement;
    private speakHandler: (() => void) | null = null;

    public constructor(
        parentEl: HTMLElement,
        showDeleteButton: boolean,
        deleteCurrentCard: () => void,
        backToDeckHandler: () => Promise<void>,
        editClickHandler: () => void,
        jumpToCurrentCard: () => Promise<void>,
        displayCurrentCardInfoNotice: () => void,
        skipCurrentCard: () => void,
        onOpenResetModalClick: () => void,
        actions: CardActions | null,
        closeModal?: () => void,
    ) {
        // Build ui
        this.toolbar = parentEl.createDiv();
        this.toolbar.addClass("sr-card-toolbar");
        const isModal = closeModal !== undefined;

        new BackButtonComponent(this.toolbar, async () => await backToDeckHandler(), [
            (EmulatedPlatform().isPhone || Platform.isPhone) && isModal
                ? "mod-raised"
                : "clickable-icon",
        ]);

        const centerSpacer = this.toolbar.createDiv();
        centerSpacer.addClass("sr-flex-spacer");
        centerSpacer.addClass("sr-center-spacer");

        this.infoSection = new DeckInfoComponent(this.toolbar);
        // Studio shows the card's deck over a plain "4 / 17" instead of the deck badge
        const title = this.toolbar.createDiv({ cls: "fs-card-title" });
        this.titleDeckEl = title.createDiv({ cls: "fs-card-title-deck" });
        this.counterEl = title.createDiv({ cls: "fs-card-counter" });

        this.toolbar.createDiv().addClass("sr-flex-spacer");

        // Read aloud, on devices that can speak
        if (speechAvailable()) {
            new SpeakButtonComponent(
                this.toolbar,
                () => this.speakHandler?.(),
                EmulatedPlatform().isPhone || Platform.isPhone
                    ? ["mod-raised"]
                    : ["clickable-icon"],
            );
        }

        new EditButtonComponent(
            this.toolbar,
            editClickHandler,
            EmulatedPlatform().isPhone || Platform.isPhone ? ["mod-raised"] : ["clickable-icon"],
        );

        this.resetButton = new ResetButtonComponent(
            this.toolbar,
            onOpenResetModalClick,
            EmulatedPlatform().isPhone || Platform.isPhone ? ["mod-raised"] : ["clickable-icon"],
        );
        this.resetButton.setDisabled(true);

        new SkipButtonComponent(
            this.toolbar,
            () => skipCurrentCard(),
            EmulatedPlatform().isPhone || Platform.isPhone ? ["mod-raised"] : ["clickable-icon"],
        );

        this.toolbar.createDiv("sr-divider");

        this.shortMenuButton = new CardMenuButtonComponent(
            this.toolbar,
            false, // isExtended = false
            showDeleteButton,
            isModal,
            this.resetButton.disabled,
            deleteCurrentCard,
            editClickHandler,
            jumpToCurrentCard,
            displayCurrentCardInfoNotice,
            skipCurrentCard,
            onOpenResetModalClick,
            actions,
            closeModal,
            EmulatedPlatform().isPhone || Platform.isPhone
                ? ["mod-raised", "sr-short-menu-button"]
                : ["clickable-icon", "sr-short-menu-button"],
        );

        this.extendedMenuButton = new CardMenuButtonComponent(
            this.toolbar,
            true, // isExtended = true
            showDeleteButton,
            isModal,
            this.resetButton.disabled,
            deleteCurrentCard,
            editClickHandler,
            jumpToCurrentCard,
            displayCurrentCardInfoNotice,
            skipCurrentCard,
            onOpenResetModalClick,
            actions,
            closeModal,
            EmulatedPlatform().isPhone || Platform.isPhone
                ? ["mod-raised", "sr-extended-menu-button"]
                : ["clickable-icon", "sr-extended-menu-button"],
        );

        // If we don't have a close modal, we don't need the close button
        // A slim bar under the toolbar showing how much of this session is done
        const progress = parentEl.createDiv({ cls: "sr-session-progress" });
        this.progressFill = progress.createDiv({ cls: "sr-session-progress-fill" });

        if (closeModal === undefined) return;

        const closeButtonClasses = [
            EmulatedPlatform().isPhone || Platform.isPhone ? "mod-raised" : "clickable-icon",
        ];

        new ModalCloseButtonComponent(this.toolbar, closeModal, closeButtonClasses);
    }

    /**
     * What the speaker button does when it is pressed.
     */
    public setSpeakHandler(handler: () => void): void {
        this.speakHandler = handler;
    }

    /**
     * Adds the "Type answers" switch for this session to both card menus.
     */
    public setTypeAnswersToggle(toggle: TypeAnswersToggle): void {
        this.extendedMenuButton.typeAnswersToggle = toggle;
        this.shortMenuButton.typeAnswersToggle = toggle;
    }

    /**
     * Colours the session's progress bar by the answers given so far, one segment per answer, oldest first.
     */
    public setSessionAnswers(responses: readonly ReviewResponse[]): void {
        this.progressFill.empty();
        this.progressFill.toggleClass("sr-has-answers", responses.length > 0);
        this.progressFill.toggleClass("sr-many-answers", responses.length > 60);
        for (const response of responses) {
            this.progressFill.createDiv({
                cls: `sr-session-answer sr-session-answer-${ReviewResponse[response].toLowerCase()}`,
            });
        }
    }

    /**
     * Updates the deck info section
     * @param chosenDeck - The chosen deck
     * @param currentDeck - The current deck
     * @param chosenDeckStats - The stats of the chosen deck
     * @param currentDeckStats - The stats of the current deck
     * @param totalCardsInSession - The total number of cards in the session
     * @param totalDecksInSession - The total number of decks in the session
     * @param currentDeckTotalCardsInQueue - The total number of cards in the current deck
     * @param settings - The settings object
     */
    public updateInfo(
        chosenDeck: Deck,
        currentDeck: Deck,
        chosenDeckStats: DeckStats,
        currentDeckStats: DeckStats,
        totalCardsInSession: number,
        totalDecksInSession: number,
        currentDeckTotalCardsInQueue: number,
        flashcardCardOrder: string,
    ) {
        const done = totalCardsInSession - chosenDeckStats.cardsInQueueCount;
        const ratio =
            totalCardsInSession > 0 ? Math.min(1, Math.max(0, done / totalCardsInSession)) : 0;
        this.progressFill.setCssProps({ "--sr-progress": ratio.toFixed(4) });
        this.counterEl.setText(
            totalCardsInSession > 0
                ? `${Math.min(done + 1, totalCardsInSession)} / ${totalCardsInSession}`
                : "",
        );

        const deckPath = currentDeck.getTopicPath().path;
        this.titleDeckEl.empty();
        if (deckPath.length > 0) {
            createDeckTile(this.titleDeckEl, currentDeck.deckName);
            this.titleDeckEl.createSpan({ text: deckPath.map(readableDeckName).join(" – ") });
        }

        this.infoSection.updateInfo(
            chosenDeck.deckName,
            totalCardsInSession,
            totalCardsInSession - chosenDeckStats.cardsInQueueCount,
            totalDecksInSession,
            totalDecksInSession - chosenDeckStats.decksInQueueOfThisDeckCount,
            currentDeck.deckName,
            currentDeckTotalCardsInQueue,
            currentDeckTotalCardsInQueue - currentDeckStats.cardsInQueueOfThisDeckCount,
            flashcardCardOrder === "EveryCardRandomDeckAndCard",
        );
    }

    /**
     * Shows the session as finished: a full progress bar and every card counted as done.
     */
    public markSessionComplete(): void {
        this.progressFill.setCssProps({ "--sr-progress": "1" });
        const total = this.counterEl.getText().split("/")[1]?.trim();
        if (total) this.counterEl.setText(`${total} / ${total}`);
        this.infoSection.markChosenDeckComplete();
    }

    /**
     * Sets the reset button disabled state
     * @param disabled - The disabled state
     */
    public setResetButtonDisabled(disabled: boolean) {
        this.resetButton.buttonEl.toggleClass("mod-disabled", disabled);
        this.extendedMenuButton.setResetButtonDisabled(disabled);
        this.shortMenuButton.setResetButtonDisabled(disabled);
    }
}
