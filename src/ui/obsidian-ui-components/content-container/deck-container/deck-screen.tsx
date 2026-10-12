import "src/ui/obsidian-ui-components/content-container/deck-container/deck-studio.css";

import { Deck } from "src/data/decks/deck";
import { StudioSettings } from "src/data/settings-model";
import { FlashcardReviewMode, IReviewSession } from "src/scheduling/review/review-session";
import DeckListHeaderComponent from "src/ui/obsidian-ui-components/content-container/deck-container/deck-header";
import DeckListComponent, {
    HomeServices,
} from "src/ui/obsidian-ui-components/content-container/deck-container/deck-list";

/** The deck screen: a header with the review mode and the list of decks (or, in the Studio look, the home). */
export default class DeckContainer {
    private readonly containerEl: HTMLDivElement;
    private readonly deckListHeader: DeckListHeaderComponent;
    private readonly deckList: DeckListComponent;

    constructor(
        parentEl: HTMLElement,
        changeReviewMode: (mode: FlashcardReviewMode) => void,
        startReviewOfDeck: (deck: Deck) => void,
        closeModal?: () => void,
        openCustomStudy?: () => void,
        homeServices: HomeServices | null = null,
    ) {
        const root = parentEl.createDiv({ cls: "fs-container fs-deck-container fs-is-hidden" });
        this.containerEl = root;
        // In the desktop shell the sidebar and the home replace the header with its mode and filter buttons
        if (homeServices?.desktop) root.addClass("fs-desktop-decks");
        this.deckListHeader = new DeckListHeaderComponent(
            root,
            changeReviewMode,
            closeModal,
            openCustomStudy,
        );
        this.deckList = new DeckListComponent(root, startReviewOfDeck, homeServices);
    }

    public showList(
        reviewSession: IReviewSession,
        settings: StudioSettings,
        reviewMode: FlashcardReviewMode,
        customStudyActive: boolean = false,
    ): void {
        const root = this.containerEl;
        const studioLook = settings.reviewLook !== "classic";
        for (const cls of ["fs-look-studio", "fs-studio"]) root.toggleClass(cls, studioLook);

        this.deckListHeader.updateReviewMode(reviewMode);
        this.deckListHeader.setCustomStudyActive(customStudyActive);
        this.deckList.redraw(reviewSession, settings);
        root.removeClass("fs-is-hidden");
    }

    public closeList(): void {
        this.containerEl.classList.add("fs-is-hidden");
    }
}
