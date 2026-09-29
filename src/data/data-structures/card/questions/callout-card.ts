// Callout cards: a callout whose type is one of the configured card types (by default `flashcard`,
// `question` and `card`) is a card. The callout title is the front and the callout body, without its
// `> ` prefixes, is the back:
//
//      > [!question]- What is the capital of France?
//      > Paris
//      <!--SR:!2026-10-01,4,270-->
//
// The idea of a callout card comes from the closed upstream PR #1283 (an account that was later
// deleted); this is an independent implementation, written to be safe for existing notes.
//
// This is a leaf module (it imports nothing), so the parser and the card expansion can both use it.

/** `> [!type]`, `> [!type]-`, `> [!type]+ Title` and `> [!type|metadata] Title`. */
const CALLOUT_HEADER_REGEX = /^ {0,3}>[ \t]?\[!([^\]|\s]+)(?:\|[^\]]*)?\]([+-])?(?:[ \t]+(.*))?$/;

/** Any line of a blockquote (and therefore of a callout). Obsidian allows up to 3 spaces of indent. */
const BLOCKQUOTE_LINE_REGEX = /^ {0,3}>/;

/** One level of blockquote marker: the `>` and the single space that normally follows it. */
const BLOCKQUOTE_PREFIX_REGEX = /^ {0,3}>[ \t]?/;

const SR_METADATA_CALLOUT_HEADER_REGEX = /^ {0,3}>[ \t]?\[!sr\|card-metadata\]/;

export interface CalloutHeader {
    /** The callout type as written, e.g. `question`. */
    type: string;
    /** `-` (folded), `+` (unfolded) or an empty string. */
    fold: string;
    /** The callout title, trimmed. Empty when the callout has none. */
    title: string;
}

export interface CalloutCardText {
    front: string;
    back: string;
}

/**
 * Normalises a user supplied list of callout types: trimmed, lower case (Obsidian callout types are
 * case insensitive), without a leading `!` or surrounding brackets, no blanks and no duplicates.
 */
export function normalizeCalloutTypes(types: readonly string[] | undefined | null): string[] {
    const result: string[] = [];
    for (const raw of types ?? []) {
        const type = String(raw)
            .trim()
            .replace(/^\[?!?/, "")
            .replace(/\]$/, "")
            .toLowerCase();
        if (type.length > 0 && !result.includes(type)) result.push(type);
    }
    return result;
}

/**
 * Parses the first line of a callout.
 *
 * @returns The header, or null when the line is not the start of a callout.
 */
export function parseCalloutHeader(line: string): CalloutHeader | null {
    const match = CALLOUT_HEADER_REGEX.exec(line);
    if (!match) return null;
    return { type: match[1], fold: match[2] ?? "", title: (match[3] ?? "").trim() };
}

/** Whether the line belongs to a blockquote or callout (starts with `>`). */
export function isBlockquoteLine(line: string): boolean {
    return BLOCKQUOTE_LINE_REGEX.test(line);
}

/** Removes exactly one level of blockquote marker. Nested callouts keep their own `>`. */
export function stripBlockquotePrefix(line: string): string {
    return line.replace(BLOCKQUOTE_PREFIX_REGEX, "");
}

/**
 * Splits the text of a callout card into front and back.
 *
 * The scheduling comment, and the `sr|card-metadata` callout the plugin can put it in, are not part of
 * either side.
 *
 * @param text - The callout card text, with its `> ` prefixes and without the scheduling comment.
 * @returns The front and back, or null when the text is not a callout card.
 */
export function splitCalloutCard(text: string): CalloutCardText | null {
    const lines = text.split("\n");
    const header = parseCalloutHeader(lines[0]);
    if (!header) return null;

    let bodyLines = lines.slice(1).filter((line) => !isScheduleOnlyLine(line));

    // Drop the plugin's own metadata callout and everything after it
    const metadataIdx = bodyLines.findIndex((line) => SR_METADATA_CALLOUT_HEADER_REGEX.test(line));
    if (metadataIdx >= 0) bodyLines = bodyLines.slice(0, metadataIdx);

    const back = bodyLines.map(stripBlockquotePrefix).join("\n").trim();
    return { front: header.title, back };
}

/**
 * Whether a line is only a scheduling comment (that is `<!--SR:...-->`, optionally inside a callout).
 */
function isScheduleOnlyLine(line: string): boolean {
    return /^(?: {0,3}>[ \t]*)?<!--SR:.*-->\s*$/.test(line);
}

/**
 * Whether the callout at lines[start..end] is a usable card: it has a title and a non-empty body.
 */
export function isCompleteCalloutCard(lines: readonly string[]): boolean {
    const card = splitCalloutCard(lines.join("\n"));
    return card !== null && card.front.length > 0 && card.back.length > 0;
}
