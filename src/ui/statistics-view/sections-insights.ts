import { t } from "src/lang/helpers";
import { WeakAreas } from "src/stats/weak-areas";
import { createDeckTile, readableDeckName } from "src/ui/design/deck-identity";
import { createCard, createNote } from "src/ui/statistics-view/dom";
import { formatCount, formatPercent } from "src/ui/statistics-view/format";

/** How many decks the card lists. */
const MAX_DECKS = 8;

/** Below the target by more than this, a deck shows in red rather than orange. */
const FAR_BELOW_TARGET = 0.1;

function deckLabel(deck: string): string {
    return deck === "" ? t("STATS_ALL_DECKS") : deck.split("/").map(readableDeckName).join(" › ");
}

/**
 * Where recall is weakest: each deck's retention over the last 30 days against the target, the weakest first, with
 * the cards that keep being missed.
 */
export function renderWeakAreas(
    parent: HTMLElement,
    weak: WeakAreas,
    targetRetention: number,
): void {
    const parts = createCard(parent, t("STATS_WEAK_AREAS_TITLE"), {
        wide: true,
        section: "weak-areas",
        summary: t("STATS_WEAK_AREAS_NOTE", { target: formatPercent(targetRetention) }),
    });
    if (weak.decks.length === 0) {
        createNote(parts.body, t("STATS_WEAK_AREAS_EMPTY"));
        return;
    }

    // A root that every deck shares, such as the flashcards tag, says nothing, so it is left out of the names
    const root = weak.decks[0].deck.split("/")[0] + "/";
    const shared = weak.decks.every((deck) => deck.deck.startsWith(root)) ? root.length : 0;

    const list = parts.body.createDiv({ cls: "sr-stats-weak-list" });
    for (const deck of weak.decks.slice(0, MAX_DECKS)) {
        const row = list.createDiv({ cls: "sr-stats-weak-row", attr: { "data-deck": deck.deck } });
        if (deck.retention < targetRetention - FAR_BELOW_TARGET) row.addClass("is-far-below");
        else if (deck.retention < targetRetention) row.addClass("is-below");

        createDeckTile(row, deck.deck.split("/").pop() ?? deck.deck);
        const main = row.createDiv({ cls: "sr-stats-weak-main" });
        const head = main.createDiv({ cls: "sr-stats-weak-head" });
        head.createSpan({ cls: "sr-stats-weak-name", text: deckLabel(deck.deck.slice(shared)) });
        head.createSpan({ cls: "sr-stats-weak-rate", text: formatPercent(deck.retention) });

        const bar = main.createDiv({ cls: "sr-stats-weak-bar" });
        bar.createDiv({ cls: "sr-stats-weak-fill" }).setCssProps({
            "--sr-weak-rate": deck.retention.toFixed(4),
        });
        bar.createDiv({ cls: "sr-stats-weak-target" }).setCssProps({
            "--sr-weak-target": targetRetention.toFixed(4),
        });

        const details = [t("STATS_WEAK_REVIEWS", { count: formatCount(deck.reviews) })];
        if (deck.due > 0) details.push(t("STATS_WEAK_DUE", { count: formatCount(deck.due) }));
        if (deck.slipping > 0) {
            details.push(t("STATS_WEAK_SLIPPING", { count: formatCount(deck.slipping) }));
        }
        main.createDiv({ cls: "sr-stats-weak-details", text: details.join(" · ") });
    }

    const totals: string[] = [];
    if (weak.slipping > 0) {
        totals.push(t("STATS_WEAK_TOTAL_SLIPPING", { count: formatCount(weak.slipping) }));
    }
    if (weak.leeches > 0)
        totals.push(t("STATS_WEAK_LEECHES", { count: formatCount(weak.leeches) }));
    if (totals.length > 0) createNote(parts.body, totals.join(" · "));
}
