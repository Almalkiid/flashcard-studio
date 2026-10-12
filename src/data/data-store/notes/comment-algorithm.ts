import { formatMetaTokens, generateCardId, hasPersistentMeta } from "src/data/card-meta";
import { IDataStoreAlgorithm } from "src/data/data-store/store";
import type { Card } from "src/data/data-structures/card/flashcard";
import type { Question } from "src/data/data-structures/card/question";
import { SCHEDULE_COMMENT_PREFIX, SCHEDULE_COMMENT_SUFFIX } from "src/data/formats";
import { StudioSettings } from "src/data/settings-model";
import { FSRS_EMPTY_SCHEDULE_COMMENT } from "src/scheduling/schedule/fsrs-state";
import { SchedulerKind } from "src/scheduling/schedule/scheduler-kind";
import { Sm2State } from "src/scheduling/schedule/sm2-state";

/** Writes the schedule comment of a question: one segment per card, back to back, each starting with `!`. */
export class Sm2NoteStore implements IDataStoreAlgorithm {
    constructor(private readonly settings: StudioSettings) {}

    questionFormatScheduleAsHtmlComment(question: Question): string {
        const segments = question.cards.map((card) => this.formatCardSchedule(card)).join("");
        return SCHEDULE_COMMENT_PREFIX + segments + SCHEDULE_COMMENT_SUFFIX;
    }

    /** The segment of one card: its schedule, or a placeholder that keeps its place, then its metadata tokens. */
    formatCardSchedule(card: Card): string {
        if (card.scheduleInfo !== null) {
            if (!card.meta.id) card.meta.id = generateCardId();
            return card.scheduleInfo.formatScheduleAsComment() + formatMetaTokens(card.meta);
        }

        // A card not reviewed yet keeps its place with a placeholder, and only gets an id once it has something to store
        if (hasPersistentMeta(card.meta) && !card.meta.id) card.meta.id = generateCardId();
        const placeholder =
            this.settings.algorithm === SchedulerKind.FSRS
                ? FSRS_EMPTY_SCHEDULE_COMMENT
                : `!${Sm2State.dummyDueDateForNewCard},${Sm2State.initialInterval},${this.settings.baseEase}`;
        return placeholder + formatMetaTokens(card.meta);
    }
}
