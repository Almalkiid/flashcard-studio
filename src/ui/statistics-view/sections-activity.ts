import { Chart } from "chart.js";
import { setIcon } from "obsidian";

import { t } from "src/lang/helpers";
import { DailyCount } from "src/stats/activity";
import { addDays } from "src/stats/day-keys";
import { StatsReport } from "src/stats/report";
import { ChartHost, createBarChart } from "src/ui/statistics-view/charts";
import { createCard, createLegend, createNote, createSegmented } from "src/ui/statistics-view/dom";
import {
    daysLabel,
    formatCount,
    formatDayLong,
    formatDayShort,
    formatDuration,
    formatMonthYear,
    formatPercent,
    reviewsLabel,
} from "src/ui/statistics-view/format";

/** The toggles of the charts, kept while the view redraws for another deck or time range. */
export interface ViewToggles {
    dailyMode: "count" | "time";
    hourlyMode: "reviews" | "success";
}

/** The cards a metric tile scrolls to. */
export type MetricSection = "daily" | "heatmap" | "retention";

interface MetricMeta {
    label: string;
    value?: string;
    /** `data-stat` of the value, for the tests. */
    key?: string;
}

interface MetricSpec {
    /** `data-stat` of the big number. */
    key: string;
    icon: string;
    tone: string;
    value: string;
    label: string;
    meta: MetricMeta[];
    section: MetricSection;
    dim?: boolean;
}

/**
 * Writes a value such as `1 h 05 min` or `92%` with its numbers large and its units small, like the reference
 * designs. Text without a digit, such as the dash for "no rate", is written as it is.
 */
function fillValue(el: HTMLElement, text: string): void {
    if (!/\d/.test(text)) {
        el.setText(text);
        return;
    }
    for (const part of text.split(/(\d[\d.,]*)/)) {
        if (part === "") continue;
        if (/^\d/.test(part)) el.appendText(part);
        else el.createSpan({ cls: "sr-stats-unit", text: part });
    }
}

function createMetric(
    parent: HTMLElement,
    spec: MetricSpec,
    onOpen: (section: MetricSection) => void,
): void {
    const tile = parent.createDiv({
        cls: "sr-stats-metric fs-card",
        attr: { role: "button", tabindex: "0", "data-metric": spec.key },
    });
    const icon = tile.createDiv({ cls: `sr-stats-metric-icon fs-icon-tile fs-tone-${spec.tone}` });
    if (spec.dim) icon.addClass("is-dim");
    setIcon(icon, spec.icon);

    const main = tile.createDiv({ cls: "sr-stats-metric-main" });
    const text = main.createDiv({ cls: "sr-stats-metric-text" });
    fillValue(
        text.createDiv({ cls: "sr-stats-metric-value", attr: { "data-stat": spec.key } }),
        spec.value,
    );
    text.createDiv({ cls: "sr-stats-metric-label", text: spec.label });
    setIcon(main.createDiv({ cls: "sr-stats-metric-chevron" }), "chevron-right");

    const meta = tile.createDiv({ cls: "sr-stats-metric-meta" });
    for (const item of spec.meta) {
        const entry = meta.createSpan({ cls: "sr-stats-metric-meta-item" });
        if (item.label !== "") entry.createSpan({ text: item.label });
        if (item.value !== undefined) {
            const value = entry.createSpan({ cls: "sr-stats-metric-meta-value", text: item.value });
            if (item.key) value.setAttribute("data-stat", item.key);
        }
    }

    tile.addEventListener("click", () => onOpen(spec.section));
    tile.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(spec.section);
        }
    });
}

/**
 * The four tiles on top: reviews today, true retention, the streak and the study time of the time range. Each opens
 * the card that has the details.
 *
 * @param rangeLabel - The name of the selected time range, e.g. `1 month`.
 */
export function renderMetrics(
    parent: HTMLElement,
    report: StatsReport,
    rangeLabel: string,
    onOpen: (section: MetricSection) => void,
): void {
    const { today, streak, rangeSummary } = report;
    const last30 = report.retention.find((row) => row.id === "last30")?.all.rate ?? null;

    const retentionMeta: MetricMeta[] = [{ label: t("STATS_ROW_LAST30") }];
    if (today.retention !== null) {
        retentionMeta.push({
            label: t("STATS_TODAY"),
            value: formatPercent(today.retention),
            key: "retention",
        });
    }

    const grid = parent.createDiv({ cls: "sr-stats-metrics" });
    const specs: MetricSpec[] = [
        {
            key: "reviews",
            icon: "layers",
            tone: "blue",
            value: formatCount(today.reviews),
            label: t("STATS_METRIC_REVIEWS_TODAY"),
            meta: [
                { label: t("STATS_NEW_CARDS"), value: formatCount(today.newLearned), key: "new" },
                { label: t("STATS_TIME"), value: formatDuration(today.timeMs), key: "time" },
            ],
            section: "daily",
        },
        {
            key: "true-retention",
            icon: "target",
            tone: "green",
            value: formatPercent(last30),
            label: t("STATS_RETENTION"),
            meta: retentionMeta,
            section: "retention",
        },
        {
            key: "streak",
            icon: "flame",
            tone: "orange",
            value: formatCount(streak.current),
            label: t("STATS_METRIC_STREAK"),
            meta: [
                {
                    label: t("STATS_METRIC_LONGEST"),
                    value: daysLabel(streak.longest),
                    key: "longest",
                },
                {
                    label: t("STATS_DAYS_STUDIED"),
                    value: formatCount(streak.activeDays),
                    key: "days-studied",
                },
            ],
            section: "heatmap",
            dim: streak.current === 0,
        },
        {
            key: "range-time",
            icon: "clock",
            tone: "purple",
            value: formatDuration(rangeSummary.timeMs),
            label: t("STATS_METRIC_STUDY_TIME"),
            meta: [{ label: rangeLabel }, { label: "", value: reviewsLabel(rangeSummary.reviews) }],
            section: "daily",
        },
    ];
    for (const spec of specs) createMetric(grid, spec, onOpen);
}

function bucketTitle(row: DailyCount, granularity: StatsReport["dailyGranularity"]): string {
    if (granularity === "month") return formatMonthYear(row.day);
    if (granularity === "week") {
        return `${formatDayShort(row.day)} - ${formatDayShort(addDays(row.day, 6))}`;
    }
    return formatDayLong(row.day);
}

function bucketLabel(row: DailyCount, granularity: StatsReport["dailyGranularity"]): string {
    return granularity === "month" ? formatMonthYear(row.day) : formatDayShort(row.day);
}

/**
 * Reviews per day (or week, or month) as stacked bars by kind, with a toggle for the time spent instead.
 */
export function renderDaily(
    parent: HTMLElement,
    report: StatsReport,
    host: ChartHost,
    toggles: ViewToggles,
): void {
    const titleKey = {
        day: "STATS_DAILY_TITLE_DAY",
        week: "STATS_DAILY_TITLE_WEEK",
        month: "STATS_DAILY_TITLE_MONTH",
    } as const;
    const range = report.rangeSummary;
    const average = report.rangeActiveDays === 0 ? 0 : range.reviews / report.rangeActiveDays;
    const parts = createCard(parent, t(titleKey[report.dailyGranularity]), {
        wide: true,
        section: "daily",
        summary: t("STATS_DAILY_SUMMARY", {
            reviews: reviewsLabel(range.reviews),
            time: formatDuration(range.timeMs),
            average: reviewsLabel(Math.round(average)),
        }),
    });

    let chart: Chart | null = null;
    const draw = (): void => {
        if (chart !== null) host.release(chart);
        parts.body.empty();

        const rows = report.daily;
        const labels = rows.map((row) => bucketLabel(row, report.dailyGranularity));
        const title = (index: number): string => bucketTitle(rows[index], report.dailyGranularity);

        if (toggles.dailyMode === "time") {
            chart = createBarChart(host, parts.body, {
                labels,
                series: [
                    {
                        label: t("STATS_TIME"),
                        data: rows.map((row) => row.timeMs / 60000),
                        color: host.theme.review,
                    },
                ],
                tooltipTitle: title,
                valueFormat: (value) => formatDuration(value * 60000),
                tooltipLabel: (_series, value) => formatDuration(value * 60000),
                ariaLabel: t(titleKey[report.dailyGranularity]),
            });
            return;
        }

        const kinds = [
            {
                field: "learn",
                label: t("STATS_KIND_LEARN"),
                color: host.theme.learn,
                cls: "is-learn",
            },
            {
                field: "review",
                label: t("STATS_KIND_REVIEW"),
                color: host.theme.review,
                cls: "is-review",
            },
            {
                field: "relearn",
                label: t("STATS_KIND_RELEARN"),
                color: host.theme.relearn,
                cls: "is-relearn",
            },
            { field: "cram", label: t("STATS_KIND_CRAM"), color: host.theme.cram, cls: "is-cram" },
        ] as const;
        // A kind that never happened in this period would only clutter the key
        const shown = kinds.filter(
            (kind) => kind.field === "review" || rows.some((row) => row[kind.field] > 0),
        );
        createLegend(
            parts.body,
            shown.map((kind) => ({
                label: kind.label,
                cls: kind.cls,
                value: formatCount(rows.reduce((sum, row) => sum + row[kind.field], 0)),
            })),
        );
        chart = createBarChart(host, parts.body, {
            labels,
            series: shown.map((kind) => ({
                label: kind.label,
                data: rows.map((row) => row[kind.field]),
                color: kind.color,
            })),
            stacked: true,
            tooltipTitle: title,
            valueFormat: (value) => formatCount(Math.round(value)),
            ariaLabel: t(titleKey[report.dailyGranularity]),
        });
    };

    createSegmented(
        parts.actions,
        [
            { value: "count" as const, label: t("STATS_MODE_COUNT") },
            { value: "time" as const, label: t("STATS_MODE_TIME") },
        ],
        toggles.dailyMode,
        t("STATS_DAILY_TITLE_DAY"),
        (mode) => {
            toggles.dailyMode = mode;
            draw();
        },
    );
    if (report.daily.every((row) => row.total === 0)) {
        createNote(parts.body, t("STATS_NO_DATA"));
        return;
    }
    draw();
}

/**
 * Reviews and success rate for each hour of the day, with a toggle between the two.
 */
export function renderHourly(
    parent: HTMLElement,
    report: StatsReport,
    host: ChartHost,
    toggles: ViewToggles,
): void {
    const busiest = report.hourly.reduce((best, bucket) =>
        bucket.reviews > best.reviews ? bucket : best,
    );
    const parts = createCard(parent, t("STATS_HOURLY_TITLE"), {
        summary:
            busiest.reviews > 0 ? t("STATS_HOURLY_SUMMARY", { hour: `${busiest.hour}:00` }) : "",
    });

    let chart: Chart | null = null;
    const draw = (): void => {
        if (chart !== null) host.release(chart);
        parts.body.empty();
        const success = toggles.hourlyMode === "success";
        chart = createBarChart(host, parts.body, {
            labels: report.hourly.map((bucket) => String(bucket.hour)),
            series: [
                {
                    label: success ? t("STATS_MODE_SUCCESS") : t("STATS_MODE_REVIEWS"),
                    data: report.hourly.map((bucket) =>
                        success
                            ? bucket.successRate === null
                                ? null
                                : bucket.successRate * 100
                            : bucket.reviews,
                    ),
                    color: success ? host.theme.counts[4] : host.theme.review,
                },
            ],
            tooltipTitle: (index) => `${index}:00`,
            valueFormat: (value) =>
                success ? formatPercent(value / 100) : formatCount(Math.round(value)),
            yMax: success ? 100 : undefined,
            maxTicks: 12,
            ariaLabel: t("STATS_HOURLY_TITLE"),
        });
    };

    createSegmented(
        parts.actions,
        [
            { value: "reviews" as const, label: t("STATS_MODE_REVIEWS") },
            { value: "success" as const, label: t("STATS_MODE_SUCCESS") },
        ],
        toggles.hourlyMode,
        t("STATS_HOURLY_TITLE"),
        (mode) => {
            toggles.hourlyMode = mode;
            draw();
        },
    );
    if (busiest.reviews === 0) {
        createNote(parts.body, t("STATS_NO_DATA"));
        return;
    }
    draw();
}
