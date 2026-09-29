/**
 * Colours for the charts. They are read from CSS custom properties of the statistics view at render time; the view's
 * stylesheet maps each one to a Flashcard Studio token (`--fs-*`), so the charts follow the light or dark Obsidian
 * theme and redraw in its colours. Nothing here is a colour value.
 */
export interface ChartTheme {
    fontFamily: string;
    /** Axis labels. */
    text: string;
    /** Chart gridlines. */
    grid: string;
    /** The card background; used to separate touching bars and slices with a thin gap. */
    surface: string;
    accent: string;
    tooltipBackground: string;
    tooltipText: string;
    tooltipBorder: string;
    learn: string;
    review: string;
    relearn: string;
    cram: string;
    overdue: string;
    /** One colour per card count slice: new, learning, relearning, young, mature, suspended, buried. */
    counts: string[];
}

const PROPERTY_NAMES = [
    "text",
    "grid",
    "surface",
    "accent",
    "tooltip-bg",
    "tooltip-text",
    "tooltip-border",
    "learn",
    "review",
    "relearn",
    "cram",
    "overdue",
    "count-new",
    "count-learning",
    "count-relearning",
    "count-young",
    "count-mature",
    "count-suspended",
    "count-buried",
] as const;

type PropertyName = (typeof PROPERTY_NAMES)[number];

/**
 * Turns any CSS colour the browser understands into an `rgb()`, `rgba()` or hex string that chart.js can parse.
 * Custom properties can hold values such as `color-mix(...)` that chart.js cannot read but a canvas can.
 */
function resolveColor(context: CanvasRenderingContext2D | null, value: string): string {
    if (context === null) return value;
    // An invalid colour leaves fillStyle unchanged, so try against two different starting values
    context.fillStyle = "#000000";
    context.fillStyle = value;
    const first = context.fillStyle;
    context.fillStyle = "#ffffff";
    context.fillStyle = value;
    return first === context.fillStyle ? first : value;
}

/**
 * Reads the theme colours from the computed style of `root`, which must define the `--sr-stats-c-*` properties.
 */
export function readChartTheme(root: HTMLElement): ChartTheme {
    const style = getComputedStyle(root);
    const canvas = createEl("canvas");
    const context = canvas.getContext("2d");

    const colors = {} as Record<PropertyName, string>;
    for (const name of PROPERTY_NAMES) {
        colors[name] = resolveColor(context, style.getPropertyValue(`--sr-stats-c-${name}`).trim());
    }

    return {
        fontFamily: style.fontFamily,
        text: colors.text,
        grid: colors.grid,
        surface: colors.surface,
        accent: colors.accent,
        tooltipBackground: colors["tooltip-bg"],
        tooltipText: colors["tooltip-text"],
        tooltipBorder: colors["tooltip-border"],
        learn: colors.learn,
        review: colors.review,
        relearn: colors.relearn,
        cram: colors.cram,
        overdue: colors.overdue,
        counts: [
            colors["count-new"],
            colors["count-learning"],
            colors["count-relearning"],
            colors["count-young"],
            colors["count-mature"],
            colors["count-suspended"],
            colors["count-buried"],
        ],
    };
}
