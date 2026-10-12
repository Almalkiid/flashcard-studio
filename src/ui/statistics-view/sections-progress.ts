import { t } from "src/lang/translate";
import { DeckProgress } from "src/stats/progress";
import { createDeckTile, readableDeckName } from "src/ui/design/deck-identity";
import { createCard, createNote } from "src/ui/statistics-view/dom";
import { formatCount, formatPercent } from "src/ui/statistics-view/format";

function deckName(deck: string): string {
    return deck === "" ? t("STATS_ALL_DECKS") : readableDeckName(deck.split("/").pop() ?? deck);
}

function share(part: number, total: number): number {
    return total === 0 ? 0 : part / total;
}

/**
 * How much of the chosen decks is mastered and how much has been studied: one row per subdeck, or the deck itself when
 * it has none. Choosing a row opens that subdeck, so a person can go from all decks down to one unit.
 */
export function renderProgress(
    parent: HTMLElement,
    progress: { scope: DeckProgress; rows: DeckProgress[] },
    onChooseDeck: (deck: string) => void,
): void {
    const { scope } = progress;
    const parts = createCard(parent, t("STATS_PROGRESS_TITLE"), {
        wide: true,
        section: "progress",
        summary: t("STATS_PROGRESS_SUMMARY", {
            deck: deckName(scope.deck),
            mastered: formatPercent(share(scope.mastered, scope.total)),
            seen: formatPercent(share(scope.seen, scope.total)),
            count: formatCount(scope.total),
        }),
    });
    if (scope.total === 0) {
        createNote(parts.body, t("STATS_PROGRESS_EMPTY"));
        return;
    }

    const list = parts.body.createDiv({ cls: "fs-stats-progress-list" });
    const rows = progress.rows.length > 0 ? progress.rows : [scope];
    for (const row of rows) {
        const opens = row.deck !== scope.deck;
        const el = list.createDiv({
            cls: "fs-stats-progress-row",
            attr: { "data-deck": row.deck },
        });
        createDeckTile(el, row.deck.split("/").pop() ?? row.deck);

        const main = el.createDiv({ cls: "fs-stats-progress-main" });
        const head = main.createDiv({ cls: "fs-stats-progress-head" });
        head.createSpan({ cls: "fs-stats-progress-name", text: deckName(row.deck) });
        head.createSpan({
            cls: "fs-stats-progress-rate",
            text: formatPercent(share(row.mastered, row.total)),
        });

        // Mastered, then studied but not yet mastered; the rest of the track is the cards not started
        const bar = main.createDiv({ cls: "fs-stats-progress-bar" });
        bar.createDiv({ cls: "fs-stats-progress-mastered" }).setCssProps({
            "--fs-progress-share": share(row.mastered, row.total).toFixed(4),
        });
        bar.createDiv({ cls: "fs-stats-progress-seen" }).setCssProps({
            "--fs-progress-share": share(row.seen - row.mastered, row.total).toFixed(4),
        });

        main.createDiv({
            cls: "fs-stats-progress-details",
            text: t("STATS_PROGRESS_DETAILS", {
                mastered: formatCount(row.mastered),
                seen: formatCount(row.seen),
                total: formatCount(row.total),
            }),
        });

        if (opens) {
            el.addClass("is-clickable");
            el.setAttribute("role", "button");
            el.setAttribute("tabindex", "0");
            el.setAttribute("aria-label", t("STATS_PROGRESS_OPEN", { deck: deckName(row.deck) }));
            el.addEventListener("click", () => onChooseDeck(row.deck));
            el.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onChooseDeck(row.deck);
                }
            });
        }
    }

    const legend = parts.body.createDiv({ cls: "fs-stats-progress-legend" });
    for (const [cls, label] of [
        ["is-mastered", t("STATS_PROGRESS_MASTERED")],
        ["is-seen", t("STATS_PROGRESS_SEEN")],
        ["is-new", t("STATS_PROGRESS_NOT_STARTED")],
    ]) {
        const item = legend.createSpan({ cls: `fs-stats-progress-key ${cls}` });
        item.createSpan({ cls: "fs-stats-progress-swatch" });
        item.createSpan({ text: label });
    }
}
