import "src/ui/obsidian-ui-components/content-container/deck-container/studio-home.css";
import { setIcon } from "obsidian";

import { Deck } from "src/data/data-structures/deck/deck";
import { t } from "src/lang/helpers";
import { RepItemState } from "src/scheduling/algorithms/base/repetition-item";
import { DeckStats, IFlashcardReviewSequencer } from "src/scheduling/flashcard-review-sequencer";
import { createDeckTile, readableDeckName } from "src/ui/design/deck-identity";

/** A rough answer time used for the "about N min" estimate. */
export const SECONDS_PER_CARD = 10;

/**
 * What the home screen shows about the learner, read from the review history (so it arrives asynchronously).
 */
export interface HomeInsights {
    studiedToday: number;
    streak: number;
    /** True retention over the last 30 days, 0 to 1, or null without review answers. */
    retention: number | null;
    /** The deck remembered least well in the last 30 days, when it is under the target. */
    focus: { deck: string; retention: number; target: number } | null;
}

export interface HomeActions {
    startReviewOfDeck: (deck: Deck) => void;
    loadInsights: () => Promise<HomeInsights>;
    openStatistics: () => void;
    openSettings: () => void;
    /** Opens the exam setup. Absent: no "Take an exam" row. */
    openExams?: () => void;
    learnerName: string;
}

export function greeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return t("HOME_GOOD_MORNING");
    if (hour < 18) return t("HOME_GOOD_AFTERNOON");
    return t("HOME_GOOD_EVENING");
}

function deckSubtitle(stats: DeckStats): string {
    if (stats.dueCount > 0 && stats.newCount > 0) {
        return t("HOME_DUE_AND_NEW", { due: stats.dueCount, newCount: stats.newCount });
    }
    if (stats.dueCount > 0) return t("HOME_DUE_TODAY", { count: stats.dueCount });
    if (stats.newCount > 0) return t("HOME_NEW_CARDS", { count: stats.newCount });
    return t("HOME_ALL_DONE_SHORT");
}

function roundIconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
): void {
    const button = parent.createEl("button", {
        cls: "fs-round-button",
        attr: { "aria-label": label },
    });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
}

/**
 * The Studio home: a greeting, today's goal, three insight tiles and the decks to continue.
 */
export function renderStudioHome(
    container: HTMLElement,
    reviewSequencer: IFlashcardReviewSequencer,
    actions: HomeActions,
): void {
    container.empty();
    const root: Deck = reviewSequencer.originalDeckTree;
    const rootStats: DeckStats = reviewSequencer.getDeckStats(root.getTopicPath());
    const toStudy = rootStats.dueCount + rootStats.newCount;
    const totalNew = root.getDistinctRepItemCount(RepItemState.NewItem, true);
    const cardsLearned = Math.max(0, rootStats.totalCount - totalNew);

    // Greeting
    const head = container.createDiv({ cls: "fs-home-head" });
    const hello = head.createDiv({ cls: "fs-home-hello" });
    hello.createDiv({
        cls: "fs-home-greeting",
        text: greeting() + (actions.learnerName ? "," : ""),
    });
    if (actions.learnerName) hello.createDiv({ cls: "fs-home-name", text: actions.learnerName });
    hello.createDiv({ cls: "fs-home-tagline", text: t("HOME_TAGLINE") });
    const headButtons = head.createDiv({ cls: "fs-home-head-buttons" });
    roundIconButton(headButtons, "bar-chart-3", t("OPEN_STATISTICS_SHORT"), actions.openStatistics);
    roundIconButton(headButtons, "settings", t("OPEN_SETTINGS_SHORT"), actions.openSettings);

    // Daily goal
    const goal = container.createDiv({ cls: "fs-card fs-home-goal" });
    const ring = goal.createDiv({ cls: "fs-home-ring" });
    const goalText = goal.createDiv({ cls: "fs-home-goal-text" });
    goalText.createDiv({ cls: "fs-home-goal-label", text: t("HOME_DAILY_GOAL") });
    const goalNumber = goalText.createDiv({ cls: "fs-home-goal-number" });
    const goalDetail = goalText.createDiv({ cls: "fs-home-goal-detail" });
    const chevron = goal.createDiv({ cls: "fs-home-chevron" });
    setIcon(chevron, "chevron-right");
    goal.addEventListener("click", () => actions.startReviewOfDeck(root));
    const showGoal = (studied: number) => {
        const target = studied + toStudy;
        const progress = target > 0 ? studied / target : 1;
        ring.setCssProps({ "--fs-ring": progress.toFixed(4) });
        goalNumber.empty();
        goalNumber.createSpan({ cls: "fs-home-goal-done", text: String(studied) });
        goalNumber.createSpan({
            cls: "fs-home-goal-target",
            text: ` / ${target} ${t("HOME_CARDS_WORD")}`,
        });
        goalDetail.setText(
            toStudy === 0
                ? t("HOME_ALL_DONE_DESC")
                : t("HOME_LEFT_TODAY", {
                      count: toStudy,
                      minutes: Math.max(1, Math.round((toStudy * SECONDS_PER_CARD) / 60)),
                  }),
        );
    };
    showGoal(0);

    // Insight tiles
    const tiles = container.createDiv({ cls: "fs-home-tiles" });
    const streakValue = insightTile(tiles, "flame", "orange", "–", t("HOME_DAY_STREAK"));
    insightTile(tiles, "layers", "blue", String(cardsLearned), t("HOME_CARDS_LEARNED"));
    const retentionValue = insightTile(tiles, "bar-chart-2", "green", "–", t("HOME_RETENTION"));

    // Filled in once the history is read, when a deck needs attention
    const focusSlot = container.createDiv({ cls: "fs-home-focus-slot" });

    void actions.loadInsights().then((insights) => {
        showGoal(insights.studiedToday);
        if (insights.focus !== null)
            renderFocus(focusSlot, insights.focus, root, reviewSequencer, actions);
        streakValue.setText(String(insights.streak));
        retentionValue.setText(
            insights.retention === null ? "–" : `${Math.round(insights.retention * 100)}%`,
        );
    });

    // Exams
    const openExams = actions.openExams;
    if (openExams !== undefined) {
        const row = container.createDiv({ cls: "fs-card fs-home-deck is-clickable fs-home-exam" });
        setIcon(row.createDiv({ cls: "fs-icon-tile fs-tone-purple" }), "clipboard-check");
        const text = row.createDiv({ cls: "fs-home-deck-text" });
        text.createDiv({ cls: "fs-home-deck-name", text: t("DESKTOP_TAKE_EXAM") });
        text.createDiv({ cls: "fs-home-deck-sub", text: t("EXAM_HOME_SUB") });
        setIcon(row.createDiv({ cls: "fs-home-chevron" }), "chevron-right");
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        row.addEventListener("click", () => openExams());
        row.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openExams();
            }
        });
    }

    // Decks
    const section = container.createDiv({ cls: "fs-home-section" });
    section.createDiv({ cls: "fs-home-section-title", text: t("HOME_CONTINUE_STUDYING") });
    const list = section.createDiv({ cls: "fs-home-decks" });
    // Tree order, so subdecks stay under their parent
    let studyButtonShown = false;
    for (const { deck, depth } of flattenDecks(root.subdecks, 0)) {
        const stats = reviewSequencer.getDeckStats(deck.getTopicPath());
        const open = stats.dueCount + stats.newCount > 0;
        const row = list.createDiv({ cls: "fs-card fs-home-deck" });
        row.setAttribute("data-depth", String(Math.min(depth, 3)));
        row.toggleClass("is-done", !open);

        createDeckTile(row, deck.deckName);

        const text = row.createDiv({ cls: "fs-home-deck-text" });
        text.createDiv({ cls: "fs-home-deck-name", text: readableDeckName(deck.deckName) });
        text.createDiv({ cls: "fs-home-deck-sub", text: deckSubtitle(stats) });

        if (open && !studyButtonShown) {
            studyButtonShown = true;
            const study = row.createEl("button", { cls: "fs-home-study", text: t("HOME_STUDY") });
            study.addEventListener("click", (event) => {
                event.stopPropagation();
                actions.startReviewOfDeck(deck);
            });
        } else {
            setIcon(row.createDiv({ cls: "fs-home-chevron" }), open ? "chevron-right" : "check");
        }

        if (open) {
            row.addClass("is-clickable");
            row.setAttribute("role", "button");
            row.setAttribute("tabindex", "0");
            row.addEventListener("click", () => actions.startReviewOfDeck(deck));
            row.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    actions.startReviewOfDeck(deck);
                }
            });
        }
    }
}

/**
 * The deck that needs attention most, with a button to study it. Shown only when that deck has cards to study now.
 */
export function renderFocus(
    slot: HTMLElement,
    focus: NonNullable<HomeInsights["focus"]>,
    root: Deck,
    reviewSequencer: IFlashcardReviewSequencer,
    actions: HomeActions,
): void {
    const deck = flattenDecks(root.subdecks, 0)
        .map((item) => item.deck)
        .find((candidate) => candidate.getTopicPath().path.join("/") === focus.deck);
    if (deck === undefined) return;
    const stats = reviewSequencer.getDeckStats(deck.getTopicPath());
    if (stats.dueCount + stats.newCount === 0) return;

    const card = slot.createDiv({ cls: "fs-card fs-home-focus" });
    createDeckTile(card, deck.deckName);
    const text = card.createDiv({ cls: "fs-home-focus-text" });
    const label = text.createDiv({ cls: "fs-home-focus-label" });
    setIcon(label.createSpan({ cls: "fs-home-focus-icon" }), "target");
    label.createSpan({ text: t("HOME_FOCUS") });
    // The deck with its parent, leaving out a root that holds every deck (the flashcards tag)
    let path = deck.getTopicPath().path;
    if (root.subdecks.length === 1 && path.length > 1) path = path.slice(1);
    text.createDiv({
        cls: "fs-home-focus-deck",
        text: path.slice(-2).map(readableDeckName).join(" › "),
    });
    text.createDiv({
        cls: "fs-home-focus-detail",
        text: t("HOME_FOCUS_DETAIL", {
            rate: `${Math.round(focus.retention * 100)}%`,
            target: `${Math.round(focus.target * 100)}%`,
        }),
    });
    const study = card.createEl("button", { cls: "fs-home-study", text: t("HOME_STUDY") });
    study.addEventListener("click", () => actions.startReviewOfDeck(deck));
}

export function insightTile(
    parent: HTMLElement,
    icon: string,
    tone: string,
    value: string,
    label: string,
): HTMLElement {
    const tile = parent.createDiv({ cls: "fs-card fs-home-tile" });
    const iconEl = tile.createDiv({ cls: `fs-home-tile-icon fs-tone-${tone}` });
    setIcon(iconEl, icon);
    const valueEl = tile.createDiv({ cls: "fs-home-tile-value", text: value });
    tile.createDiv({ cls: "fs-home-tile-label", text: label });
    return valueEl;
}

function flattenDecks(decks: Deck[], depth: number): { deck: Deck; depth: number }[] {
    const result: { deck: Deck; depth: number }[] = [];
    for (const deck of decks) {
        result.push({ deck, depth });
        result.push(...flattenDecks(deck.subdecks, depth + 1));
    }
    return result;
}
