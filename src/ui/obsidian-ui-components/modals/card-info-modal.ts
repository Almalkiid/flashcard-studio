import "src/ui/obsidian-ui-components/modals/card-info-modal.css";
import { App, Modal, setIcon } from "obsidian";

import { Card } from "src/data/data-structures/card/card";
import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { IBaseLocale } from "src/lang/base-locale";
import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";
import { occlusionCardText } from "src/occlusion/occlusion-view";
import { retrievability } from "src/stats/cards";
import { StatsCard } from "src/stats/types";
import {
    formatCompactNumber,
    formatDate,
    formatDateTimeShort,
    formatDayLong,
    formatPercent,
} from "src/ui/statistics-view/format";
import { currentDayKeyFn, toStatsCard } from "src/ui/statistics-view/stats-data";
import { formatAnswerTime, formatIntervalCompact } from "src/utils/format-interval";

export const STATE_KEYS: Record<StatsCard["state"], keyof IBaseLocale> = {
    new: "FSRS_STATE_NEW",
    learning: "FSRS_STATE_LEARNING",
    review: "FSRS_STATE_REVIEW",
    relearning: "FSRS_STATE_RELEARNING",
};

const RATING_KEYS: (keyof IBaseLocale)[] = [
    "CARD_INFO_MANUAL",
    "STATS_RATING_AGAIN",
    "STATS_RATING_HARD",
    "STATS_RATING_GOOD",
    "STATS_RATING_EASY",
];

const KIND_KEYS: (keyof IBaseLocale)[] = [
    "STATS_KIND_LEARN",
    "STATS_KIND_REVIEW",
    "STATS_KIND_RELEARN",
    "STATS_KIND_CRAM",
    "CARD_INFO_MANUAL",
];

const FRONT_PREVIEW_LENGTH = 140;

/**
 * Everything known about one card: where it stands now, and every time it was answered.
 */
export class CardInfoModal extends Modal {
    private readonly plugin: SRPlugin;
    private readonly card: Card;
    private readonly notePath: string;
    private readonly onClosed: (() => void) | undefined;

    /**
     * @param onClosed - Called once the modal is gone, e.g. to give keyboard focus back to the review screen.
     */
    constructor(app: App, plugin: SRPlugin, card: Card, notePath: string, onClosed?: () => void) {
        super(app);
        this.plugin = plugin;
        this.card = card;
        this.notePath = notePath;
        this.onClosed = onClosed;
        this.modalEl.addClass("sr-card-info-modal", "fs-studio");
        this.contentEl.addClass("sr-card-info");
        this.setTitle(t("CARD_INFO_TITLE"));
    }

    onOpen(): void {
        const dayKeyOf = currentDayKeyFn();
        const decks = this.card.question.topicPathList.list.map((path) => path.path.join("/"));
        const stats = toStatsCard(this.card, decks, dayKeyOf(Date.now()));

        this.renderFront();
        this.renderBadges(stats);
        this.renderState(stats);
        this.renderNoteLink();
        void this.renderHistory(stats);
    }

    onClose(): void {
        this.contentEl.empty();
        this.onClosed?.();
    }

    private renderFront(): void {
        // The card text is markdown; a preview reads better without its emphasis marks. An image occlusion card's
        // text is a block of data: it is shown as its question and the label of its mask
        const text =
            occlusionCardText(this.card.front) ??
            this.card.front
                .replace(/(\*\*|__|==|~~|`)/g, "")
                .replace(/\s+/g, " ")
                .trim();
        if (text === "") return;
        const preview =
            text.length > FRONT_PREVIEW_LENGTH ? text.slice(0, FRONT_PREVIEW_LENGTH) + "…" : text;
        this.contentEl.createDiv({ cls: "sr-card-info-front fs-card", text: preview });
    }

    private renderBadges(stats: StatsCard): void {
        const badges: { text: string; cls: string }[] = [];
        if (stats.suspended) badges.push({ text: t("CARD_INFO_SUSPENDED"), cls: "is-suspended" });
        if (stats.buried && this.card.meta.buryUntil) {
            badges.push({
                text: t("CARD_INFO_BURIED", { date: formatDayLong(this.card.meta.buryUntil) }),
                cls: "is-buried",
            });
        }
        if (stats.leech) badges.push({ text: t("CARD_INFO_LEECH"), cls: "is-leech" });
        if (badges.length === 0) return;

        const row = this.contentEl.createDiv({ cls: "sr-card-info-badges" });
        for (const badge of badges) {
            row.createSpan({ cls: `sr-card-info-badge ${badge.cls}`, text: badge.text });
        }
    }

    private renderState(stats: StatsCard): void {
        const items: { label: string; value: string; key: string }[] = [
            { label: t("CARD_INFO_STATE"), value: t(STATE_KEYS[stats.state]), key: "state" },
        ];

        if (stats.state === "new") {
            this.contentEl.createDiv({ cls: "sr-card-info-hint", text: t("CARD_INFO_NEW_CARD") });
        } else {
            if (stats.dueMs !== null) {
                items.push({
                    label: t("CARD_INFO_DUE"),
                    value: this.formatDue(stats.dueMs),
                    key: "due",
                });
            }
            items.push({
                label: t("CARD_INFO_INTERVAL"),
                // A card in a learning step has no interval in days yet
                value: stats.intervalDays > 0 ? formatIntervalCompact(stats.intervalDays) : "-",
                key: "interval",
            });
            if (stats.isFsrs) {
                items.push(
                    {
                        label: t("CARD_INFO_STABILITY"),
                        value: `${formatCompactNumber(stats.stability)}d`,
                        key: "stability",
                    },
                    {
                        label: t("CARD_INFO_DIFFICULTY"),
                        value: `${formatCompactNumber(stats.difficulty)} / 10`,
                        key: "difficulty",
                    },
                    {
                        label: t("CARD_INFO_RETRIEVABILITY"),
                        value: formatPercent(retrievability(stats, Date.now())),
                        key: "retrievability",
                    },
                    { label: t("CARD_INFO_REVIEWS"), value: String(stats.reps), key: "reps" },
                    { label: t("CARD_INFO_LAPSES"), value: String(stats.lapses), key: "lapses" },
                );
            } else if (this.card.scheduleInfo !== null) {
                items.push({
                    label: t("CARD_INFO_EASE"),
                    value: String(this.card.scheduleInfo.latestEase),
                    key: "ease",
                });
            }
        }

        const grid = this.contentEl.createDiv({ cls: "sr-card-info-grid fs-card" });
        for (const item of items) {
            const cell = grid.createDiv({ cls: "sr-card-info-item" });
            cell.createDiv({ cls: "sr-card-info-label", text: item.label });
            const value = cell.createDiv({
                cls: "sr-card-info-value",
                text: item.value,
                attr: { "data-field": item.key },
            });
            // The state reads as a coloured pill, like the rest of the Studio screens
            if (item.key === "state") value.addClass("fs-pill", `is-${stats.state}`);
        }

        if (stats.flag > 0) {
            const cell = grid.createDiv({ cls: "sr-card-info-item" });
            cell.createDiv({ cls: "sr-card-info-label", text: t("CARD_INFO_FLAG") });
            const value = cell.createDiv({ cls: "sr-card-info-value" });
            value.createSpan({ cls: `sr-card-info-flag sr-card-info-flag-${stats.flag}` });
            value.createSpan({ text: t(`FLAG_${stats.flag}` as "FLAG_1") });
        }
    }

    private formatDue(dueMs: number): string {
        const days = (dueMs - Date.now()) / (24 * 3600 * 1000);
        const date = formatDate(dueMs);
        return days >= 0
            ? t("CARD_INFO_DUE_IN", { date, interval: formatIntervalCompact(days) })
            : t("CARD_INFO_DUE_AGO", { date, interval: formatIntervalCompact(-days) });
    }

    private renderNoteLink(): void {
        const row = this.contentEl.createDiv({ cls: "sr-card-info-note fs-card" });
        setIcon(
            row.createSpan({ cls: "sr-card-info-note-icon fs-icon-tile fs-tone-blue" }),
            "file-text",
        );
        row.createEl("a", {
            cls: "sr-card-info-note-link",
            text: this.notePath,
            attr: { href: "#", "aria-label": t("CARD_INFO_OPEN_NOTE") },
        });
        setIcon(row.createSpan({ cls: "sr-card-info-note-chevron" }), "chevron-right");
        // The whole row opens the note, the link inside it included
        row.addEventListener("click", (event: MouseEvent) => {
            event.preventDefault();
            this.close();
            void this.app.workspace.openLinkText(this.notePath, "", false);
        });
    }

    private async renderHistory(stats: StatsCard): Promise<void> {
        const section = this.contentEl.createDiv({ cls: "sr-card-info-history" });
        const heading = section.createEl("h4", { cls: "sr-card-info-history-title" });
        heading.createSpan({ text: t("CARD_INFO_HISTORY") });
        const count = heading.createSpan({ cls: "sr-card-info-history-count fs-pill" });

        // A card that has never been written to the note has no id, so it cannot have any history
        if (stats.id === null) {
            section.createDiv({ cls: "sr-card-info-hint", text: t("CARD_INFO_NO_HISTORY") });
            return;
        }

        let entries: ReviewLogEntry[] = [];
        try {
            entries = (await this.plugin.dataManager.reviewLog.readAll()).filter(
                (entry) => entry.c === stats.id,
            );
        } catch (error) {
            console.error("Flashcard Studio: could not read the review history", error);
        }
        if (entries.length === 0) {
            section.createDiv({ cls: "sr-card-info-hint", text: t("CARD_INFO_NO_HISTORY") });
            return;
        }
        count.setText(String(entries.length));

        const scroller = section.createDiv({ cls: "sr-card-info-history-scroll fs-card" });
        const table = scroller.createEl("table", { cls: "sr-card-info-table" });
        const headRow = table.createEl("thead").createEl("tr");
        for (const key of [
            "CARD_INFO_COL_DATE",
            "CARD_INFO_COL_RATING",
            "CARD_INFO_COL_TYPE",
            "CARD_INFO_COL_INTERVAL",
            "CARD_INFO_COL_TIME",
        ] as const) {
            headRow.createEl("th", { text: t(key) });
        }

        const body = table.createEl("tbody");
        for (const entry of [...entries].reverse()) {
            const row = body.createEl("tr", { attr: { "data-rating": entry.r } });
            row.createEl("td", { text: formatDateTimeShort(entry.t), cls: "sr-card-info-date" });
            row.createEl("td", { cls: "sr-card-info-rating" }).createSpan({
                cls: `sr-card-info-rating-pill sr-rating-${entry.r}`,
                text: t(RATING_KEYS[entry.r]),
            });
            row.createEl("td", { text: t(KIND_KEYS[entry.k]) });
            // A cram answer does not reschedule the card, and a reset has no interval to speak of
            row.createEl("td", {
                text: entry.k === 3 || entry.r === 0 ? "-" : formatIntervalCompact(entry.ivl),
            });
            row.createEl("td", { text: entry.r === 0 ? "-" : formatAnswerTime(entry.ms) });
        }
    }
}
