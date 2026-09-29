import { moment } from "obsidian";
import { State } from "ts-fsrs";

import { isBuried } from "src/data/card-meta";
import { Card } from "src/data/data-structures/card/card";
import { Deck } from "src/data/data-structures/deck/deck";
import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import type SRPlugin from "src/main";
import { RepItemScheduleInfoFsrs } from "src/scheduling/algorithms/fsrs/rep-item-schedule-info-fsrs";
import { boundaryToMs, DayKeyFn, makeDayKeyFn } from "src/stats/day-keys";
import { CardState, StatsCard } from "src/stats/types";
import { globalDateProvider } from "src/utils/dates";

/** What the statistics view reads from the plugin: the whole review log and a snapshot of every card. */
export interface StatsInputs {
    entries: ReviewLogEntry[];
    cards: StatsCard[];
    /** Every deck path (`CIA`, `CIA/Part1`), sorted, for the deck dropdown. */
    decks: string[];
    dayKeyOf: DayKeyFn;
    /** The first day of the week in the user's language: 0 for Sunday, 1 for Monday. */
    weekStart: number;
}

const FSRS_STATE: Record<State, CardState> = {
    [State.New]: "new",
    [State.Learning]: "learning",
    [State.Review]: "review",
    [State.Relearning]: "relearning",
};

/**
 * The plugin's study day mapping, from the day boundary setting.
 */
export function currentDayKeyFn(): DayKeyFn {
    return makeDayKeyFn(boundaryToMs(globalDateProvider.getDayBoundary()));
}

/**
 * Copies what the statistics need out of a card.
 *
 * @param decks - The deck paths the card is in.
 * @param todayKey - The current study day, to tell whether the card is buried.
 */
export function toStatsCard(card: Card, decks: string[], todayKey: string): StatsCard {
    const schedule = card.scheduleInfo;
    const fsrs = schedule instanceof RepItemScheduleInfoFsrs ? schedule : null;

    let state: CardState = "new";
    if (schedule !== null) state = fsrs === null ? "review" : (FSRS_STATE[fsrs.state] ?? "review");

    const dueMs = schedule !== null && state !== "new" ? schedule.dueDateAsUnix : null;
    const lastReviewMs = fsrs?.lastReview ? fsrs.lastReview.valueOf() : null;
    return {
        id: card.meta.id,
        decks,
        state,
        isFsrs: fsrs !== null,
        dueMs: dueMs !== null && Number.isFinite(dueMs) ? dueMs : null,
        intervalDays: schedule?.interval ?? 0,
        stability: fsrs?.stability ?? 0,
        difficulty: fsrs?.difficulty ?? 0,
        lastReviewMs: lastReviewMs !== null && Number.isFinite(lastReviewMs) ? lastReviewMs : null,
        reps: fsrs?.reps ?? 0,
        lapses: fsrs?.lapses ?? 0,
        suspended: card.meta.suspended,
        buried: isBuried(card.meta, todayKey),
        flag: card.meta.flag,
        leech: card.meta.leech,
    };
}

/**
 * Every card of the deck tree once, with all the decks it is in. A card that carries several deck tags sits in each
 * of those decks as the same object.
 */
export function collectStatsCards(
    deckTree: Deck,
    todayKey: string,
): { cards: StatsCard[]; decks: string[] } {
    const decksOfCard = new Map<Card, string[]>();
    const deckPaths: string[] = [];

    for (const deck of deckTree.toDeckArray()) {
        const path = deck.getTopicPath().path.join("/");
        if (path !== "") deckPaths.push(path);
        for (const card of [...deck.newRepItems, ...deck.dueRepItems]) {
            const paths = decksOfCard.get(card);
            if (paths === undefined) decksOfCard.set(card, [path]);
            else if (!paths.includes(path)) paths.push(path);
        }
    }

    const cards: StatsCard[] = [];
    decksOfCard.forEach((paths, card) => cards.push(toStatsCard(card, paths, todayKey)));
    return { cards, decks: deckPaths.sort() };
}

/**
 * Reloads the vault, then reads the whole review log once and snapshots the cards.
 */
export async function loadStatsInputs(plugin: SRPlugin): Promise<StatsInputs> {
    const dataManager = plugin.dataManager;
    await dataManager.sync();

    const dayKeyOf = currentDayKeyFn();
    const entries = await dataManager.reviewLog.readAll();
    const { cards, decks } = collectStatsCards(
        dataManager.osrCore.reviewableDeckTree,
        dayKeyOf(Date.now()),
    );
    return {
        entries,
        cards,
        decks,
        dayKeyOf,
        weekStart: moment.localeData().firstDayOfWeek(),
    };
}
