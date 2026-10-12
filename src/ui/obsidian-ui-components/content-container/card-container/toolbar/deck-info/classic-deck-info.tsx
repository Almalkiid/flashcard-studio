import "src/ui/obsidian-ui-components/content-container/card-container/toolbar/deck-info/classic-deck-info.css";
import { setIcon } from "obsidian";

const HIDDEN = "fs-is-hidden";

/** "done/total" with a small icon: how many cards or decks of the session are behind you. */
class CounterComponent {
    private readonly wrapper: HTMLDivElement;
    private readonly counter: HTMLDivElement;

    constructor(parent: HTMLElement, icon: string) {
        this.wrapper = parent.createDiv({ cls: "fs-counter-wrapper" });
        this.counter = this.wrapper.createDiv({ cls: "fs-counter" });
        setIcon(this.wrapper.createDiv({ cls: "fs-counter-icon" }), icon);
    }

    public setProgress(done: number, total: number): void {
        this.counter.setText(`${done}/${total}`);
    }

    public setHidden(hidden: boolean): void {
        this.wrapper.toggleClass(HIDDEN, hidden);
    }
}

/**
 * The Classic look's deck badges in the card toolbar: the deck chosen to review with its card and deck counts, and, when
 * the card comes from another deck, a second badge for that one. (The Studio look hides all of this.)
 */
export default class DeckInfoComponent {
    private readonly chosenName: HTMLDivElement;
    private readonly chosenDivider: HTMLDivElement;
    private readonly chosenCards: CounterComponent;
    private readonly chosenDecks: CounterComponent;
    private readonly pointer: HTMLDivElement;
    private readonly currentPill: HTMLDivElement;
    private readonly currentName: HTMLDivElement;
    private readonly currentDivider: HTMLDivElement;
    private readonly currentCards: CounterComponent;
    private totalCardsInChosenDeck = 0;

    constructor(parentEl: HTMLElement) {
        const section = parentEl.createDiv({ cls: "fs-info-section" });

        const chosen = section.createDiv({ cls: "fs-deck-info fs-bg-blue fs-chosen-deck-info" });
        this.chosenName = chosen.createDiv({ cls: "fs-deck-name" });
        this.chosenDivider = chosen.createDiv({ cls: "fs-divider" });
        this.chosenCards = new CounterComponent(chosen, "credit-card");
        this.chosenDecks = new CounterComponent(chosen, "layers");

        this.pointer = section.createDiv({ cls: "fs-deck-pointer" });
        setIcon(this.pointer, "chevron-right");

        this.currentPill = section.createDiv({
            cls: "fs-deck-info fs-bg-blue fs-current-deck-info",
        });
        this.currentName = this.currentPill.createDiv({ cls: "fs-deck-name" });
        this.currentDivider = this.currentPill.createDiv({ cls: "fs-divider" });
        this.currentCards = new CounterComponent(this.currentPill, "credit-card");
    }

    /** Shows every card of the chosen deck as done, when the session has ended. */
    public markChosenDeckComplete(): void {
        this.chosenCards.setProgress(this.totalCardsInChosenDeck, this.totalCardsInChosenDeck);
    }

    public updateInfo(
        chosenName: string,
        totalCards: number,
        doneCards: number,
        totalDecks: number,
        doneDecks: number,
        currentName: string,
        currentTotal: number,
        currentDone: number,
        isTotallyRandom: boolean,
        sameDeck: boolean,
    ): void {
        this.totalCardsInChosenDeck = totalCards;
        this.chosenName.setText(chosenName);
        this.chosenCards.setProgress(doneCards, totalCards);
        this.chosenDecks.setProgress(doneDecks, totalDecks);
        this.chosenDecks.setHidden(totalDecks <= 1);

        // The second badge says where the card comes from, so it is only there when that is another deck
        const single = sameDeck || totalDecks <= 1;
        this.pointer.toggleClass(HIDDEN, single);
        this.currentPill.toggleClass(HIDDEN, single);
        // With two badges the first one shows only its counters
        this.chosenName.toggleClass(HIDDEN, !single);
        this.chosenDivider.toggleClass(HIDDEN, !single);

        this.currentName.setText(currentName);
        this.currentCards.setProgress(currentDone, currentTotal);
        // A fully random order jumps between decks, so counting one of them means nothing
        this.currentCards.setHidden(isTotallyRandom);
        this.currentDivider.toggleClass(HIDDEN, isTotallyRandom);
    }
}
