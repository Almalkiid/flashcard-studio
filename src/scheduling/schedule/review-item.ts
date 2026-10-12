import type { ScheduleState } from "src/scheduling/schedule/schedule-state";

export enum ReviewItemState {
    NewItem,
    DueItem,
    /** Only a selector for counting; an item is never in this state. */
    AnyItem,
}

export enum ReviewItemType {
    Card = "Card",
    Note = "Note",
}

/** The numbers are part of the contract: the answer buttons and the keys use them. */
export enum ReviewResponse {
    Easy,
    Good,
    Hard,
    Again,
    Reset,
}

/** Something that is reviewed: a card (a note is scheduled through its frontmatter instead). */
export abstract class ReviewItem {
    constructor(
        public reviewItemType: ReviewItemType,
        public scheduleInfo: ScheduleState | null,
    ) {}

    get hasSchedule(): boolean {
        return Boolean(this.scheduleInfo);
    }

    get isNew(): boolean {
        return !this.scheduleInfo;
    }

    get isDue(): boolean {
        return this.scheduleInfo?.isDue() ?? false;
    }

    /** Any scheduled item counts as due here, even one not due yet; `isDue` says whether it really is. */
    get reviewItemState(): ReviewItemState {
        return this.scheduleInfo ? ReviewItemState.DueItem : ReviewItemState.NewItem;
    }

    abstract toString(): string;
}
