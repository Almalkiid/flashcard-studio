import { t } from "src/lang/translate";
import type { DeckStats } from "src/scheduling/review/deck-stats";

/** How many cards of a deck today's new-card and review limits hold back. */
export function hiddenByLimit(stats: DeckStats): number {
    return stats.newHiddenByLimitCount + stats.dueHiddenByLimitCount;
}

/** "3 hidden by today's limit", or an empty text when the limits hold nothing back. */
export function hiddenByLimitText(stats: DeckStats): string {
    const hidden = hiddenByLimit(stats);
    return hidden > 0 ? t("HIDDEN_BY_LIMIT", { count: hidden }) : "";
}

/** `text` followed by the note about the limit, when there is one. */
export function withHiddenNote(text: string, stats: DeckStats): string {
    const note = hiddenByLimitText(stats);
    return note === "" ? text : `${text} · ${note}`;
}
