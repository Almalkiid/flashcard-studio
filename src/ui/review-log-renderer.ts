import "src/ui/review-log.css";

import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { ReviewLogStore } from "src/data/review-log/review-log-store";
import { formatAnswerTime, formatIntervalCompact } from "src/utils/format-interval";

const MAX_ROWS = 200;
const RATING_LABELS = ["Manual", "Again", "Hard", "Good", "Easy"];
const KIND_LABELS = ["Learn", "Review", "Relearn", "Cram", "Manual"];

/**
 * Renders the `srlog` code block of a review log file as a readable table instead of raw JSON lines.
 *
 * The code block source is everything after the opening fence, so it is parsed by prepending the fence.
 */
export function renderReviewLog(source: string, el: HTMLElement): void {
    const entries = ReviewLogStore.parseFile("```srlog\n" + source);
    const container = el.createDiv({ cls: "sr-review-log" });

    container.createDiv({
        cls: "sr-review-log-summary",
        text: `${entries.length} ${entries.length === 1 ? "review" : "reviews"}`,
    });
    if (entries.length === 0) return;

    const dateFormat = new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

    const table = container.createEl("table", { cls: "sr-review-log-table" });
    const headerRow = table.createEl("thead").createEl("tr");
    for (const heading of ["Date", "Card", "Rating", "Type", "Interval", "Time", "Deck"]) {
        headerRow.createEl("th", { text: heading });
    }

    const body = table.createEl("tbody");
    const newestFirst: ReviewLogEntry[] = entries.slice(-MAX_ROWS).reverse();
    for (const entry of newestFirst) {
        const row = body.createEl("tr");
        row.createEl("td", { text: dateFormat.format(new Date(entry.t)) });
        row.createEl("td", { text: entry.c, cls: "sr-review-log-card" });
        row.createEl("td", {
            text: RATING_LABELS[entry.r],
            cls: `sr-review-log-rating sr-rating-${entry.r}`,
        });
        row.createEl("td", { text: KIND_LABELS[entry.k] });
        row.createEl("td", { text: formatIntervalCompact(entry.ivl) });
        row.createEl("td", { text: formatAnswerTime(entry.ms) });
        row.createEl("td", { text: entry.dk });
    }

    if (entries.length > MAX_ROWS) {
        container.createDiv({
            cls: "sr-review-log-summary",
            text: `Showing the latest ${MAX_ROWS}.`,
        });
    }
}
