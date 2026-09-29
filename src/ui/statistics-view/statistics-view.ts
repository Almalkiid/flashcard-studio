import "src/ui/statistics-view/statistics-view.css";
import { ItemView, setIcon, WorkspaceLeaf } from "obsidian";

import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";
import { FlashcardReviewMode } from "src/scheduling/flashcard-review-sequencer";
import { buildStatsReport, StatsReport } from "src/stats/report";
import { TIME_RANGES, TimeRange } from "src/stats/types";
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
    private readonly plugin: SRPlugin;
    private inputs: StatsInputs | null = null;
    private deck = "";
    private range: TimeRange = "1m";
    private readonly toggles: ViewToggles = { dailyMode: "count", hourlyMode: "reviews" };
    private host: ChartHost | null = null;
    private loadedAt = 0;
    private loading = false;

    private rootEl: HTMLElement | null = null;
    private bodyEl: HTMLElement | null = null;
    private deckSelectEl: HTMLSelectElement | null = null;
    private refreshEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: SRPlugin) {
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
        this.contentEl.addClass("sr-stats-view");
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
        this.rootEl = this.contentEl.createDiv({ cls: "sr-stats-root fs-studio" });
        const inner = this.rootEl.createDiv({ cls: "sr-stats-inner" });

        const header = inner.createDiv({ cls: "sr-stats-header" });
        const titleRow = header.createDiv({ cls: "sr-stats-header-row" });
        titleRow.createEl("h2", { cls: "sr-stats-title", text: t("STATS_VIEW_TITLE") });
        this.refreshEl = titleRow.createEl("button", {
            cls: "sr-stats-refresh",
            attr: { "aria-label": t("STATS_REFRESH"), type: "button" },
        });
        setIcon(this.refreshEl, "refresh-cw");
        this.refreshEl.addEventListener("click", () => void this.reload());

        const controls = header.createDiv({ cls: "sr-stats-controls" });
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
        // A native select in a pill, so phones get their own picker
        const deckPill = controls.createDiv({ cls: "sr-stats-deck" });
        setIcon(deckPill.createSpan({ cls: "sr-stats-deck-icon" }), "layers");
        this.deckSelectEl = deckPill.createEl("select", {
            cls: "sr-stats-select",
            attr: { "aria-label": t("STATS_DECK_LABEL") },
        });
        setIcon(deckPill.createSpan({ cls: "sr-stats-deck-chevron" }), "chevron-down");
        this.deckSelectEl.addEventListener("change", () => {
            this.deck = this.deckSelectEl?.value ?? "";
            this.render();
        });

        this.bodyEl = inner.createDiv({ cls: "sr-stats-body" });
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
        const select = this.deckSelectEl;
        if (select === null) return;
        if (this.deck !== "" && !decks.includes(this.deck)) this.deck = "";

        select.empty();
        select.createEl("option", { value: "", text: t("STATS_ALL_DECKS") });
        for (const deck of decks) {
            const parts = deck.split("/");
            // Indent subdecks so the hierarchy is visible in the native dropdown
            select.createEl("option", {
                value: deck,
                text: "  ".repeat(parts.length - 1) + parts[parts.length - 1],
                attr: { title: deck },
            });
        }
        select.value = this.deck;
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
            const stage = body.createDiv({ cls: "sr-stats-grid" });
            renderEmptyState(stage, () => {
                void this.plugin.uiManager.openDeckContainer(FlashcardReviewMode.Review);
            });
        }

        const grid = body.createDiv({ cls: "sr-stats-grid" });
        if (report.hasHistory) {
            renderDaily(grid, report, host, this.toggles);
            renderHeatmap(grid, report.heatmap, inputs.weekStart);
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
