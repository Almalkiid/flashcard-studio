/**
 * Texts and patterns of the stored formats: the schedule comment in a card's note, the card metadata callout, the
 * dates the notes are written with and the tab view's name. Their values are stored in users' notes and layouts and
 * must not change.
 *
 * The patterns with the `g` flag keep a position between calls: use them with `matchAll`, `replace` and `replaceAll`,
 * never with `test` or `exec`.
 */

// The schedule-comment and frontmatter format shared with the Spaced Repetition plugin, kept so existing schedules carry over.
/** A schedule comment with the space or line break before it, for taking it out of a card's text. */
export const SCHEDULE_COMMENT_AND_SPACE_FINDER = /\s?<!--SR:!.+?-->/g;
/** The first schedule segments of an SM-2 comment. */
export const SM2_SCHEDULE_INFO_EXTRACTOR = /<!--SR:!(.+?),(\d+),(\d+),*(\d+)*-->/gm;
/** One `!date,interval,ease` segment of a comment with several. */
export const MULTI_SCHEDULING_EXTRACTOR = /!([\d-]+),(\d+),(\d+)/gm;
/** A tag at the start of a line. */
export const OBSIDIAN_TAG_AT_STARTOFLINE_REGEX = /^#[^\s#]+/gi;
/** A block id at the end of a line, with the space before it. */
export const OBSIDIAN_BLOCK_ID_ENDOFLINE_REGEX = / (\^[a-zA-Z0-9-]+)$/;

export const SCHEDULE_COMMENT_PREFIX = "<!--SR:";
export const SCHEDULE_COMMENT_SUFFIX = "-->";
/** The first line of the callout that holds card metadata. */
export const CARD_METADATA_CALLOUT = "> [!sr|card-metadata]";

/** How dates are written (and the other forms that are read). */
export const PREFERRED_DATE_FORMAT = "YYYY-MM-DD";
export const ALLOWED_DATE_FORMATS = [PREFERRED_DATE_FORMAT, "DD-MM-YYYY", "ddd MMM DD YYYY"];

/** A day in milliseconds. Days are counted without regard to clock changes. */
export const TICKS_PER_DAY = 24 * 3600 * 1000;

/** The view type of the review tab, stored in Obsidian's workspace layout. */
export const STUDIO_TAB_VIEW = "flashcard-studio-tab-view";
