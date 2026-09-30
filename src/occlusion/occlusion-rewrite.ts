import { SR_METADATA_CALLOUT } from "src/data/constants";
import { SRSettings } from "src/data/settings";
import {
    closingFenceLine,
    formatOcclusionBlock,
    isOcclusionFenceStart,
    OcclusionBlock,
    parseOcclusionBlock,
} from "src/occlusion/occlusion-block";
import { SRAlgorithmType } from "src/scheduling/algorithms/base/isr-algorithm";
import { FSRS_EMPTY_SCHEDULE_COMMENT } from "src/scheduling/algorithms/fsrs/fsrs-helpers";
import { RepItemScheduleInfoOsr } from "src/scheduling/algorithms/osr/rep-item-schedule-info-osr";

const COMMENT = /<!--SR:(.+?)-->/;

/**
 * Rewrites the schedule comment after an edit, so that each mask keeps its own schedule. `oldIndexOfNew[i]` is the old
 * index of the mask now at i, or null for a new mask. A new mask, and an old index the comment has no segment for,
 * get `emptySegment` (a card that was never reviewed).
 *
 * @returns The new comment, or null when there was no comment (a never-reviewed block) or when no old schedule
 * is left in it, so the comment is not needed.
 */
export function remapScheduleComment(
    comment: string | null,
    oldIndexOfNew: (number | null)[],
    emptySegment: string,
): string | null {
    if (comment === null) return null;
    const body = COMMENT.exec(comment)?.[1];
    if (body === undefined) return comment;

    // Split as CommentParser does: on "!", empty pieces dropped
    const old = body
        .split("!")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);

    let carried = false;
    const segments = oldIndexOfNew.map((oldIndex) => {
        const segment = oldIndex === null ? undefined : old[oldIndex];
        if (segment === undefined) return emptySegment;
        carried = true;
        return segment;
    });
    return carried ? `<!--SR:${segments.map((segment) => "!" + segment).join("")}-->` : null;
}

/** The canonical form of the block whose opening fence is on lines[fenceLine], or null when it is not a valid one. */
function canonicalBlockAt(lines: string[], fenceLine: number): string | null {
    if (!isOcclusionFenceStart(lines[fenceLine] ?? "")) return null;
    const close = closingFenceLine(lines, fenceLine);
    if (close === -1) return null;
    const block = parseOcclusionBlock(lines.slice(fenceLine + 1, close).join("\n"));
    return block === null ? null : formatOcclusionBlock(block);
}

/**
 * Where, in a note, is the block that an editor was opened on. The note may have changed since (a sync, an edit in
 * another pane), so the line the block was on is not enough: it is that line when the block there still has the content
 * it had, else the one block in the note that has it. Otherwise the block is not found, or it is not certain which one
 * it was (the note has the same block twice), and the caller changes nothing.
 *
 * @param fenceLine - The line of the block's opening fence when the editor was opened (counted from 0).
 * @param original - The block as it was when the editor was opened.
 */
export function locateOcclusionBlock(
    noteText: string,
    fenceLine: number,
    original: OcclusionBlock,
): number | "not-found" | "ambiguous" {
    const lines = noteText.split("\n");
    const wanted = formatOcclusionBlock(original);
    if (canonicalBlockAt(lines, fenceLine) === wanted) return fenceLine;

    const found: number[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (canonicalBlockAt(lines, i) === wanted) found.push(i);
    }
    if (found.length === 0) return "not-found";
    return found.length === 1 ? found[0] : "ambiguous";
}

/**
 * Replaces the block, and the comment after it, whose opening fence is on line `fenceLine` (counted from 0) of
 * `noteText`. Everything else in the note stays as it is. The block is written in the canonical order and its
 * schedule comment follows the masks (see remapScheduleComment).
 *
 * When there is no occlusion block on that line, or it is not closed, the note is returned unchanged.
 */
export function replaceOcclusionBlock(
    noteText: string,
    fenceLine: number,
    block: OcclusionBlock,
    oldIndexOfNew: (number | null)[],
    emptySegment: string,
): string {
    const lines = noteText.split("\n");
    if (fenceLine < 0 || fenceLine >= lines.length || !isOcclusionFenceStart(lines[fenceLine])) {
        return noteText;
    }
    const close = closingFenceLine(lines, fenceLine);
    if (close === -1) return noteText;

    // The schedule after a block is a comment line, or the metadata callout up to its comment, as the parser reads it
    let commentLine = -1;
    if (close + 1 < lines.length) {
        if (lines[close + 1].startsWith("<!--SR:")) {
            commentLine = close + 1;
        } else if (lines[close + 1].startsWith(SR_METADATA_CALLOUT)) {
            for (let i = close + 1; i < lines.length && commentLine === -1; i++) {
                if (lines[i].includes("<!--SR:")) commentLine = i;
            }
        }
    }
    const end = commentLine === -1 ? close : commentLine;
    const schedule = lines.slice(close + 1, end + 1);
    if (commentLine !== -1) {
        const old = COMMENT.exec(lines[commentLine]);
        const remapped =
            old === null ? null : remapScheduleComment(old[0], oldIndexOfNew, emptySegment);
        if (remapped === null) schedule.length = 0;
        else schedule[schedule.length - 1] = lines[commentLine].replace(COMMENT, () => remapped);
    }

    // The fences stay as they were written, the block inside them follows the fence's indent and line ending
    const indent = /^\s*/.exec(lines[fenceLine])[0];
    const cr = lines[fenceLine].endsWith("\r") ? "\r" : "";
    const body = formatOcclusionBlock(block)
        .split("\n")
        .map((line) => indent + line + cr);

    lines.splice(
        fenceLine,
        end - fenceLine + 1,
        lines[fenceLine],
        ...body,
        lines[close],
        ...schedule,
    );
    return lines.join("\n");
}

/** A new block, ready to put into a note: the fenced block and a line break. */
export function insertOcclusionBlock(block: OcclusionBlock): string {
    return "```image-occlusion\n" + formatOcclusionBlock(block) + "\n```\n";
}

/**
 * The segment of a schedule comment that stands for a card that was never reviewed, as formatCardSchedule writes it
 * (without the leading "!"): in the FSRS format under FSRS, else the SM-2 one.
 */
export function emptyScheduleSegment(settings: SRSettings): string {
    return settings.algorithm === SRAlgorithmType.FSRS
        ? FSRS_EMPTY_SCHEDULE_COMMENT.slice(1)
        : `${RepItemScheduleInfoOsr.dummyDueDateForNewCard},${RepItemScheduleInfoOsr.initialInterval},${settings.baseEase}`;
}
