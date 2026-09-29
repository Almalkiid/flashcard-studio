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

interface StatSpec {
    label: string;
    value: string;
    key: string;
    hero?: boolean;
}

function createStat(parent: HTMLElement, spec: StatSpec): void {
    const stat = parent.createDiv({ cls: "sr-stats-stat" });
    stat.createDiv({ cls: "sr-stats-stat-label", text: spec.label });
    const value = stat.createDiv({
        cls: "sr-stats-stat-value",
        text: spec.value,
        attr: { "data-stat": spec.key },
    });
    if (spec.hero) value.addClass("is-hero");
}

/**
 * The two cards on top: what was done today, and the streak.
 */
export function renderHero(parent: HTMLElement, report: StatsReport): void {
    const hero = parent.createDiv({ cls: "sr-stats-hero" });

    const today = hero.createDiv({ cls: "sr-stats-card sr-stats-hero-card sr-stats-today" });
    const todayHead = today.createDiv({ cls: "sr-stats-hero-head" });
    setIcon(todayHead.createDiv({ cls: "sr-stats-hero-icon" }), "calendar-check");
    todayHead.createEl("h3", { cls: "sr-stats-card-title", text: t("STATS_TODAY") });
    const todayGrid = today.createDiv({ cls: "sr-stats-stat-grid" });
    createStat(todayGrid, {
        label: t("STATS_REVIEWS"),
        value: formatCount(report.today.reviews),
        key: "reviews",
        hero: true,
    });
    createStat(todayGrid, {
        label: t("STATS_TIME"),
        value: formatDuration(report.today.timeMs),
        key: "time",
    });
    createStat(todayGrid, {
        label: t("STATS_RETENTION"),
        value: formatPercent(report.today.retention),
        key: "retention",
    });
    createStat(todayGrid, {
        label: t("STATS_NEW_CARDS"),
        value: formatCount(report.today.newLearned),
        key: "new",
    });

    const streak = hero.createDiv({ cls: "sr-stats-card sr-stats-hero-card sr-stats-streak" });
    const streakHead = streak.createDiv({ cls: "sr-stats-hero-head" });
    const flame = streakHead.createDiv({ cls: "sr-stats-hero-icon" });
    if (report.streak.current > 0) flame.addClass("is-lit");
    setIcon(flame, "flame");
    streakHead.createEl("h3", { cls: "sr-stats-card-title", text: t("STATS_STREAK") });
    const streakValue = streak.createDiv({ cls: "sr-stats-streak-value" });
    streakValue.createSpan({
        cls: "sr-stats-stat-value is-hero",
        text: formatCount(report.streak.current),
        attr: { "data-stat": "streak" },
    });
    streakValue.createSpan({
        cls: "sr-stats-streak-unit",
        text: report.streak.current === 1 ? t("STATS_UNIT_DAY") : t("STATS_UNIT_DAYS"),
    });
    const streakGrid = streak.createDiv({ cls: "sr-stats-stat-grid is-compact" });
    createStat(streakGrid, {
        label: t("STATS_STREAK_LONGEST"),
        value: daysLabel(report.streak.longest),
        key: "longest",
    });
    createStat(streakGrid, {
        label: t("STATS_DAYS_STUDIED"),
        value: formatCount(report.streak.activeDays),
        key: "days-studied",
    });
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
            shown.map((kind) => ({ label: kind.label, cls: kind.cls })),
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
