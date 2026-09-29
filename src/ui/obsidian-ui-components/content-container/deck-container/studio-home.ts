import "src/ui/obsidian-ui-components/content-container/deck-container/studio-home.css";
import { setIcon } from "obsidian";

import { Deck } from "src/data/data-structures/deck/deck";
import { t } from "src/lang/helpers";
import { DeckStats, IFlashcardReviewSequencer } from "src/scheduling/flashcard-review-sequencer";

/** A rough answer time used for the "about N min" estimate. */
const SECONDS_PER_CARD = 10;
const MONOGRAM_COLOURS = 7;

function studyMinutes(cards: number): number {
    return Math.max(1, Math.round((cards * SECONDS_PER_CARD) / 60));
}

/**
 * A stable colour for a deck's monogram, so a deck keeps its colour between sessions.
 */
function monogramColour(name: string): number {
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return (hash % MONOGRAM_COLOURS) + 1;
}

function readableDeckName(name: string): string {
    return name.replace(/[-_]+/g, " ").trim();
}

function countLabel(count: number): string {
    return count === 1 ? t("HOME_ONE_CARD") : t("HOME_CARDS", { count });
}

/**
 * The Studio look's deck list: a hero card for today's study and a tile for every deck.
 */
export function renderStudioHome(
    container: HTMLElement,
    reviewSequencer: IFlashcardReviewSequencer,
    startReviewOfDeck: (deck: Deck) => void,
): void {
    container.empty();
    const root: Deck = reviewSequencer.originalDeckTree;
    const rootStats: DeckStats = reviewSequencer.getDeckStats(root.getTopicPath());

    renderHero(container, rootStats, () => startReviewOfDeck(root));

    const decks = container.createDiv({ cls: "sr-home-section" });
    decks.createDiv({ cls: "sr-home-section-title", text: t("HOME_DECKS") });
    const list = decks.createDiv({ cls: "sr-home-deck-list" });
    for (const deck of root.subdecks) {
        renderDeckTile(list, deck, 0, reviewSequencer, startReviewOfDeck);
    }
}

function renderHero(container: HTMLElement, stats: DeckStats, studyNow: () => void): void {
    const toStudy = stats.dueCount + stats.newCount;
    const hero = container.createDiv({ cls: "sr-home-hero" });
    hero.toggleClass("is-done", toStudy === 0);

    const decoration = hero.createDiv({ cls: "sr-home-hero-decoration" });
    setIcon(decoration, toStudy === 0 ? "check-circle-2" : "layers");

    const label = hero.createDiv({ cls: "sr-home-hero-label" });
    setIcon(label.createSpan({ cls: "sr-home-hero-label-icon" }), "sun");
    label.createSpan({ text: t("HOME_TODAY") });

    if (toStudy === 0) {
        hero.createDiv({ cls: "sr-home-hero-number", text: t("HOME_ALL_DONE_TITLE") });
        hero.createDiv({ cls: "sr-home-hero-detail", text: t("HOME_ALL_DONE_DESC") });
        return;
    }

    hero.createDiv({ cls: "sr-home-hero-number", text: countLabel(toStudy) });
    const parts: string[] = [];
    if (stats.newCount > 0) parts.push(t("HOME_NEW_CHIP", { count: stats.newCount }));
    if (stats.dueCount > 0) parts.push(t("HOME_DUE_CHIP", { count: stats.dueCount }));
    parts.push(t("HOME_MINUTES", { minutes: studyMinutes(toStudy) }));
    hero.createDiv({ cls: "sr-home-hero-detail", text: parts.join("  ·  ") });

    const button = hero.createEl("button", { cls: "sr-home-study-now" });
    button.createSpan({ text: t("STUDY_NOW") });
    setIcon(button.createSpan({ cls: "sr-home-study-now-icon" }), "arrow-right");
    button.addEventListener("click", studyNow);
}

function renderDeckTile(
    list: HTMLElement,
    deck: Deck,
    depth: number,
    reviewSequencer: IFlashcardReviewSequencer,
    startReviewOfDeck: (deck: Deck) => void,
): void {
    const stats = reviewSequencer.getDeckStats(deck.getTopicPath());
    const toStudy = stats.dueCount + stats.newCount;
    const seen = Math.max(0, stats.totalCount - stats.newCount);

    const tile = list.createDiv({ cls: "sr-home-deck" });
    tile.setAttribute("data-depth", String(Math.min(depth, 4)));
    tile.toggleClass("is-done", toStudy === 0);

    const monogram = tile.createDiv({
        cls: `sr-home-deck-monogram sr-monogram-${monogramColour(deck.deckName)}`,
        text: readableDeckName(deck.deckName).charAt(0).toUpperCase(),
    });
    monogram.setAttribute("aria-hidden", "true");

    const body = tile.createDiv({ cls: "sr-home-deck-body" });
    body.createDiv({ cls: "sr-home-deck-name", text: readableDeckName(deck.deckName) });
    const meta = body.createDiv({ cls: "sr-home-deck-meta", text: countLabel(stats.totalCount) });
    meta.setAttribute("aria-label", t("TOTAL_CARDS"));
    const progress = body.createDiv({ cls: "sr-home-deck-progress" });
    progress.createDiv({ cls: "sr-home-deck-progress-fill" }).setCssProps({
        "--sr-deck-seen": stats.totalCount > 0 ? (seen / stats.totalCount).toFixed(4) : "0",
    });

    const chips = tile.createDiv({ cls: "sr-home-deck-chips" });
    if (toStudy === 0) {
        const done = chips.createSpan({ cls: "sr-home-chip is-done" });
        setIcon(done.createSpan({ cls: "sr-home-chip-icon" }), "check");
        done.createSpan({ text: t("HOME_DECK_DONE") });
    } else {
        if (stats.dueCount > 0) {
            chips.createSpan({
                cls: "sr-home-chip is-due",
                text: t("HOME_DUE_CHIP", { count: stats.dueCount }),
            });
        }
        if (stats.newCount > 0) {
            chips.createSpan({
                cls: "sr-home-chip is-new",
                text: t("HOME_NEW_CHIP", { count: stats.newCount }),
            });
        }
        setIcon(chips.createSpan({ cls: "sr-home-deck-chevron" }), "chevron-right");
        tile.addClass("is-clickable");
        tile.setAttribute("role", "button");
        tile.setAttribute("tabindex", "0");
        tile.addEventListener("click", () => startReviewOfDeck(deck));
        tile.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                startReviewOfDeck(deck);
            }
        });
    }

    for (const subdeck of deck.subdecks) {
        renderDeckTile(list, subdeck, depth + 1, reviewSequencer, startReviewOfDeck);
    }
}
