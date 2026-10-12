import { PRODUCT_NAME } from "src/data/product";
import { t } from "src/lang/translate";

export type StatusItemKind = "cards" | "notes" | "update";

export interface StatusBarInput {
    /** The status bar setting as a whole. */
    show: boolean;
    showCards: boolean;
    showNotes: boolean;
    showUpdate: boolean;
    cardsDue: number;
    notesDue: number;
    updateAvailable: boolean;
}

export interface StatusItemState {
    visible: boolean;
    text: string;
}

/** What each status bar item shows. The card and note items appear only while something is due. */
export function statusItemStates(input: StatusBarInput): Record<StatusItemKind, StatusItemState> {
    return {
        cards: {
            visible: input.show && input.showCards && input.cardsDue > 0,
            text: t("STATUS_CARDS_DUE", { count: input.cardsDue }),
        },
        notes: {
            visible: input.show && input.showNotes && input.notesDue > 0,
            text: t("STATUS_NOTES_DUE", { count: input.notesDue }),
        },
        update: {
            visible: input.show && input.showUpdate && input.updateAvailable,
            text: t("STATUS_UPDATE", { name: PRODUCT_NAME }),
        },
    };
}

function numbersOf(version: string): number[] {
    return version
        .trim()
        .replace(/^v/i, "")
        .split(/[-+]/)[0]
        .split(".")
        .map((part) => parseInt(part, 10));
}

/**
 * Whether `latest` is a later version than `installed`, comparing their dotted numbers ("1.4.0" against "v1.10.2").
 * A tag that is not a version, or equal versions, are not newer, so the indicator never shows for an installed build
 * that is ahead of the latest release.
 */
export function isNewerVersion(latest: string, installed: string): boolean {
    const a = numbersOf(latest);
    const b = numbersOf(installed);
    if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const difference = (a[i] ?? 0) - (b[i] ?? 0);
        if (difference !== 0) return difference > 0;
    }
    return false;
}
