import { t } from "src/lang/helpers";
import {
    CardInfoData,
    SessionCounts,
} from "src/ui/obsidian-ui-components/content-container/desktop/desktop-data";
import { STATE_KEYS } from "src/ui/obsidian-ui-components/modals/card-info-modal";
import { formatCompactNumber, formatPercent } from "src/ui/statistics-view/format";
import { formatAnswerTime } from "src/utils/format-interval";

const DAY_MS = 24 * 3600 * 1000;

/** The rating classes of the last answers, by log rating 1 to 4. */
const RATING_CLASS = ["", "again", "hard", "good", "easy"];

export interface StudyPanelData {
    /** The card being studied; null between cards, or when the session is over. */
    card: CardInfoData | null;
    session: SessionCounts & { elapsedMs: number; left: number };
    /** The keyboard shortcuts as [key, what it does] pairs; none hides the block. */
    keys: [string, string][];
}

/** `Today`, `Yesterday`, `6 days ago`. */
function lastSeenText(lastSeenMs: number | null, nowMs: number): string {
    if (lastSeenMs === null) return "–";
    const days = Math.floor(Math.max(0, nowMs - lastSeenMs) / DAY_MS);
    if (days === 0) return t("HOME_TODAY");
    if (days === 1) return t("DESKTOP_LAST_SEEN_YESTERDAY");
    return t("DESKTOP_LAST_SEEN_DAYS", { count: days });
}

function cardsText(count: number): string {
    return count === 1 ? t("HOME_ONE_CARD") : t("HOME_CARDS", { count });
}

/** About how long the cards left take: ten seconds each, as the home estimates. */
function minutesLeft(left: number): number {
    return Math.max(1, Math.round((left * 10) / 60));
}

/**
 * The panel beside the card while studying: what is known about this card, how the session is going and the keys.
 * Redrawn after each card is shown and after each answer.
 */
export function renderStudySidePanel(el: HTMLElement, data: StudyPanelData): void {
    el.empty();

    if (data.card !== null) {
        const card = el.createDiv({ cls: "fs-card fs-panel-block fs-panel-card" });
        card.createDiv({ cls: "fs-panel-title", text: t("DESKTOP_PANEL_THIS_CARD") });
        const rows = card.createDiv({ cls: "fs-panel-rows" });
        row(rows, t("CARD_INFO_STATE"), t(STATE_KEYS[data.card.state]));
        row(rows, t("DESKTOP_PANEL_LAST_SEEN"), lastSeenText(data.card.lastSeenMs, Date.now()));
        if (data.card.stabilityDays !== null) {
            row(rows, t("CARD_INFO_STABILITY"), `${formatCompactNumber(data.card.stabilityDays)}d`);
        }
        if (data.card.recall !== null) {
            row(rows, t("DESKTOP_PANEL_RECALL"), formatPercent(data.card.recall));
        }
        row(rows, t("CARD_INFO_LAPSES"), String(data.card.lapses));
        if (data.card.lastAnswers.length > 0) {
            const history = card.createDiv({ cls: "fs-panel-history" });
            for (const rating of data.card.lastAnswers) {
                history.createSpan({ cls: `fs-panel-dot is-${RATING_CLASS[rating]}` });
            }
        }
    }

    const session = el.createDiv({ cls: "fs-card fs-panel-block fs-panel-session" });
    session.createDiv({ cls: "fs-panel-title", text: t("DESKTOP_PANEL_THIS_SESSION") });
    const tiles = session.createDiv({ cls: "fs-panel-tiles" });
    const tile = (kind: string, label: string, count: number) => {
        const cell = tiles.createDiv({ cls: `fs-panel-tile is-${kind}` });
        cell.createEl("b", { text: String(count) });
        cell.createSpan({ text: label });
    };
    tile("again", t("STATS_RATING_AGAIN"), data.session.again);
    tile("hard", t("STATS_RATING_HARD"), data.session.hard);
    tile("good", t("STATS_RATING_GOOD"), data.session.good);
    tile("easy", t("STATS_RATING_EASY"), data.session.easy);
    const rows = session.createDiv({ cls: "fs-panel-rows" });
    const time = row(rows, t("SESSION_TIME"), formatAnswerTime(data.session.elapsedMs));
    time.addClass("fs-panel-elapsed");
    if (data.session.left > 0) {
        row(
            rows,
            t("DESKTOP_PANEL_LEFT"),
            t("DESKTOP_PANEL_LEFT_VALUE", {
                cards: cardsText(data.session.left),
                minutes: t("HOME_MINUTES", { minutes: minutesLeft(data.session.left) }),
            }),
        );
    }

    if (data.keys.length > 0) {
        const keys = el.createDiv({ cls: "fs-card fs-panel-block fs-panel-keys" });
        keys.createDiv({ cls: "fs-panel-title", text: t("DESKTOP_PANEL_KEYS") });
        const list = keys.createDiv({ cls: "fs-panel-key-list" });
        for (const [key, what] of data.keys) {
            list.createSpan({ cls: "fs-kbd", text: key });
            list.createSpan({ text: what });
        }
    }
}

/** One label and value line. Returns the value, so it can be updated. */
function row(parent: HTMLElement, label: string, value: string): HTMLElement {
    parent.createSpan({ text: label });
    return parent.createSpan({ text: value });
}

/** Updates the session time in a drawn panel, so the time keeps running between cards. */
export function updateStudyPanelTime(el: HTMLElement, elapsedMs: number): void {
    el.querySelector(".fs-panel-elapsed")?.setText(formatAnswerTime(elapsedMs));
}
