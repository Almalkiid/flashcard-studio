import "src/ui/statistics-view/statistics-view.css";
import { ItemView, setIcon, WorkspaceLeaf } from "obsidian";

import { t } from "src/lang/translate";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import { childDecks, progressRows } from "src/stats/progress";
import { buildStatsReport, StatsReport } from "src/stats/report";
import { deckMatches } from "src/stats/scope";
import { TIME_RANGES, TimeRange } from "src/stats/types";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { readableDeckName } from "src/ui/design/deck-identity";
import { readChartTheme } from "src/ui/statistics-view/chart-theme";
import { ChartHost } from "src/ui/statistics-view/charts";
import { createNote, createSegmented } from "src/ui/statistics-view/dom";
import { renderHeatmap } from "src/ui/statistics-view/heatmap";
import {
    MetricSection,
    renderDaily,
    renderHourly,
    renderMetrics,
    ViewToggles,
} from "src/ui/statistics-view/sections-activity";
import {
    renderCardCounts,
    renderDifficulty,
    renderForecast,
    renderIntervals,
    renderRetrievability,
    renderStability,
} from "src/ui/statistics-view/sections-cards";
import { renderWeakAreas } from "src/ui/statistics-view/sections-insights";
import { renderProgress } from "src/ui/statistics-view/sections-progress";
import {
    renderAnswerButtons,
    renderEmptyState,
    renderTrueRetention,
} from "src/ui/statistics-view/sections-tables";
import { loadStatsInputs, StatsInputs } from "src/ui/statistics-view/stats-data";

export const STATISTICS_VIEW_TYPE = "flashcard-studio-statistics";

/** Coming back to the tab reloads the data unless it was loaded just now. */
const RELOAD_AFTER_MS = 2000;

const RANGE_LABEL_KEYS: Record<
    TimeRange,
    "STATS_RANGE_1M" | "STATS_RANGE_3M" | "STATS_RANGE_1Y" | "STATS_RANGE_ALL"
> = {
    "1m": "STATS_RANGE_1M",
    "3m": "STATS_RANGE_3M",
    "1y": "STATS_RANGE_1Y",
    all: "STATS_RANGE_ALL",
};

/**
 * The statistics of the review history and the cards, scoped by deck and time range.
 *
 * The review log is read once when the view opens or is refreshed, and the numbers are aggregated once per change
 * of scope; drawing never touches the vault.
 */
export class StatisticsView extends ItemView {
    private readonly plugin: FlashcardStudioPlugin;
    private inputs: StatsInputs | null = null;
    private deck = "";
    private range: TimeRange = "1m";
    private readonly toggles: ViewToggles = { dailyMode: "count", hourlyMode: "reviews" };
    private host: ChartHost | null = null;
    private loadedAt = 0;
    private loading = false;

    private rootEl: HTMLElement | null = null;
    private bodyEl: HTMLElement | null = null;
    // One dropdown per deck level: all decks or a top deck, then its subdecks, and so on
    private deckPickerEl: HTMLElement | null = null;
    private decks: string[] = [];
    private refreshEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: FlashcardStudioPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.navigation = false;
    }

    getViewType(): string {
        return STATISTICS_VIEW_TYPE;
    }

    getDisplayText(): string {
        return t("STATS_VIEW_TITLE");
    }

    getIcon(): string {
        return "bar-chart-3";
    }

    async onOpen(): Promise<void> {
        this.contentEl.addClass("fs-stats-view");
        this.buildSkeleton();

        // Charts read their colours when they are drawn, so a theme change needs a redraw
        this.registerEvent(this.app.workspace.on("css-change", () => this.render()));
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", (leaf) => {
                if (leaf === this.leaf && Date.now() - this.loadedAt > RELOAD_AFTER_MS) {
                    void this.reload();
                }
            }),
        );

        await this.reload();
    }

    onClose(): Promise<void> {
        this.host?.destroyAll();
        this.host = null;
        return Promise.resolve();
    }

    private buildSkeleton(): void {
        this.contentEl.empty();
        this.rootEl = this.contentEl.createDiv({ cls: "fs-stats-root fs-studio" });
        const inner = this.rootEl.createDiv({ cls: "fs-stats-inner" });

        const header = inner.createDiv({ cls: "fs-stats-header" });
        const titleRow = header.createDiv({ cls: "fs-stats-header-row" });
        // On a phone the statistics replace the deck list, so this is the way back to it
        const backEl = titleRow.createEl("button", {
            cls: "fs-stats-back",
            attr: { "aria-label": t("SESSION_BACK_TO_DECKS"), type: "button" },
        });
        setIcon(backEl, "arrow-left");
        backEl.addEventListener("click", () => {
            this.leaf.detach();
            void this.plugin.uiManager.openDeckContainer(
                FlashcardReviewMode.Review,
                undefined,
                undefined,
                true,
            );
        });
        titleRow.createEl("h2", { cls: "fs-stats-title", text: t("STATS_VIEW_TITLE") });
        this.refreshEl = titleRow.createEl("button", {
            cls: "fs-stats-refresh",
            attr: { "aria-label": t("STATS_REFRESH"), type: "button" },
        });
        setIcon(this.refreshEl, "refresh-cw");
        this.refreshEl.addEventListener("click", () => void this.reload());

        const controls = header.createDiv({ cls: "fs-stats-controls" });
        createSegmented(
            controls,
            TIME_RANGES.map((range) => ({ value: range, label: t(RANGE_LABEL_KEYS[range]) })),
            this.range,
            t("STATS_RANGE_LABEL"),
            (range) => {
                this.range = range;
                this.render();
            },
        );
        this.deckPickerEl = controls.createDiv({ cls: "fs-stats-decks" });

        this.bodyEl = inner.createDiv({ cls: "fs-stats-body" });
        createNote(this.bodyEl, t("STATS_LOADING"));
    }

    /**
     * Reads the vault again: the cards, and the whole review log.
     */
    private async reload(): Promise<void> {
        if (this.loading || !this.plugin.isInitialized) return;
        this.loading = true;
        this.rootEl?.addClass("is-loading");
        try {
            this.inputs = await loadStatsInputs(this.plugin);
            this.loadedAt = Date.now();
            this.fillDeckOptions(this.inputs.decks);
            this.render();
        } catch (error) {
            console.error("Flashcard Studio: could not load the statistics", error);
            this.bodyEl?.empty();
            if (this.bodyEl) createNote(this.bodyEl, t("STATS_ERROR"));
        } finally {
            this.loading = false;
            this.rootEl?.removeClass("is-loading");
        }
    }

    private fillDeckOptions(decks: string[]): void {
        this.decks = decks;
        if (this.deck !== "" && !decks.some((deck) => deckMatches(this.deck, deck))) this.deck = "";
        this.renderDeckPicker();
    }

    /**
     * A dropdown for each level of the chosen deck, and one more for its subdecks while it has any. A native select in a
     * pill, so phones get their own picker.
     */
    private renderDeckPicker(): void {
        const picker = this.deckPickerEl;
        if (picker === null) return;
        picker.empty();
        const chosen = this.deck === "" ? [] : this.deck.split("/");
        for (let level = 0; level <= chosen.length; level++) {
            const parent = chosen.slice(0, level).join("/");
            const children = childDecks(this.decks, parent);
            if (children.length === 0) break;

            const parentName = readableDeckName(chosen[level - 1] ?? "");
            const pill = picker.createDiv({ cls: "fs-stats-deck" });
            setIcon(pill.createSpan({ cls: "fs-stats-deck-icon" }), "layers");
            const select = pill.createEl("select", {
                cls: "fs-stats-select",
                attr: {
                    "data-level": String(level),
                    "aria-label":
                        level === 0
                            ? t("STATS_DECK_LABEL")
                            : t("STATS_DECK_LEVEL_LABEL", { deck: parentName }),
                },
            });
            setIcon(pill.createSpan({ cls: "fs-stats-deck-chevron" }), "chevron-down");

            select.createEl("option", {
                value: parent,
                text: level === 0 ? t("STATS_ALL_DECKS") : t("STATS_ALL_OF", { deck: parentName }),
            });
            for (const child of children) {
                const name = child.split("/").pop() ?? child;
                select.createEl("option", {
                    value: child,
                    text: readableDeckName(name),
                    attr: { title: child },
                });
            }
            select.value = level < chosen.length ? chosen.slice(0, level + 1).join("/") : parent;
            select.addEventListener("change", () => this.chooseDeck(select.value));
        }
    }

    /** Shows the statistics of a deck and its subdecks; the empty deck is all of them. */
    private chooseDeck(deck: string): void {
        this.deck = deck;
        this.renderDeckPicker();
        this.render();
    }

    /**
     * Aggregates for the current scope and draws everything.
     */
    private render(): void {
        const body = this.bodyEl;
        const root = this.rootEl;
        if (body === null || root === null || this.inputs === null) return;

        this.host?.destroyAll();
        body.empty();

        const reducedMotion = activeWindow.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const host = new ChartHost(readChartTheme(root), !reducedMotion);
        this.host = host;

        const inputs = this.inputs;
        const report: StatsReport = buildStatsReport(inputs.entries, inputs.cards, {
            nowMs: Date.now(),
            dayKeyOf: inputs.dayKeyOf,
            weekStart: inputs.weekStart,
            deck: this.deck,
            range: this.range,
        });

        if (report.hasHistory) {
            renderMetrics(body, report, t(RANGE_LABEL_KEYS[this.range]), (section) =>
                this.scrollToSection(section),
            );
        } else {
            const stage = body.createDiv({ cls: "fs-stats-grid" });
            renderEmptyState(stage, () => {
                void this.plugin.uiManager.openDeckContainer(FlashcardReviewMode.Review);
            });
        }

        const grid = body.createDiv({ cls: "fs-stats-grid" });
        renderProgress(grid, progressRows(inputs.cards, this.decks, this.deck), (deck) =>
            this.chooseDeck(deck),
        );
        if (report.hasHistory) {
            renderDaily(grid, report, host, this.toggles);
            renderHeatmap(grid, report.heatmap, inputs.weekStart);
            renderWeakAreas(
                grid,
                report.weakAreas,
                this.plugin.dataManager.data.settings.fsrsDesiredRetention,
            );
        }
        renderCardCounts(grid, report, host);
        renderForecast(grid, report, host);
        renderIntervals(grid, report, host);
        renderStability(grid, report, host);
        renderDifficulty(grid, report, host);
        renderRetrievability(grid, report.retrievability, host);
        if (report.hasHistory) {
            renderAnswerButtons(grid, report);
            renderHourly(grid, report, host, this.toggles);
            renderTrueRetention(grid, report.retention);
        }
    }

    /**
     * Scrolls the view, and only the view, so the card of a metric tile sits at the top.
     */
    private scrollToSection(section: MetricSection): void {
        const root = this.rootEl;
        const target = root?.querySelector<HTMLElement>(`[data-section="${section}"]`);
        if (!root || !target) return;
        const offset = target.getBoundingClientRect().top - root.getBoundingClientRect().top;
        const reducedMotion = activeWindow.matchMedia("(prefers-reduced-motion: reduce)").matches;
        root.scrollTo({
            top: root.scrollTop + offset - 16,
            behavior: reducedMotion ? "auto" : "smooth",
        });
    }
}
