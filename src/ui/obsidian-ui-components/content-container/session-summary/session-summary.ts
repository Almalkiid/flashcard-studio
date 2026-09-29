import "src/ui/obsidian-ui-components/content-container/session-summary/session-summary.css";
import { setIcon } from "obsidian";

import { t } from "src/lang/helpers";
import { SessionSummary } from "src/stats/session";
import { formatCount, formatDuration, formatPercent } from "src/ui/statistics-view/format";

export interface SessionSummaryActions {
    onBackToDecks: () => void;
    onOpenStatistics: () => void;
    /** Takes back the last answer, which the answer toast would offer but cannot on this screen. */
    onUndo: () => void;
}

function createTile(parent: HTMLElement, label: string, value: string, key: string): void {
    const tile = parent.createDiv({ cls: "sr-session-summary-tile" });
    tile.createDiv({
        cls: "sr-session-summary-value",
        text: value,
        attr: { "data-stat": key },
    });
    tile.createDiv({ cls: "sr-session-summary-label", text: label });
}

/**
 * The panel shown when a review session ends: a check mark, what was done, the streak, and where to go next.
 *
 * @returns The panel, so the caller can remove it again.
 */
export function renderSessionSummary(
    parent: HTMLElement,
    summary: SessionSummary,
    actions: SessionSummaryActions,
): HTMLElement {
    const panel = parent.createDiv({ cls: "sr-session-summary" });

    const badge = panel.createDiv({ cls: "sr-session-summary-badge" });
    setIcon(badge, "check");
    panel.createEl("h2", { cls: "sr-session-summary-title", text: t("SESSION_COMPLETE") });
    panel.createDiv({ cls: "sr-session-summary-subtitle", text: t("SESSION_SUBTITLE") });

    const tiles = panel.createDiv({ cls: "sr-session-summary-tiles" });
    createTile(tiles, t("SESSION_CARDS"), formatCount(summary.reviews), "cards");
    createTile(tiles, t("SESSION_TIME"), formatDuration(summary.timeMs), "time");
    createTile(tiles, t("SESSION_AGAIN"), formatCount(summary.again), "again");
    createTile(tiles, t("SESSION_RETENTION"), formatPercent(summary.retention), "retention");

    if (summary.streak > 0) {
        const streak = panel.createDiv({ cls: "sr-session-summary-streak" });
        setIcon(streak.createSpan({ cls: "sr-session-summary-streak-icon" }), "flame");
        streak.createSpan({
            cls: "sr-session-summary-streak-text",
            text: `${formatCount(summary.streak)} ${t("SESSION_STREAK")}`,
            attr: { "data-stat": "streak" },
        });
    }

    const buttons = panel.createDiv({ cls: "sr-session-summary-actions" });
    const back = buttons.createEl("button", {
        cls: "mod-cta sr-session-summary-back",
        text: t("SESSION_BACK_TO_DECKS"),
        attr: { type: "button" },
    });
    back.addEventListener("click", actions.onBackToDecks);
    const stats = buttons.createEl("button", {
        cls: "sr-session-summary-stats",
        text: t("OPEN_STATISTICS"),
        attr: { type: "button" },
    });
    stats.addEventListener("click", actions.onOpenStatistics);

    const undo = panel.createEl("button", {
        cls: "sr-session-summary-undo",
        text: t("UNDO_LAST_ANSWER"),
        attr: { type: "button" },
    });
    undo.addEventListener("click", actions.onUndo);

    return panel;
}
