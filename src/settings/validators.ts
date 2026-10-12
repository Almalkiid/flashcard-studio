import { parseFsrsSteps, parseFsrsWeights } from "src/scheduling/fsrs/fsrs-settings";
import { parseStartOfDay } from "src/utils/start-of-day";

/** Desired retention allowed on the settings screen, in percent. A stored value outside it is kept and flagged, never changed. */
export const RETENTION_MIN_PERCENT = 70;
export const RETENTION_MAX_PERCENT = 99;

const EMPTY = "Can't be empty.";
const DUPLICATE = "Already in the list.";

export function wholeNumberError(value: number, min: number, max: number): string | undefined {
    if (!Number.isInteger(value)) return "Use a whole number.";
    if (value < min || value > max) return `Use a number from ${min} to ${max}.`;
    return undefined;
}

export function decimalRangeError(value: number, min: number, max: number): string | undefined {
    if (!Number.isFinite(value) || value < min || value > max)
        return `Use a value from ${min} to ${max}.`;
    return undefined;
}

export function parseTagList(text: string): string[] {
    const tags: string[] = [];
    for (const tag of text.split(/\s+/)) if (tag.length > 0 && !tags.includes(tag)) tags.push(tag);
    return tags;
}

export function tagListError(text: string): string | undefined {
    const bad = parseTagList(text).some((tag) => !/^#[^#\s]+$/.test(tag));
    return bad ? "Tags start with #, such as #flashcards." : undefined;
}

export function separatorError(value: string, others: string[]): string | undefined {
    if (value.trim().length === 0) return EMPTY;
    if (others.includes(value)) return "Another card type already uses this.";
    return undefined;
}

const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

export function startOfDayError(text: string): string | undefined {
    const ok = TIME.test(text.trim()) && parseStartOfDay(text) !== null;
    return ok ? undefined : "Use 24-hour time, such as 04:00.";
}

/** Call only with text that passed startOfDayError. The scheduler reads exactly three parts. */
export function normalizeStartOfDay(text: string): string {
    const [, hour, minute, second] = TIME.exec(text.trim());
    return [hour, minute, second ?? "00"].map((part) => part.padStart(2, "0")).join(":");
}

export function stepsError(text: string): string | undefined {
    return parseFsrsSteps(text) === null ? "Use steps such as 1m 10m 1h 1d." : undefined;
}

export function weightsError(text: string, relearningSteps: string): string | undefined {
    const count = (parseFsrsSteps(relearningSteps) ?? []).length;
    const { error } = parseFsrsWeights(text, count);
    return error === null ? undefined : `These are not FSRS parameters: ${error}`;
}

/** Keeps the stored weekday list safe when it is edited by the easy-days controls or data.json. */
export function normalizeEasyDays(days: readonly number[]): number[] {
    return [...new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort(
        (left, right) => left - right,
    );
}

export function urlError(text: string): string | undefined {
    const value = text.trim();
    if (value === "" || /^https?:\/\//i.test(value)) return undefined;
    return "Start with http:// or https://.";
}

export function nonEmptyError(text: string): string | undefined {
    return text.trim().length === 0 ? EMPTY : undefined;
}

export function listEntryError(value: string, existing: readonly string[]): string | undefined {
    if (value.trim().length === 0) return EMPTY;
    if (existing.includes(value.trim())) return DUPLICATE;
    return undefined;
}

/** Whether a skipped-folder pattern starts with !, which turns the glob around so it skips every other folder. */
export function isNegatedFolderPattern(pattern: string): boolean {
    return pattern.startsWith("!");
}

/** A skipped folder or pattern. A leading ! would turn the glob around and skip every other folder. */
export function skippedFolderError(value: string, existing: readonly string[]): string | undefined {
    const listError = listEntryError(value, existing);
    if (listError !== undefined) return listError;
    if (isNegatedFolderPattern(value.trim()))
        return "Patterns starting with ! would skip every other folder.";
    return undefined;
}

export function clozePatternError(value: string, existing: readonly string[]): string | undefined {
    const listError = listEntryError(value, existing);
    if (listError !== undefined) return listError;
    if (!value.includes("answer")) return "A pattern needs the word answer where the answer goes.";
    return undefined;
}

export function normalizeVaultFolder(text: string, fallback: string): string {
    const path = text
        .trim()
        .replace(/\\/g, "/")
        .replace(/\/{2,}/g, "/")
        .replace(/^\/+|\/+$/g, "");
    return path === "" ? fallback : path;
}
