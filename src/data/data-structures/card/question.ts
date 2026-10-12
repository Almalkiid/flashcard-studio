import type { ParsedQuestionInfo } from "src/cards/parse";
import { hasPersistentMeta } from "src/data/card-meta";
import { withoutScheduleComments } from "src/data/data-store/schedule-comment";
import { DataStoreAlgorithm } from "src/data/data-store/store";
import type { Card } from "src/data/data-structures/card/flashcard";
import {
    findCard,
    LineSpan,
    lineStarts,
    replaceCard,
} from "src/data/data-structures/card/note-region";
import { TopicPath, TopicPathList, TopicPathWithWs } from "src/data/decks/topic-path";
import { CARD_METADATA_CALLOUT, SCHEDULE_COMMENT_PREFIX } from "src/data/formats";
import { StudioSettings } from "src/data/settings-model";
import type { Note } from "src/note-review/note";
import { cyrb53 } from "src/utils/hash";
import { stringTrimStart, TextDirection } from "src/utils/text";

/** The numbers are used in tests and must not shift: new kinds are added last. */
export enum CardType {
    SingleLineBasic,
    SingleLineReversed,
    MultiLineBasic,
    MultiLineReversed,
    Cloze,
    // A callout such as `> [!question] Title` with the answer in its body
    Callout,
    // An image with masks on it, in a fenced `image-occlusion` block: one card per mask
    ImageOcclusion,
}

const BLOCK_ID_AT_END = / (\^[A-Za-z0-9-]+)$/;
const TAG_AT_START = /^#[^\s#]+/;

/** The text of a question as it is in a note, and the pieces it is made of. */
export class QuestionText {
    /** Identifies the question (not its schedule) in the list of buried siblings and in custom study. */
    textHash: string;

    /**
     * @param original - The lines of the question as they are in the note, schedule comment included.
     * @param topicPathWithWs - The topic tag in front of the question, with the white space around it; null when there
     * is none to keep.
     * @param actualQuestion - The question without its tag, schedule comment and block id.
     * @param obsidianBlockId - The `^id` at the end of the question, with the `^`; empty when there is none.
     */
    constructor(
        public original: string,
        public topicPathWithWs: TopicPathWithWs | null,
        public actualQuestion: string,
        public textDirection: TextDirection,
        public obsidianBlockId: string,
    ) {
        this.textHash = cyrb53(this.formatTopicAndQuestion());
    }

    endsWithCodeBlock(): boolean {
        return this.actualQuestion.endsWith("```");
    }

    static create(
        original: string,
        textDirection: TextDirection,
        settings: StudioSettings,
    ): QuestionText {
        const [tag, question, blockId] = QuestionText.splitText(original, settings);
        return new QuestionText(original, tag, question, textDirection, blockId);
    }

    /**
     * Splits a question into its topic tag, the question and its block id. With folders as decks the tag is cut off
     * but not kept, since the deck comes from the folder.
     */
    static splitText(
        original: string,
        settings: StudioSettings,
    ): [TopicPathWithWs | null, string, string] {
        let text = withoutScheduleComments(original);
        // The text is cut off at its end only when no tag is split off. A question that follows its tag keeps the white
        // space behind it, which is part of the hash that is stored in the list of buried siblings.

        let topicPathWithWs: TopicPathWithWs | null = null;
        const [preWs, rest] = stringTrimStart(text);
        const tag = TAG_AT_START.exec(rest)?.[0];
        if (tag !== undefined) {
            const [postWs, question] = stringTrimStart(rest.slice(tag.length));
            if (!settings.convertFoldersToDecks) {
                topicPathWithWs = new TopicPathWithWs(
                    TopicPath.getTopicPathFromTag(tag),
                    preWs,
                    postWs,
                );
            }
            text = question;
        } else {
            text = text.trimEnd();
        }

        const [actualQuestion, blockId] = QuestionText.extractObsidianBlockId(text);
        return [topicPathWithWs, actualQuestion, blockId];
    }

    /** The text without a `^id` at its end, and that id (empty when there is none). */
    static extractObsidianBlockId(text: string): [string, string] {
        const id = text.match(BLOCK_ID_AT_END)?.[1];
        if (!id) return [text, ""];
        return [text.slice(0, text.length - id.length).trim(), id];
    }

    /** The tag with its white space, then the question. */
    formatTopicAndQuestion(): string {
        return (this.topicPathWithWs?.formatWithWs() ?? "") + this.actualQuestion;
    }
}

/** What a rewrite of a question in its note text decided; applied to the question once the note is written. */
export interface Rewrite {
    noteText: string;
    replacement: string;
    from: LineSpan;
    to: LineSpan;
    /** How many of the note's line shifts `from` includes. */
    seen: number;
    /** How many characters the note text grew by. */
    chars: number;
}

/**
 * For each note, the changes made to its text, in order: the questions after the line `after` moved by `by` lines
 * and `chars` characters.
 */
const lineShifts = new WeakMap<object, { after: number; by: number; chars: number }[]>();

/** A question of a note: one or more cards made from the same text, and where they are in the note. */
export class Question {
    cards: Card[];
    questionContext: string[];
    topicPathList: TopicPathList;
    parsedQuestionInfo: ParsedQuestionInfo;
    note: Note;
    /** Set when loading the note found something to correct in it; the note is then rewritten. */
    hasChanged: boolean = false;

    /** Where the question is in the note now. Writes through this plugin move it; the parser's numbers stay. */
    private lines: LineSpan | null = null;
    /** How many of the note's line shifts `lines` already includes. */
    private shiftsSeen = 0;
    private text: QuestionText;

    constructor(init?: Partial<Question>) {
        Object.assign(this, init);
    }

    get questionText(): QuestionText {
        return this.text;
    }

    /** A question whose text got another number of lines (an undone answer) moves the questions after it. */
    set questionText(next: QuestionText) {
        const previous = this.text;
        this.text = next;
        const span = previous && next.original !== previous.original ? this.span() : null;
        if (span === null) return;
        const lineCount = (text: string) => text.split("\n").length;
        const to = {
            first: span.first,
            last: span.last + lineCount(next.original) - lineCount(previous.original),
        };
        this.moved(span, to, this.shiftsSeen, next.original.length - previous.original.length);
    }

    get questionType(): CardType {
        return this.parsedQuestionInfo.cardType;
    }

    get lineNo(): number {
        return this.parsedQuestionInfo.firstLineNum;
    }

    static Create(
        settings: StudioSettings,
        parsedQuestionInfo: ParsedQuestionInfo,
        noteTopicPathList: TopicPathList,
        textDirection: TextDirection,
        questionContext: string[],
    ): Question {
        const questionText = QuestionText.create(parsedQuestionInfo.text, textDirection, settings);
        // A tag in front of the question is the deck of that question alone
        const topicPathList = questionText.topicPathWithWs
            ? new TopicPathList([questionText.topicPathWithWs.topicPath])
            : noteTopicPathList;
        return new Question({ parsedQuestionInfo, topicPathList, questionText, questionContext });
    }

    setCardList(cards: Card[]): void {
        for (const card of cards) card.question = this;
        this.cards = cards;
    }

    // A callout card's schedule always goes on the line after the callout, outside of it, and the metadata callout is
    // not used either: written inside the card's own callout it would show up as text in the answer
    private get isCalloutCard(): boolean {
        return this.parsedQuestionInfo?.cardType === CardType.Callout;
    }

    /** The separator in front of the comment: a space when it goes on the line of the question or inside a callout. */
    getHtmlCommentSeparator(settings: StudioSettings, commentInCallout: boolean): string {
        let sameLine = settings.cardCommentOnSameLine;
        // A code block, a callout card and an occlusion block end with something nothing can follow
        if (this.questionText.endsWithCodeBlock()) sameLine = false;
        if (this.isCalloutCard) sameLine = false;
        if (this.parsedQuestionInfo?.cardType === CardType.ImageOcclusion) sameLine = false;
        return commentInCallout || sameLine ? " " : "\n";
    }

    /** The text of the question as it is written to the note: the question, then the schedule comment of its cards. */
    formatForNote(settings: StudioSettings): string {
        const text = this.questionText;
        const blockId = text.obsidianBlockId ? " " + text.obsidianBlockId : "";
        let result = text.formatTopicAndQuestion();

        const hasSchedule = this.cards.some(
            (card) => card.hasSchedule || hasPersistentMeta(card.meta),
        );
        const comment = hasSchedule
            ? DataStoreAlgorithm.getInstance().questionFormatScheduleAsHtmlComment(this)
            : "";
        if (comment === "") {
            // When a schedule comment is being removed (an undone first answer), drop the separator that was added
            // before it, so the note returns to exactly how it was
            if (text.original.includes(SCHEDULE_COMMENT_PREFIX)) result = result.trimEnd();
            return result + blockId;
        }

        // A question that follows its tag keeps the white space that was behind it (see splitText); none goes before the comment
        result = result.trimEnd();
        const inMetadataCallout = text.actualQuestion.includes(CARD_METADATA_CALLOUT);
        if (inMetadataCallout) {
            // The callout is where it was written before; the comment goes back after its last line
            return result + " " + comment + blockId;
        }
        if (settings.useCalloutsForSchedulingComments && !this.isCalloutCard) {
            return `${result}\n${CARD_METADATA_CALLOUT} \n> ${this.getHtmlCommentSeparator(settings, true)}${comment}${blockId}`;
        }
        const separator = this.getHtmlCommentSeparator(settings, false);
        return separator === " "
            ? `${result} ${comment}${blockId}`
            : `${result}${blockId}\n${comment}`;
    }

    /** The lines the question is on in the note now. */
    private span(): LineSpan | null {
        if (this.lines === null) {
            if (!this.parsedQuestionInfo) return null;
            this.lines = {
                first: this.parsedQuestionInfo.firstLineNum,
                last: this.parsedQuestionInfo.lastLineNum,
            };
        }
        const shifts = this.note ? lineShifts.get(this.note) : undefined;
        if (shifts !== undefined && this.shiftsSeen < shifts.length) {
            let { first, last, offset } = this.lines;
            for (const shift of shifts.slice(this.shiftsSeen)) {
                if (first > shift.after) {
                    first += shift.by;
                    last += shift.by;
                    if (offset !== undefined) offset += shift.chars;
                }
            }
            this.lines = { first, last, offset };
            this.shiftsSeen = shifts.length;
        }
        return this.lines;
    }

    /** Learns where each question of the note starts in the text, in one pass, so a write finds its place at once. */
    private learnOffsets(noteText: string): void {
        if (this.span()?.offset !== undefined) return;
        const starts = lineStarts(noteText);
        for (const question of this.note?.questionList ?? [this]) {
            const span = question.span();
            if (span !== null && span.offset === undefined && span.first < starts.length) {
                span.offset = starts[span.first];
            }
        }
    }

    /**
     * Takes over that the question, which was on the lines `from`, is on the lines `to`, and tells the questions after
     * it. `seen` is how many of the note's shifts `from` includes, `chars` how many characters the text grew by.
     */
    private moved(from: LineSpan, to: LineSpan, seen: number, chars: number): void {
        this.lines = to;
        this.shiftsSeen = seen;
        const by = to.last - from.last;
        if ((by === 0 && chars === 0) || !this.note) return;
        const shifts = lineShifts.get(this.note) ?? [];
        shifts.push({ after: from.last, by, chars });
        lineShifts.set(this.note, shifts);
    }

    /**
     * Decides how the note text looks with this question rewritten from its cards.
     *
     * @returns Null when the text no longer holds the question as it was read (edited in another pane, or synced from
     * another device).
     */
    private planRewrite(noteText: string, settings: StudioSettings): Rewrite | null {
        const original = this.questionText.original;
        let replacement = this.formatForNote(settings);

        // Only the first scheduling comment belongs to this question. Another one is the schedule of a card that
        // ended up in the same text (two scheduled cards inside one card region). It is not part of the question
        // text, so without this it would be deleted by the rewrite.
        const extraComments = (original.match(/<!--SR:.+?-->/g) ?? []).slice(1);
        if (extraComments.length > 0 && replacement.includes(SCHEDULE_COMMENT_PREFIX)) {
            replacement += "\n" + extraComments.join("\n");
        }

        this.learnOffsets(noteText);
        const region = findCard(noteText, original, this.span());
        if (region === null) {
            // The note's text is not printed: it can be long and private. The path and the card's first line say enough.
            console.warn(
                `updateQuestionText: Text not found: ${original.split("\n")[0].substring(0, 100)} in note: ${this.note?.filePath}`,
            );
            return null;
        }
        const newText = replaceCard(noteText, region, replacement);
        return {
            noteText: newText,
            replacement,
            from: region.span,
            to: {
                first: region.span.first,
                last: region.span.first + replacement.split("\n").length - 1,
                offset: region.start,
            },
            seen: this.shiftsSeen,
            chars: newText.length - noteText.length,
        };
    }

    /** Takes over a rewrite that was written: the question is now the new text, and the questions after it moved. */
    private applyRewrite(rewrite: Rewrite, settings: StudioSettings): void {
        this.text = QuestionText.create(rewrite.replacement, this.text.textDirection, settings);
        this.moved(rewrite.from, rewrite.to, rewrite.seen, rewrite.chars);
    }

    /**
     * Decides how the note text looks without this question. A question right under its tag line leaves that line,
     * which is the tag of the questions after it too.
     *
     * @returns Null when the text no longer holds the question as it was read, or would be left empty.
     */
    planRemoval(noteText: string): Rewrite | null {
        const original = this.questionText.original;
        this.learnOffsets(noteText);
        const region = findCard(noteText, original, this.span());
        if (region === null) {
            console.warn(`deleteQuestion: Text not found: ${original.substring(0, 100)}`);
            return null;
        }
        const tagLine = /^\s*#[^\s#]+[ \t]*\n\s*(?=\S)/.exec(original)?.[0] ?? "";
        const result = replaceCard(noteText, region, tagLine);
        if (result === "") return null;
        return {
            noteText: result,
            replacement: tagLine,
            from: region.span,
            to: {
                first: region.span.first,
                last: region.span.first + tagLine.split("\n").length - 1,
                offset: region.start,
            },
            seen: this.shiftsSeen,
            chars: result.length - noteText.length,
        };
    }

    /**
     * Puts `text` in place of the question's text in its note, reading and writing the note in one step. The question
     * itself is left as it is: the caller sets `questionText`, which moves the questions after it.
     *
     * @returns Whether it was written; false when the note no longer holds the question as it was read.
     */
    async replaceOriginalText(text: string): Promise<boolean> {
        const original = this.questionText.original;
        return this.note.file.edit((noteText) => {
            this.learnOffsets(noteText);
            const region = findCard(noteText, original, this.span());
            return region === null ? null : replaceCard(noteText, region, text);
        });
    }

    /** Takes over a removal that was written: the questions after this one moved. */
    applyRemoval(removal: Rewrite): void {
        this.moved(removal.from, removal.to, removal.seen, removal.chars);
    }

    /** The note text with this question rewritten from its cards; the note text itself when it is not there. */
    updateQuestionWithinNoteText(noteText: string, settings: StudioSettings): string {
        return this.rewriteWithinNoteText(noteText, settings) ?? noteText;
    }

    /**
     * The note text with this question rewritten from its cards, or null when the text no longer holds the question
     * as it was read. Only a rewrite updates the question's text.
     */
    rewriteWithinNoteText(noteText: string, settings: StudioSettings): string | null {
        const rewrite = this.planRewrite(noteText, settings);
        if (rewrite === null) return null;
        this.applyRewrite(rewrite, settings);
        return rewrite.noteText;
    }

    /**
     * Rewrites the question in its note, reading and writing the note in one step.
     *
     * @returns Whether it was written; false when the note no longer holds the question as it was read, and then the
     * note is left alone.
     */
    async writeQuestion(settings: StudioSettings): Promise<boolean> {
        let rewrite: Rewrite | null = null;
        const written = await this.note.file.edit((noteText) => {
            rewrite = this.planRewrite(noteText, settings);
            return rewrite?.noteText ?? null;
        });
        if (!written || rewrite === null) return false;
        this.applyRewrite(rewrite, settings);
        this.hasChanged = false;
        return true;
    }
}
