import { moment, setIcon } from "obsidian";

import type { Deck } from "src/data/data-structures/deck/deck";
import { t } from "src/lang/helpers";
import { RepItemState } from "src/scheduling/algorithms/base/repetition-item";
import type {
    DeckStats,
    IFlashcardReviewSequencer,
} from "src/scheduling/flashcard-review-sequencer";
import type { Heatmap } from "src/stats/activity";
import { createDeckTile, readableDeckName } from "src/ui/design/deck-identity";
import {
    greeting,
    HomeActions,
    insightTile,
    renderFocus,
    SECONDS_PER_CARD,
} from "src/ui/obsidian-ui-components/content-container/deck-container/studio-home";
import {
    deckPathLabel,
    tableDecks,
} from "src/ui/obsidian-ui-components/content-container/desktop/desktop-data";
import { makePressable } from "src/ui/obsidian-ui-components/content-container/desktop/desktop-shell";
import {
    formatCount,
    formatDate,
    formatDuration,
    formatPercent,
    formatWeekdayShort,
    reviewsLabel,
} from "src/ui/statistics-view/format";

/** The last exam taken, for the home's "Last exam" card. Comes from the exams feature. */
export interface LastExamSummary {
    title: string;
    percent: number;
    right: number;
    total: number;
    minutes: number;
    endedMs: number;
    passed: boolean;
}

/** What the table shows about a deck beyond the queue counts, from the review history and the cards. */
export interface DeckDetail {
    /** True retention over the last 30 days, 0 to 1; null without enough answers. */
    retention: number | null;
    /** Learning and relearning cards that are ready now. */
    learning: number;
}

/** What the desktop home needs beyond the Studio home. */
export interface DesktopHomeServices {
    /** Absent until the exams feature exists: the button and the Retake button are not shown then. */
    openExams?(): void;
    /** Absent until the exams feature exists; null when no exam was taken yet. */
    lastExam?(): Promise<LastExamSummary | null>;
    /** Cards due on each of the next seven days, today first. */
    forecast(): Promise<number[]>;
    heatmap(): Promise<Heatmap>;
    /** The detail of each deck path (`CIA/Part1`). */
    deckDetails(paths: string[]): Promise<Map<string, DeckDetail>>;
    /** Set when the queue is not the normal review ("Cram mode", "Custom study"). */
    modeLabel(): string | null;
    /** Goes back to the normal review from Cram mode or a custom study session. */
    resetMode(): void;
}

export interface DesktopHomeActions extends HomeActions, Omit<DesktopHomeServices, "modeLabel"> {
    /** The retention the person aims for, 0 to 1, marked on each deck's bar. */
    retentionTarget: number;
    modeLabel: string | null;
}

function estimateMinutes(cards: number): number {
    return Math.max(1, Math.round((cards * SECONDS_PER_CARD) / 60));
}

function cardsText(count: number): string {
    return count === 1 ? t("HOME_ONE_CARD") : t("HOME_CARDS", { count });
}

function longDate(): string {
    return new Intl.DateTimeFormat(moment.locale() || "en", {
        weekday: "long",
        day: "numeric",
        month: "long",
    }).format(new Date());
}

/**
 * The desktop home: the greeting with the day's work, the goal, streak, cards learned and retention, the focus deck and
 * the last exam, a table of the decks and the activity and forecast beside it.
 */
export function renderDesktopHome(
    container: HTMLElement,
    reviewSequencer: IFlashcardReviewSequencer,
    actions: DesktopHomeActions,
): void {
    container.empty();
    container.addClass("fs-desktop-home");
    const root: Deck = reviewSequencer.originalDeckTree;
    const rootStats: DeckStats = reviewSequencer.getDeckStats(root.getTopicPath());
    const toStudy = rootStats.dueCount + rootStats.newCount;
    const totalNew = root.getDistinctRepItemCount(RepItemState.NewItem, true);
    const cardsLearned = Math.max(0, rootStats.totalCount - totalNew);

    renderHead(container, toStudy, root, actions);

    // Goal, then streak, cards learned and retention in one strip
    const top = container.createDiv({ cls: "fs-dh-row fs-dh-top" });
    const showGoal = renderGoal(top, toStudy, () => actions.startReviewOfDeck(root));
    const strip = top.createDiv({ cls: "fs-card fs-dh-strip" });
    const streakValue = insightTile(strip, "flame", "orange", "–", t("HOME_DAY_STREAK"));
    insightTile(strip, "layers", "blue", formatCount(cardsLearned), t("HOME_CARDS_LEARNED"));
    const retentionValue = insightTile(strip, "bar-chart-2", "green", "–", t("HOME_RETENTION"));

    // Filled in once the history is read
    const middle = container.createDiv({ cls: "fs-dh-row fs-dh-middle" });
    const focusSlot = middle.createDiv({ cls: "fs-home-focus-slot fs-dh-focus" });
    const examSlot = middle.createDiv({ cls: "fs-dh-exam-slot" });
    void actions.loadInsights().then((insights) => {
        showGoal(insights.studiedToday);
        streakValue.setText(String(insights.streak));
        retentionValue.setText(formatPercent(insights.retention));
        if (insights.focus !== null)
            renderFocus(focusSlot, insights.focus, root, reviewSequencer, actions);
        middle.toggleClass("is-empty", middle.querySelector(".fs-card") === null);
    });
    if (actions.lastExam !== undefined) {
        void actions.lastExam().then((exam) => {
            if (exam !== null) renderLastExam(examSlot, exam, actions);
            middle.toggleClass("is-empty", middle.querySelector(".fs-card") === null);
        });
    }
    middle.addClass("is-empty");

    // The decks, with the activity and the coming days beside them
    const bottom = container.createDiv({ cls: "fs-dh-row fs-dh-bottom" });
    renderDeckTable(bottom, reviewSequencer, root, actions);
    const side = bottom.createDiv({ cls: "fs-dh-side" });
    renderActivity(side, actions);
    renderForecast(side, actions);
}

function renderHead(
    container: HTMLElement,
    toStudy: number,
    root: Deck,
    actions: DesktopHomeActions,
): void {
    const head = container.createDiv({ cls: "fs-dh-head" });
    const hello = head.createDiv({ cls: "fs-dh-hello" });
    const title = hello.createDiv({
        cls: "fs-dh-title",
        text: greeting() + (actions.learnerName ? `, ${actions.learnerName}` : ""),
    });
    title.setAttribute("role", "heading");
    title.setAttribute("aria-level", "1");
    const date = longDate();
    const sub = hello.createDiv({ cls: "fs-dh-sub" });
    sub.createSpan({
        text:
            toStudy === 0
                ? t("DESKTOP_HOME_NOTHING_DUE", { date })
                : t("DESKTOP_HOME_DUE_SUMMARY", {
                      date,
                      cards: cardsText(toStudy),
                      minutes: t("HOME_MINUTES", { minutes: estimateMinutes(toStudy) }),
                  }),
    });
    if (actions.modeLabel !== null) {
        // Clicking the pill goes back to the normal review
        const pill = sub.createSpan({ cls: "fs-pill fs-dh-mode" });
        pill.setAttribute("aria-label", t("REVIEW_MODE"));
        pill.createSpan({ text: actions.modeLabel });
        setIcon(pill.createSpan({ cls: "fs-dh-mode-close" }), "x");
        makePressable(pill, () => actions.resetMode());
    }

    const buttons = head.createDiv({ cls: "fs-dh-actions" });
    const openExams = actions.openExams;
    if (openExams !== undefined) {
        const exam = buttons.createDiv({ cls: "fs-dh-button" });
        setIcon(exam.createSpan({ cls: "fs-dh-button-icon" }), "clipboard-check");
        exam.createSpan({ text: t("DESKTOP_TAKE_EXAM") });
        makePressable(exam, () => openExams());
    }
    if (toStudy > 0) {
        const study = buttons.createDiv({ cls: "fs-dh-button is-primary" });
        setIcon(study.createSpan({ cls: "fs-dh-button-icon" }), "play");
        study.createSpan({ text: t("DESKTOP_STUDY_ALL", { count: toStudy }) });
        makePressable(study, () => actions.startReviewOfDeck(root));
    }
}

/** The daily goal: a ring of today's answers against what is still to study. Returns the function that updates it. */
function renderGoal(
    parent: HTMLElement,
    toStudy: number,
    open: () => void,
): (studied: number) => void {
    const goal = parent.createDiv({ cls: "fs-card fs-dh-goal" });
    const ring = goal.createDiv({ cls: "fs-home-ring fs-dh-ring" });
    const text = goal.createDiv({ cls: "fs-dh-goal-text" });
    text.createDiv({ cls: "fs-home-goal-label", text: t("HOME_DAILY_GOAL") });
    const number = text.createDiv({ cls: "fs-home-goal-number" });
    const detail = text.createDiv({ cls: "fs-home-goal-detail" });
    makePressable(goal, open);
    return (studied: number) => {
        const target = studied + toStudy;
        ring.setCssProps({ "--fs-ring": (target > 0 ? studied / target : 1).toFixed(4) });
        number.empty();
        number.createSpan({ cls: "fs-home-goal-done", text: String(studied) });
        number.createSpan({
            cls: "fs-home-goal-target",
            text: ` / ${target} ${t("HOME_CARDS_WORD")}`,
        });
        detail.setText(
            toStudy === 0
                ? t("HOME_ALL_DONE_DESC")
                : t("HOME_LEFT_TODAY", { count: toStudy, minutes: estimateMinutes(toStudy) }),
        );
    };
}

function whenText(endedMs: number): string {
    const days = Math.floor((Date.now() - endedMs) / 86_400_000);
    if (days <= 0) return t("DESKTOP_WHEN_TODAY");
    if (days === 1) return t("DESKTOP_WHEN_YESTERDAY");
    return formatDate(endedMs);
}

function renderLastExam(
    slot: HTMLElement,
    exam: LastExamSummary,
    actions: DesktopHomeActions,
): void {
    slot.empty();
    const card = slot.createDiv({ cls: "fs-card fs-dh-exam" });
    card.toggleClass("is-passed", exam.passed);
    const ring = card.createDiv({ cls: "fs-home-ring fs-dh-exam-ring" });
    ring.setCssProps({ "--fs-ring": (Math.min(100, Math.max(0, exam.percent)) / 100).toFixed(4) });
    ring.createSpan({ text: `${Math.round(exam.percent)}%` });
    const text = card.createDiv({ cls: "fs-dh-exam-text" });
    text.createDiv({
        cls: "fs-dh-exam-eyebrow",
        text: `${t("DESKTOP_LAST_EXAM")} · ${exam.passed ? t("DESKTOP_EXAM_PASSED") : t("DESKTOP_EXAM_NOT_PASSED")}`,
    });
    text.createDiv({ cls: "fs-dh-exam-title", text: exam.title });
    text.createDiv({
        cls: "fs-dh-exam-detail",
        text: t("DESKTOP_EXAM_DETAIL", {
            right: exam.right,
            total: exam.total,
            time: formatDuration(exam.minutes * 60_000),
            when: whenText(exam.endedMs),
        }),
    });
    const openExams = actions.openExams;
    if (openExams !== undefined) {
        const retake = card.createDiv({ cls: "fs-dh-button" });
        retake.createSpan({ text: t("DESKTOP_EXAM_RETAKE") });
        makePressable(retake, () => openExams());
    }
}

function renderDeckTable(
    parent: HTMLElement,
    reviewSequencer: IFlashcardReviewSequencer,
    root: Deck,
    actions: DesktopHomeActions,
): void {
    const card = parent.createDiv({ cls: "fs-card fs-dh-decks" });
    const table = card.createEl("table", { cls: "fs-dh-table" });
    const headRow = table.createEl("thead").createEl("tr");
    headRow.createEl("th", { text: t("DESKTOP_TABLE_DECK") });
    for (const label of [t("NEW"), t("DESKTOP_TABLE_LEARN"), t("DUE")]) {
        headRow.createEl("th", { cls: "is-num", text: label });
    }
    headRow.createEl("th", { cls: "is-retention", text: t("DESKTOP_TABLE_RETENTION") });
    headRow.createEl("th");

    const body = table.createEl("tbody");
    const rows: {
        deck: Deck;
        path: string;
        stats: DeckStats;
        learn: HTMLElement;
        due: HTMLElement;
        bar: HTMLElement;
        rate: HTMLElement;
    }[] = [];
    for (const deck of tableDecks(root)) {
        const stats = reviewSequencer.getDeckStats(deck.getTopicPath());
        const row = body.createEl("tr", { cls: "fs-dh-deck-row" });

        const nameCell = row.createEl("td");
        const name = nameCell.createDiv({ cls: "fs-dh-deck" });
        createDeckTile(name, deck.deckName);
        const label = name.createDiv({ cls: "fs-dh-deck-text" });
        label.createDiv({
            cls: "fs-dh-deck-name",
            text: deckPathLabel(deck, root).map(readableDeckName).join(" › "),
        });
        label.createDiv({ cls: "fs-dh-deck-sub", text: cardsText(stats.totalCount) });

        const newCell = row.createEl("td", { cls: "is-num is-new" });
        const learnCell = row.createEl("td", { cls: "is-num is-learn" });
        const dueCell = row.createEl("td", { cls: "is-num is-due" });
        setCount(newCell, stats.newCount);
        setCount(learnCell, 0);
        setCount(dueCell, stats.dueCount);

        const retentionCell = row.createEl("td", { cls: "is-retention" });
        const bar = retentionCell.createSpan({ cls: "fs-dh-bar" });
        bar.createEl("i");
        bar.createEl("b").setCssProps({
            "--fs-target": `${Math.round(actions.retentionTarget * 100)}%`,
        });
        const rate = retentionCell.createSpan({ cls: "fs-dh-rate", text: "–" });

        const actionCell = row.createEl("td", { cls: "is-action" });
        if (stats.newCount + stats.dueCount > 0) {
            const study = actionCell.createEl("button", {
                cls: "fs-dh-study",
                text: t("HOME_STUDY"),
            });
            study.addEventListener("click", () => actions.startReviewOfDeck(deck));
        } else {
            actionCell.createSpan({ cls: "fs-dh-done", text: t("HOME_DECK_DONE") });
        }
        rows.push({
            deck,
            path: deck.getTopicPath().path.join("/"),
            stats,
            learn: learnCell,
            due: dueCell,
            bar,
            rate,
        });
    }

    // Retention and the learning cards come from the history, so they arrive after the queue counts
    void actions.deckDetails(rows.map((row) => row.path)).then((details) => {
        for (const row of rows) {
            const detail = details.get(row.path);
            if (detail === undefined) continue;
            // Learning cards that are ready are part of the due count; the table lists them apart
            setCount(row.learn, detail.learning);
            setCount(row.due, Math.max(0, row.stats.dueCount - detail.learning));
            if (detail.retention === null) continue;
            const percent = Math.round(detail.retention * 100);
            row.bar.querySelector("i")?.setCssProps({ "--fs-fill": `${percent}%` });
            row.bar.toggleClass("is-below", detail.retention < actions.retentionTarget);
            row.rate.setText(formatPercent(detail.retention));
        }
    });
}

function setCount(cell: HTMLElement, count: number): void {
    cell.setText(String(count));
    cell.toggleClass("is-zero", count === 0);
}

function renderActivity(parent: HTMLElement, actions: DesktopHomeActions): void {
    const card = parent.createDiv({ cls: "fs-card fs-dh-panel fs-dh-activity" });
    const title = card.createDiv({ cls: "fs-dh-panel-title" });
    title.createSpan({ text: t("DESKTOP_ACTIVITY") });
    const summary = title.createSpan({ cls: "fs-dh-panel-note" });
    const grid = card.createDiv({ cls: "fs-dh-heat" });
    void actions.heatmap().then((map) => {
        summary.setText(t("DESKTOP_ACTIVITY_SUMMARY", { reviews: reviewsLabel(map.total) }));
        for (const cell of map.cells) {
            const el = grid.createDiv({ cls: `fs-dh-heat-cell is-l${cell.level}` });
            el.setAttribute("data-day", cell.day);
            el.setAttribute("data-count", String(cell.count));
        }
        const weeks = map.cells.length === 0 ? 0 : map.cells[map.cells.length - 1].week + 1;
        grid.setCssProps({ "--fs-weeks": String(weeks) });
    });
}

function renderForecast(parent: HTMLElement, actions: DesktopHomeActions): void {
    const card = parent.createDiv({ cls: "fs-card fs-dh-panel fs-dh-forecast" });
    const title = card.createDiv({ cls: "fs-dh-panel-title" });
    title.createSpan({ text: t("DESKTOP_COMING_UP") });
    title.createSpan({ cls: "fs-dh-panel-note", text: t("DESKTOP_NEXT_7_DAYS") });
    const chart = card.createDiv({ cls: "fs-dh-bars" });
    void actions.forecast().then((days) => {
        const max = Math.max(1, ...days);
        const weekday = new Date().getDay();
        days.forEach((count, index) => {
            const col = chart.createDiv({ cls: "fs-dh-bar-col" });
            if (index === 0) col.addClass("is-today");
            col.createSpan({ cls: "fs-dh-bar-count", text: String(count) });
            const bar = col.createDiv({ cls: "fs-dh-bar-fill" });
            bar.setCssProps({ "--fs-h": String(Math.max(6, Math.round((count / max) * 100))) });
            col.createSpan({
                cls: "fs-dh-bar-day",
                text: index === 0 ? t("HOME_TODAY") : formatWeekdayShort((weekday + index) % 7),
            });
        });
    });
}
