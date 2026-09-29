import {
    ArcElement,
    BarController,
    BarElement,
    CategoryScale,
    Chart,
    ChartConfiguration,
    DoughnutController,
    LinearScale,
    Tooltip,
    TooltipItem,
} from "chart.js";

import { t } from "src/lang/helpers";
import { ChartTheme } from "src/ui/statistics-view/chart-theme";

// Only what the statistics view draws, so the bundle does not carry the rest of chart.js
Chart.register(
    BarController,
    BarElement,
    DoughnutController,
    ArcElement,
    CategoryScale,
    LinearScale,
    Tooltip,
);

/**
 * The charts of one render, so they can all be destroyed before the next one.
 */
export class ChartHost {
    readonly theme: ChartTheme;
    private readonly charts: Chart[] = [];
    private readonly animate: boolean;

    constructor(theme: ChartTheme, animate: boolean) {
        this.theme = theme;
        this.animate = animate;
    }

    add(chart: Chart): void {
        this.charts.push(chart);
    }

    get animation(): false | { duration: number } {
        return this.animate ? { duration: 350 } : false;
    }

    /** Destroys one chart, for a card that redraws itself. */
    release(chart: Chart): void {
        chart.destroy();
        const index = this.charts.indexOf(chart);
        if (index >= 0) this.charts.splice(index, 1);
    }

    destroyAll(): void {
        for (const chart of this.charts) chart.destroy();
        this.charts.length = 0;
    }
}

export interface BarSeries {
    label: string;
    data: (number | null)[];
    color: string;
    /** Overrides the colour of single bars, e.g. to mark overdue cards. */
    pointColors?: string[];
}

export interface BarChartSpec {
    labels: string[];
    series: BarSeries[];
    stacked?: boolean;
    /** Text above the tooltip's values for the bar at this index. */
    tooltipTitle: (index: number) => string;
    /** Formats a value for the tooltip and the y axis. */
    valueFormat: (value: number) => string;
    /** Extra text for the tooltip label of a value, replacing `Series: value`. */
    tooltipLabel?: (seriesIndex: number, value: number) => string;
    yMax?: number;
    ariaLabel: string;
    /** The most labels shown on the x axis. */
    maxTicks?: number;
}

function applyGlobalStyle(theme: ChartTheme): void {
    Chart.defaults.font.family = theme.fontFamily;
    Chart.defaults.font.size = 11;
    Chart.defaults.color = theme.text;
}

function tooltipStyle(theme: ChartTheme) {
    return {
        backgroundColor: theme.tooltipBackground,
        titleColor: theme.tooltipText,
        bodyColor: theme.tooltipText,
        footerColor: theme.tooltipText,
        borderColor: theme.tooltipBorder,
        borderWidth: 1,
        padding: 8,
        cornerRadius: 6,
        boxPadding: 4,
        usePointStyle: true,
    };
}

/**
 * Draws a bar chart, thin bars with rounded ends, in a fixed height box inside `parent`.
 */
export function createBarChart(host: ChartHost, parent: HTMLElement, spec: BarChartSpec): Chart {
    const { theme } = host;
    applyGlobalStyle(theme);

    const box = parent.createDiv({ cls: "sr-stats-chart" });
    const canvas = box.createEl("canvas", {
        attr: { role: "img", "aria-label": spec.ariaLabel },
    });

    const stacked = spec.stacked === true;
    const config: ChartConfiguration<"bar"> = {
        type: "bar",
        data: {
            labels: spec.labels,
            datasets: spec.series.map((series) => {
                const colors = series.pointColors ?? series.color;
                return {
                    label: series.label,
                    data: series.data,
                    backgroundColor: colors,
                    hoverBackgroundColor: colors,
                    borderColor: theme.surface,
                    borderWidth: stacked ? 1 : 0,
                    borderRadius: 3,
                    borderSkipped: "bottom" as const,
                    maxBarThickness: 22,
                    categoryPercentage: 0.92,
                    barPercentage: 0.82,
                };
            }),
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: host.animation,
            interaction: { mode: "index", intersect: false },
            layout: { padding: { top: 6 } },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...tooltipStyle(theme),
                    callbacks: {
                        title: (items: TooltipItem<"bar">[]) =>
                            items.length > 0 ? spec.tooltipTitle(items[0].dataIndex) : "",
                        label: (item: TooltipItem<"bar">) => {
                            const value = item.parsed.y ?? 0;
                            return spec.tooltipLabel
                                ? spec.tooltipLabel(item.datasetIndex, value)
                                : `${item.dataset.label ?? ""}: ${spec.valueFormat(value)}`;
                        },
                        footer: (items: TooltipItem<"bar">[]) => {
                            if (!stacked || items.length < 2) return "";
                            const total = items.reduce(
                                (sum, item) => sum + (item.parsed.y ?? 0),
                                0,
                            );
                            return `${t("STATS_TOTAL")}: ${spec.valueFormat(total)}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    stacked,
                    grid: { display: false },
                    border: { display: false },
                    ticks: {
                        color: theme.text,
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: spec.maxTicks ?? 8,
                    },
                },
                y: {
                    stacked,
                    beginAtZero: true,
                    max: spec.yMax,
                    grid: { color: theme.grid },
                    border: { display: false },
                    ticks: {
                        color: theme.text,
                        maxTicksLimit: 5,
                        precision: 0,
                        callback: (value: string | number) => spec.valueFormat(Number(value)),
                    },
                },
            },
        },
    };

    const chart = new Chart(canvas, config);
    host.add(chart);
    return chart;
}

export interface DoughnutSlice {
    label: string;
    value: number;
    color: string;
}

/**
 * Draws a doughnut chart in a square box inside `parent`.
 */
export function createDoughnut(
    host: ChartHost,
    parent: HTMLElement,
    slices: DoughnutSlice[],
    ariaLabel: string,
    tooltipLabel: (slice: DoughnutSlice) => string,
): Chart {
    const { theme } = host;
    applyGlobalStyle(theme);

    const box = parent.createDiv({ cls: "sr-stats-donut-canvas" });
    const canvas = box.createEl("canvas", { attr: { role: "img", "aria-label": ariaLabel } });

    const config: ChartConfiguration<"doughnut"> = {
        type: "doughnut",
        data: {
            labels: slices.map((slice) => slice.label),
            datasets: [
                {
                    data: slices.map((slice) => slice.value),
                    backgroundColor: slices.map((slice) => slice.color),
                    hoverBackgroundColor: slices.map((slice) => slice.color),
                    borderColor: theme.surface,
                    borderWidth: 2,
                    hoverOffset: 3,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "72%",
            animation: host.animation,
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...tooltipStyle(theme),
                    callbacks: {
                        title: () => "",
                        label: (item: TooltipItem<"doughnut">) =>
                            tooltipLabel(slices[item.dataIndex]),
                    },
                },
            },
        },
    };

    const chart = new Chart(canvas, config);
    host.add(chart);
    return chart;
}
