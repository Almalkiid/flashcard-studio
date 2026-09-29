import "src/ui/obsidian-ui-components/content-container/deck-container/deck-container.css";
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- h is the JSX factory, only referenced by compiled JSX
import h from "vhtml";

import { Deck } from "src/data/data-structures/deck/deck";
import { SRSettings } from "src/data/settings";
import {
    FlashcardReviewMode,
    IFlashcardReviewSequencer as IFlashcardReviewSequencer,
} from "src/scheduling/flashcard-review-sequencer";
import DeckListComponent from "src/ui/obsidian-ui-components/content-container/deck-container/deck-list";
import DeckListHeaderComponent from "src/ui/obsidian-ui-components/content-container/deck-container/deck-list-header";

export class DeckContainer {
    private containerEl: HTMLDivElement;
    private deckList: DeckListComponent;
    private deckListHeader: DeckListHeaderComponent;

    constructor(
        parentEl: HTMLElement,
        changeReviewMode: (reviewMode: FlashcardReviewMode) => void,
        startReviewOfDeck: (deck: Deck) => void,
        closeModal?: () => void,
        openCustomStudy?: () => void,
    ) {
        // Build ui
        this.containerEl = parentEl.createDiv();
        this.containerEl.addClasses(["sr-container", "sr-deck-container", "sr-is-hidden"]);

        this.deckListHeader = new DeckListHeaderComponent(
            this.containerEl,
            changeReviewMode,
            closeModal,
            openCustomStudy,
        );

        this.deckList = new DeckListComponent(this.containerEl, startReviewOfDeck);
    }

    /**
     * Shows the DeckListView & rerenders dynamic elements
     */
    showList(
        reviewSequencer: IFlashcardReviewSequencer,
        settings: SRSettings,
        reviewMode: FlashcardReviewMode,
        customStudyActive: boolean = false,
    ) {
        // Redraw in case the stats have changed
        this.deckListHeader.updateReviewMode(reviewMode);
        this.deckListHeader.setCustomStudyActive(customStudyActive);

        this.deckList.redraw(reviewSequencer, settings);

        if (this.containerEl.hasClass("sr-is-hidden")) {
            this.containerEl.removeClass("sr-is-hidden");
        }
    }

    /**
     * Hides the DeckListView
     */
    closeList() {
        if (!this.containerEl.hasClass("sr-is-hidden")) {
            this.containerEl.addClass("sr-is-hidden");
        }
    }

    redrawWithNewData(reviewSequencer: IFlashcardReviewSequencer, settings: SRSettings) {
        this.deckList.redraw(reviewSequencer, settings);
    }
}
