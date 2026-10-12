import { setIcon } from "obsidian";

import { t } from "src/lang/translate";
import { AnswerGroup, RetentionCell, RetentionRow, RetentionRowId } from "src/stats/answers";
import { StatsReport } from "src/stats/report";
import { createCard, createLegend, createNote } from "src/ui/statistics-view/dom";
import { formatCount, formatPercent } from "src/ui/statistics-view/format";

const RATING_CLASSES = ["is-again", "is-hard", "is-good", "is-easy"];

/**
 * How often each button was pressed for learning, young and mature cards, as one bar of four segments per group.
 */
export function renderAnswerButtons(parent: HTMLElement, report: StatsReport): void {
    const parts = createCard(parent, t("STATS_BUTTONS_TITLE"));
    const ratingNames = [
        t("STATS_RATING_AGAIN"),
        t("STATS_RATING_HARD"),
        t("STATS_RATING_GOOD"),
        t("STATS_RATING_EASY"),
    ];
    const groups: { label: string; group: AnswerGroup }[] = [
        { label: t("STATS_BUTTONS_LEARNING"), group: report.answerButtons.learning },
        { label: t("STATS_BUTTONS_YOUNG"), group: report.answerButtons.young },
        { label: t("STATS_BUTTONS_MATURE"), group: report.answerButtons.mature },
    ];
    if (groups.every(({ group }) => group.total === 0)) {
        createNote(parts.body, t("STATS_NO_DATA"));
        return;
    }

    createLegend(
        parts.body,
        ratingNames.map((label, index) => ({ label, cls: RATING_CLASSES[index] })),
    );

    const list = parts.body.createDiv({ cls: "fs-stats-answers" });
    for (const { label, group } of groups) {
        const row = list.createDiv({ cls: "fs-stats-answer-row" });
        const head = row.createDiv({ cls: "fs-stats-answer-head" });
        head.createSpan({ cls: "fs-stats-answer-label", text: label });
        head.createSpan({
            cls: "fs-stats-answer-summary",
            text:
                group.total === 0
                    ? t("STATS_NO_DATA")
                    : t("STATS_BUTTONS_SUMMARY", {
                          count: formatCount(group.total),
                          correct: formatPercent(group.correct),
                      }),
        });

        const bar = row.createDiv({ cls: "fs-stats-answer-bar" });
        group.counts.forEach((count, index) => {
            if (count === 0) return;
            const share = count / group.total;
            const segment = bar.createDiv({
                cls: `fs-stats-answer-segment ${RATING_CLASSES[index]}`,
                attr: {
                    "data-rating": index + 1,
                    "aria-label": `${ratingNames[index]}: ${formatPercent(share)}`,
                },
            });
            segment.setCssProps({ "--fs-stats-share": String(count) });
        });
        if (group.total === 0) bar.addClass("is-empty");
    }
}

const RETENTION_ROW_KEYS: Record<
    RetentionRowId,
    | "STATS_ROW_TODAY"
    | "STATS_ROW_YESTERDAY"
    | "STATS_ROW_LAST7"
    | "STATS_ROW_LAST30"
    | "STATS_ROW_LAST365"
> = {
    today: "STATS_ROW_TODAY",
    yesterday: "STATS_ROW_YESTERDAY",
    last7: "STATS_ROW_LAST7",
    last30: "STATS_ROW_LAST30",
    last365: "STATS_ROW_LAST365",
};

function retentionCell(row: HTMLElement, cell: RetentionCell): void {
    const td = row.createEl("td", { cls: "fs-stats-retention-cell" });
    if (cell.total === 0) {
        td.createSpan({ cls: "fs-stats-retention-rate is-empty", text: "-" });
        return;
    }
    td.createSpan({ cls: "fs-stats-retention-rate", text: formatPercent(cell.rate) });
    td.createSpan({
        cls: "fs-stats-retention-count",
        text: `${formatCount(cell.passed)}/${formatCount(cell.total)}`,
    });
}

/**
 * Anki's true retention table: pass rate of young and mature review cards over several periods.
 */
export function renderTrueRetention(parent: HTMLElement, rows: RetentionRow[]): void {
    const parts = createCard(parent, t("STATS_TRUE_RETENTION_TITLE"), {
        wide: true,
        section: "retention",
        summary: t("STATS_TRUE_RETENTION_NOTE"),
    });
    const scroller = parts.body.createDiv({ cls: "fs-stats-table-scroll" });
    const table = scroller.createEl("table", { cls: "fs-stats-retention" });
    const headRow = table.createEl("thead").createEl("tr");
    headRow.createEl("th", { text: "" });
    for (const label of [t("STATS_COL_YOUNG"), t("STATS_COL_MATURE"), t("STATS_COL_ALL")]) {
        headRow.createEl("th", { text: label });
    }
    const body = table.createEl("tbody");
    for (const row of rows) {
        const tr = body.createEl("tr", { attr: { "data-row": row.id } });
        tr.createEl("th", { text: t(RETENTION_ROW_KEYS[row.id]), attr: { scope: "row" } });
        retentionCell(tr, row.young);
        retentionCell(tr, row.mature);
        retentionCell(tr, row.all);
    }
}

/**
 * Shown when the deck has no recorded answers yet, above the charts that only need the cards.
 */
export function renderEmptyState(parent: HTMLElement, onReview: () => void): void {
    const empty = parent.createDiv({ cls: "fs-stats-card fs-card fs-stats-empty is-wide" });
    setIcon(
        empty.createDiv({ cls: "fs-stats-empty-icon fs-icon-tile fs-tone-blue" }),
        "bar-chart-3",
    );
    empty.createEl("h3", { cls: "fs-stats-empty-title", text: t("STATS_EMPTY_TITLE") });
    empty.createDiv({ cls: "fs-stats-empty-text", text: t("STATS_EMPTY_TEXT") });
    const button = empty.createEl("button", {
        cls: "fs-primary-button fs-stats-empty-button",
        text: t("STATS_REVIEW_NOW"),
        attr: { type: "button" },
    });
    button.addEventListener("click", onReview);
}
