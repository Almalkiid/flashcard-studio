import { t } from "src/lang/helpers";
import { Heatmap } from "src/stats/activity";
import { createCard } from "src/ui/statistics-view/dom";
import {
    daysLabel,
    formatDayLong,
    formatMonthShort,
    formatWeekdayShort,
    reviewsLabel,
} from "src/ui/statistics-view/format";

const CELL = 11;
const GAP = 3;
const PITCH = CELL + GAP;
const LEFT = 30;
const TOP = 18;

/**
 * Draws the GitHub style calendar: one column per week, one row per weekday, each day coloured by how many reviews
 * it had. On a narrow pane the grid keeps its size and scrolls sideways, starting at today.
 *
 * @param weekStart - The first day of the week, so the rows are labelled in the right order.
 */
export function renderHeatmap(parent: HTMLElement, map: Heatmap, weekStart: number): void {
    const parts = createCard(parent, t("STATS_HEATMAP_TITLE"), {
        wide: true,
        cls: "sr-stats-heat-card",
        section: "heatmap",
        summary: t("STATS_HEATMAP_SUMMARY", {
            reviews: reviewsLabel(map.total),
            days: daysLabel(map.activeDays),
        }),
    });

    const weeks = map.cells.length === 0 ? 0 : map.cells[map.cells.length - 1].week + 1;
    const width = LEFT + weeks * PITCH - GAP;
    const height = TOP + 7 * PITCH - GAP;

    const scroller = parts.body.createDiv({ cls: "sr-stats-heat-scroll" });
    const svg = scroller.createSvg("svg", {
        cls: "sr-stats-heat",
        attr: {
            viewBox: `0 0 ${width} ${height}`,
            role: "img",
            "aria-label": t("STATS_HEATMAP_TITLE"),
        },
    });
    // The grid never shrinks below its natural size; the card scrolls instead
    svg.setCssProps({ "--sr-stats-heat-min": `${width}px` });

    for (const label of map.monthLabels) {
        const text = svg.createSvg("text", {
            cls: "sr-stats-heat-label",
            attr: { x: LEFT + label.week * PITCH, y: 10 },
        });
        text.textContent = formatMonthShort(label.month);
    }
    // Label every second row, like GitHub, so the labels never touch
    for (const row of [1, 3, 5]) {
        const text = svg.createSvg("text", {
            cls: "sr-stats-heat-label",
            attr: { x: 0, y: TOP + row * PITCH + CELL - 1 },
        });
        text.textContent = formatWeekdayShort((weekStart + row) % 7);
    }

    for (const cell of map.cells) {
        svg.createSvg("rect", {
            cls: "sr-stats-heat-cell",
            attr: {
                x: LEFT + cell.week * PITCH,
                y: TOP + cell.row * PITCH,
                width: CELL,
                height: CELL,
                rx: 2.5,
                "data-day": cell.day,
                "data-count": cell.count,
                "data-level": cell.level,
            },
        });
    }

    const legend = parts.body.createDiv({ cls: "sr-stats-heat-legend" });
    legend.createSpan({ text: t("STATS_LESS") });
    const swatches = legend.createSpan({ cls: "sr-stats-heat-swatches" });
    for (let level = 0; level <= 4; level++) {
        swatches.createSpan({ cls: "sr-stats-heat-swatch", attr: { "data-level": level } });
    }
    legend.createSpan({ text: t("STATS_MORE") });

    const tooltip = parts.card.createDiv({ cls: "sr-stats-tooltip", attr: { role: "tooltip" } });
    attachTooltip(parts.card, svg, tooltip);

    // Show the newest weeks first. The pane may be hidden while it renders, so wait until it has a width
    const scrollToToday = (): void => {
        scroller.scrollLeft = scroller.scrollWidth;
    };
    scrollToToday();
    const observer = new ResizeObserver(() => {
        if (scroller.clientWidth === 0) return;
        scrollToToday();
        observer.disconnect();
    });
    observer.observe(scroller);
}

/**
 * Shows "12 reviews on Mon 29 Sep" above a day, on hover with a mouse and on tap with a finger.
 */
function attachTooltip(card: HTMLElement, svg: SVGElement, tooltip: HTMLElement): void {
    const show = (cell: Element): void => {
        const day = cell.getAttribute("data-day") ?? "";
        const count = Number(cell.getAttribute("data-count") ?? "0");
        const date = formatDayLong(day);
        tooltip.setText(
            count === 0
                ? t("STATS_HEATMAP_TOOLTIP_NONE", { date })
                : t("STATS_HEATMAP_TOOLTIP", { reviews: reviewsLabel(count), date }),
        );

        const cardBox = card.getBoundingClientRect();
        const cellBox = cell.getBoundingClientRect();
        // Keep the tooltip inside the card, which clips nothing but looks wrong when it overflows
        const half = tooltip.offsetWidth / 2;
        const centre = cellBox.left - cardBox.left + cellBox.width / 2;
        const clamped = Math.min(Math.max(centre, half + 4), cardBox.width - half - 4);
        tooltip.setCssProps({
            left: `${clamped}px`,
            top: `${cellBox.top - cardBox.top}px`,
        });
        tooltip.addClass("is-visible");
        svg.querySelector(".is-selected")?.removeClass("is-selected");
        cell.addClass("is-selected");
    };
    const hide = (): void => {
        tooltip.removeClass("is-visible");
        svg.querySelector(".is-selected")?.removeClass("is-selected");
    };

    svg.addEventListener("pointerover", (event: PointerEvent) => {
        if (event.pointerType === "touch") return;
        const target = event.target as Element;
        if (target.hasClass("sr-stats-heat-cell")) show(target);
    });
    svg.addEventListener("pointerleave", (event: PointerEvent) => {
        if (event.pointerType !== "touch") hide();
    });
    svg.addEventListener("click", (event: MouseEvent) => {
        const target = event.target as Element;
        if (target.hasClass("sr-stats-heat-cell")) show(target);
        else hide();
    });
    // A tap anywhere else in the card closes the tooltip
    card.addEventListener("click", (event: MouseEvent) => {
        if (!svg.contains(event.target as Node)) hide();
    });
}
