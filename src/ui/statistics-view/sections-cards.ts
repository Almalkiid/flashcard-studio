import { t } from "src/lang/helpers";
import { binLabel, Histogram, RetrievabilityResult } from "src/stats/cards";
import { addDays } from "src/stats/day-keys";
import { StatsReport } from "src/stats/report";
import {
    ChartHost,
    createBarChart,
    createDoughnut,
    DoughnutSlice,
} from "src/ui/statistics-view/charts";
import { createCard, createLegend, createNote } from "src/ui/statistics-view/dom";
import {
    formatCompactNumber,
    formatCount,
    formatDayLong,
    formatDayShort,
    formatPercent,
} from "src/ui/statistics-view/format";
import { formatIntervalCompact } from "src/utils/format-interval";

/** Past this many days the forecast is drawn one bar per week, so the bars stay readable. */
const WEEKLY_FORECAST_FROM_DAYS = 120;

/**
 * How many reviews are due on each coming day, with overdue cards as a red bar in front.
 */
export function renderForecast(parent: HTMLElement, report: StatsReport, host: ChartHost): void {
    const { forecast, todayKey } = report;
    const nextWeek = forecast.days.slice(1, 8).reduce((sum, count) => sum + count, 0);
    const dueToday = forecast.days[0] + forecast.overdue;
    const notes: string[] = [];
    if (forecast.overdue > 0) notes.push(t("STATS_FORECAST_OVERDUE", { count: forecast.overdue }));
    if (forecast.beyond > 0) notes.push(t("STATS_FORECAST_LATER", { count: forecast.beyond }));

    const parts = createCard(parent, t("STATS_FORECAST_TITLE"), {
        summary: [t("STATS_FORECAST_SUMMARY", { today: dueToday, week: nextWeek }), ...notes].join(
            " · ",
        ),
    });
    if (forecast.total === 0) {
        createNote(parts.body, t("STATS_NO_DATA"));
        return;
    }

    const weekly = forecast.days.length > WEEKLY_FORECAST_FROM_DAYS;
    const size = weekly ? 7 : 1;
    const counts: number[] = [];
    for (let i = 0; i < forecast.days.length; i += size) {
        counts.push(forecast.days.slice(i, i + size).reduce((sum, count) => sum + count, 0));
    }

    // Overdue cards come first, in their own colour
    const hasOverdue = forecast.overdue > 0;
    const labels: string[] = [];
    const titles: string[] = [];
    const data: number[] = [];
    const colors: string[] = [];
    if (hasOverdue) {
        labels.push(t("STATS_OVERDUE"));
        titles.push(t("STATS_OVERDUE"));
        data.push(forecast.overdue);
        colors.push(host.theme.overdue);
    }
    counts.forEach((count, index) => {
        const first = addDays(todayKey, index * size);
        labels.push(index === 0 && !weekly ? t("STATS_TODAY") : formatDayShort(first));
        titles.push(
            weekly
                ? `${formatDayShort(first)} - ${formatDayShort(addDays(first, size - 1))}`
                : formatDayLong(first),
        );
        data.push(count);
        colors.push(host.theme.review);
    });

    if (hasOverdue) {
        createLegend(parts.body, [
            { label: t("STATS_OVERDUE"), cls: "is-overdue" },
            { label: t("STATS_FORECAST_TITLE"), cls: "is-review" },
        ]);
    }
    createBarChart(host, parts.body, {
        labels,
        series: [
            {
                label: t("STATS_FORECAST_TITLE"),
                data,
                color: host.theme.review,
                pointColors: colors,
            },
        ],
        tooltipTitle: (index) => titles[index],
        valueFormat: (value) => formatCount(Math.round(value)),
        tooltipLabel: (_series, value) => t("STATS_DUE_TOOLTIP", { count: formatCount(value) }),
        ariaLabel: t("STATS_FORECAST_TITLE"),
    });
}

/**
 * The card states as a doughnut, with the exact numbers beside it.
 */
export function renderCardCounts(parent: HTMLElement, report: StatsReport, host: ChartHost): void {
    const counts = report.cardCounts;
    const parts = createCard(parent, t("STATS_CARD_MATURITY_TITLE"));

    const definitions: { label: string; value: number }[] = [
        { label: t("STATS_COUNT_NEW"), value: counts.new },
        { label: t("STATS_COUNT_LEARNING"), value: counts.learning },
        { label: t("STATS_COUNT_RELEARNING"), value: counts.relearning },
        { label: t("STATS_COUNT_YOUNG"), value: counts.young },
        { label: t("STATS_COUNT_MATURE"), value: counts.mature },
        { label: t("STATS_COUNT_SUSPENDED"), value: counts.suspended },
        { label: t("STATS_COUNT_BURIED"), value: counts.buried },
    ];
    const slices: DoughnutSlice[] = definitions
        .map((definition, index) => ({ ...definition, color: host.theme.counts[index] }))
        .filter((slice) => slice.value > 0);

    if (counts.total === 0) {
        createNote(parts.body, t("STATS_NO_DATA"));
        return;
    }

    const layout = parts.body.createDiv({ cls: "sr-stats-donut" });
    const chartBox = layout.createDiv({ cls: "sr-stats-donut-chart" });
    createDoughnut(
        host,
        chartBox,
        slices,
        t("STATS_CARD_MATURITY_TITLE"),
        (slice) =>
            `${slice.label}: ${t("STATS_CARDS_TOOLTIP", { count: formatCount(slice.value) })}`,
    );
    const centre = chartBox.createDiv({ cls: "sr-stats-donut-centre" });
    centre.createDiv({
        cls: "sr-stats-donut-total",
        text: formatCount(counts.total),
        attr: { "data-stat": "total-cards" },
    });
    centre.createDiv({ cls: "sr-stats-donut-unit", text: t("STATS_CARDS_UNIT") });

    const list = layout.createDiv({ cls: "sr-stats-donut-list" });
    const swatchClasses = [
        "is-count-new",
        "is-count-learning",
        "is-count-relearning",
        "is-count-young",
        "is-count-mature",
        "is-count-suspended",
        "is-count-buried",
    ];
    definitions.forEach((definition, index) => {
        if (definition.value === 0) return;
        const row = list.createDiv({ cls: "sr-stats-donut-row" });
        row.createSpan({ cls: `sr-stats-swatch ${swatchClasses[index]}` });
        row.createSpan({ cls: "sr-stats-donut-name", text: definition.label });
        row.createSpan({ cls: "sr-stats-donut-count", text: formatCount(definition.value) });
        row.createSpan({
            cls: "sr-stats-donut-percent",
            text: formatPercent(definition.value / counts.total),
        });
    });
}

interface HistogramCardSpec {
    title: string;
    summary: string;
    histogram: Histogram;
    style: "int" | "percent";
    /** Shown under the chart, e.g. that SM-2 cards are left out. */
    note?: string;
    ariaLabel: string;
}

function renderHistogram(parent: HTMLElement, host: ChartHost, spec: HistogramCardSpec): void {
    const parts = createCard(parent, spec.title, { summary: spec.summary });
    if (spec.histogram.total === 0) {
        createNote(parts.body, t("STATS_NO_DATA"));
    } else {
        createBarChart(host, parts.body, {
            labels: spec.histogram.bins.map((bin) => binLabel(bin, spec.style)),
            series: [
                {
                    label: spec.title,
                    data: spec.histogram.bins.map((bin) => bin.count),
                    color: host.theme.review,
                },
            ],
            tooltipTitle: (index) => binLabel(spec.histogram.bins[index], spec.style),
            valueFormat: (value) => formatCount(Math.round(value)),
            tooltipLabel: (_series, value) =>
                t("STATS_CARDS_TOOLTIP", { count: formatCount(value) }),
            ariaLabel: spec.ariaLabel,
            maxTicks: 10,
        });
    }
    if (spec.note) createNote(parts.body, spec.note);
}

function sm2Note(excluded: number): string | undefined {
    return excluded > 0 ? t("STATS_SM2_NOTE", { count: formatCount(excluded) }) : undefined;
}

/** The distribution of scheduled intervals of the review cards. */
export function renderIntervals(parent: HTMLElement, report: StatsReport, host: ChartHost): void {
    const { intervals } = report;
    renderHistogram(parent, host, {
        title: t("STATS_INTERVALS_TITLE"),
        summary:
            intervals.total === 0
                ? ""
                : t("STATS_INTERVALS_SUMMARY", {
                      average: formatIntervalCompact(intervals.mean ?? 0),
                      median: formatIntervalCompact(intervals.median ?? 0),
                      longest: formatIntervalCompact(intervals.max ?? 0),
                  }),
        histogram: intervals,
        style: "int",
        ariaLabel: t("STATS_INTERVALS_TITLE"),
    });
}

/** The FSRS stability of each card. */
export function renderStability(parent: HTMLElement, report: StatsReport, host: ChartHost): void {
    const { histogram, excluded } = report.stability;
    renderHistogram(parent, host, {
        title: t("STATS_STABILITY_TITLE"),
        summary:
            histogram.total === 0
                ? ""
                : t("STATS_STABILITY_SUMMARY", {
                      average: formatIntervalCompact(histogram.mean ?? 0),
                      median: formatIntervalCompact(histogram.median ?? 0),
                  }),
        histogram,
        style: "int",
        note: sm2Note(excluded),
        ariaLabel: t("STATS_STABILITY_TITLE"),
    });
}

/** The FSRS difficulty of each card. */
export function renderDifficulty(parent: HTMLElement, report: StatsReport, host: ChartHost): void {
    const { histogram, excluded } = report.difficulty;
    renderHistogram(parent, host, {
        title: t("STATS_DIFFICULTY_TITLE"),
        summary:
            histogram.total === 0
                ? ""
                : t("STATS_DIFFICULTY_SUMMARY", {
                      average: formatCompactNumber(histogram.mean ?? 0),
                  }),
        histogram,
        style: "int",
        note: sm2Note(excluded),
        ariaLabel: t("STATS_DIFFICULTY_TITLE"),
    });
}

/** How likely each card is to be remembered right now. */
export function renderRetrievability(
    parent: HTMLElement,
    result: RetrievabilityResult,
    host: ChartHost,
): void {
    const { histogram, excluded, expectedKnown } = result;
    renderHistogram(parent, host, {
        title: t("STATS_RETRIEVABILITY_TITLE"),
        summary:
            histogram.total === 0
                ? ""
                : t("STATS_RETRIEVABILITY_SUMMARY", {
                      average: formatPercent((histogram.mean ?? 0) / 100),
                      known: formatCount(Math.round(expectedKnown)),
                      total: formatCount(histogram.total),
                  }),
        histogram,
        style: "percent",
        note: sm2Note(excluded),
        ariaLabel: t("STATS_RETRIEVABILITY_TITLE"),
    });
}
