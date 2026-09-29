import { FSRS_COMMENT_PREFIX } from "src/scheduling/algorithms/fsrs/fsrs-helpers";

/**
 * Per-card metadata stored as extra tokens after a schedule segment in the `<!--SR:...-->` comment.
 *
 * Upstream's comment parser reads a fixed number of fields per segment and ignores the rest, so these
 * tokens are invisible to it: `!fsrs,<10 fields>,id=k3f9a2,susp,bury=2026-10-01,flag=3,leech`.
 *
 * @property {string | null} id - Stable card id, assigned the first time a comment is written for the card.
 * @property {boolean} suspended - Suspended cards are never shown until unsuspended.
 * @property {string | null} buryUntil - `YYYY-MM-DD`; the card is hidden before this day.
 * @property {number} flag - 0 for none, 1 to 7 for Anki's flag colours.
 * @property {boolean} leech - Marked as a leech after too many lapses.
 * @property {string[]} extras - Unknown tokens, preserved verbatim on rewrite.
 */
export interface CardMeta {
    id: string | null;
    suspended: boolean;
    buryUntil: string | null;
    flag: number;
    leech: boolean;
    extras: string[];
}

const FSRS_FIXED_FIELDS = 10;
const SM2_FIXED_FIELDS = 3;
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const ID_PATTERN = /^[0-9a-z]{1,16}$/;
const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function emptyCardMeta(): CardMeta {
    return { id: null, suspended: false, buryUntil: null, flag: 0, leech: false, extras: [] };
}

/**
 * Whether the metadata carries anything that must be written to the note, even for a card that has never been reviewed.
 * A bare id does not count: new cards only get an id once something else needs storing.
 */
export function hasPersistentMeta(meta: CardMeta): boolean {
    return (
        meta.suspended ||
        meta.buryUntil !== null ||
        meta.flag > 0 ||
        meta.leech ||
        meta.extras.length > 0
    );
}

/**
 * @param todayYmd - Today's date as `YYYY-MM-DD`, after applying the day boundary.
 */
export function isBuried(meta: CardMeta, todayYmd: string): boolean {
    return meta.buryUntil !== null && todayYmd < meta.buryUntil;
}

/**
 * Parses the metadata tokens of one schedule segment.
 *
 * @param segment - The segment text without the leading `!`, e.g. `fsrs,...` or `2026-10-06,7,250`.
 */
export function parseSegmentMeta(segment: string): CardMeta {
    const fields = segment.trim().split(",");
    const fixedFieldCount =
        fields[0] === FSRS_COMMENT_PREFIX ? FSRS_FIXED_FIELDS : SM2_FIXED_FIELDS;
    const meta = emptyCardMeta();

    for (const rawToken of fields.slice(fixedFieldCount)) {
        const token = rawToken.trim();
        if (token.length === 0) continue;

        if (token === "susp") {
            meta.suspended = true;
        } else if (token === "leech") {
            meta.leech = true;
        } else if (token.startsWith("id=") && ID_PATTERN.test(token.slice(3))) {
            meta.id = token.slice(3);
        } else if (token.startsWith("flag=") && /^[1-7]$/.test(token.slice(5))) {
            meta.flag = Number(token.slice(5));
        } else if (token.startsWith("bury=") && YMD_PATTERN.test(token.slice(5))) {
            meta.buryUntil = token.slice(5);
        } else {
            meta.extras.push(token);
        }
    }
    return meta;
}

/**
 * Parses the metadata of every segment in a question's schedule comment, aligned by segment index.
 *
 * @param questionText - The original question text, including the `<!--SR:...-->` comment if present.
 * @returns One entry per segment, or an empty list when there is no comment.
 */
export function parseCommentMeta(questionText: string): CardMeta[] {
    const comment = questionText.match(/<!--SR:(.+?)-->/m)?.[1];
    if (!comment) return [];

    return comment
        .split("!")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0)
        .map((segment) => parseSegmentMeta(segment));
}

/**
 * Formats metadata as the tokens to append after a schedule segment.
 *
 * @returns An empty string, or the tokens with a leading comma, e.g. `,id=abc123,susp`.
 */
export function formatMetaTokens(meta: CardMeta): string {
    const tokens: string[] = [];
    if (meta.id) tokens.push(`id=${meta.id}`);
    if (meta.suspended) tokens.push("susp");
    if (meta.buryUntil) tokens.push(`bury=${meta.buryUntil}`);
    if (meta.flag > 0) tokens.push(`flag=${meta.flag}`);
    if (meta.leech) tokens.push("leech");
    tokens.push(...meta.extras);
    return tokens.length > 0 ? "," + tokens.join(",") : "";
}

/**
 * Generates a random 6 character base36 card id (about 2.2 billion possibilities).
 */
export function generateCardId(): string {
    const bytes = new Uint8Array(6);
    window.crypto.getRandomValues(bytes);
    let id = "";
    for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length];
    return id;
}

export function cloneCardMeta(meta: CardMeta): CardMeta {
    return { ...meta, extras: [...meta.extras] };
}

/**
 * Removes the tokens matching `shouldRemove` from every segment of every `<!--SR:...-->` comment in a note,
 * leaving all other text byte-identical. Only tokens after a segment's fixed fields are considered.
 */
function removeMetaTokensInText(text: string, shouldRemove: (token: string) => boolean): string {
    return text.replace(/<!--SR:(.+?)-->/g, (_match: string, comment: string) => {
        const segments = comment.split("!").map((segment) => {
            if (segment.length === 0) return segment;
            const fields = segment.split(",");
            const fixedFieldCount =
                fields[0] === FSRS_COMMENT_PREFIX ? FSRS_FIXED_FIELDS : SM2_FIXED_FIELDS;
            const fixed = fields.slice(0, fixedFieldCount);
            const tokens = fields.slice(fixedFieldCount).filter((token) => !shouldRemove(token));
            return [...fixed, ...tokens].join(",");
        });
        return `<!--SR:${segments.join("!")}-->`;
    });
}

/** Unsuspends every card in a note's text. */
export function unsuspendAllInText(text: string): string {
    return removeMetaTokensInText(text, (token) => token === "susp");
}

/** Unburies every card in a note's text. */
export function unburyAllInText(text: string): string {
    return removeMetaTokensInText(text, (token) => token.startsWith("bury="));
}
