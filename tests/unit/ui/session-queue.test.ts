import { DeckOrder, PickOrder } from "src/data/decks/walker";
import { ReviewLogEntry } from "src/data/review-log/review-log-entry";
import { cloneDefaultSettings } from "src/data/settings-model";
import { DEFAULT_DATA } from "src/data/stored-data";
import { CustomStudyContext, CustomStudySpec } from "src/scheduling/custom-study";
import { DailyLimits } from "src/scheduling/daily-limits";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import { iteratorOrderFor, ReviewQueueLoader } from "src/ui/session-queue";
import { globalDateProvider } from "src/utils/clock";

describe("iteratorOrderFor", () => {
    test("reads the two settings by the names of the orders", () => {
        expect(
            iteratorOrderFor({
                ...cloneDefaultSettings(),
                flashcardCardOrder: "NewFirstRandom",
                flashcardDeckOrder: "PrevDeckComplete_Random",
            }),
        ).toMatchObject({
            pickOrder: PickOrder.NewFirstRandom,
            deckOrder: DeckOrder.PrevDeckComplete_Random,
        });
    });

    test.each(["", "Nonsense", "0", "toString"])(
        "falls back to due first and sequential decks for %j",
        (value) => {
            expect(
                iteratorOrderFor({
                    ...cloneDefaultSettings(),
                    flashcardCardOrder: value,
                    flashcardDeckOrder: value,
                }),
            ).toMatchObject({
                pickOrder: PickOrder.DueFirstSequential,
                deckOrder: DeckOrder.PrevDeckComplete_Sequential,
            });
        },
    );
});

describe("the review log read for today", () => {
    // The unit tests run in UTC; the study day starts at 04:00
    const FOUR_AM = { hour: 4, minute: 0, second: 0 };
    const at = (iso: string): number => Date.parse(iso);

    function loaderWith(entries: Partial<ReviewLogEntry>[]) {
        const readMonths = jest.fn().mockResolvedValue(
            entries.map((entry) => ({
                c: "",
                r: 3,
                k: 0,
                ivl: 0,
                li: 0,
                ms: 0,
                dk: "",
                f: "",
                ...entry,
            })),
        );
        const plugin = {
            dataManager: {
                data: {
                    settings: {
                        ...cloneDefaultSettings(),
                        dailyLimitsEnabled: true,
                        newCardsPerDay: 2,
                        reviewsPerDay: 2,
                    },
                    limitOverride: DEFAULT_DATA.limitOverride,
                },
                reviewLog: { readMonths },
            },
        };
        const loader = new ReviewQueueLoader(
            plugin as never,
            {} as never,
            null,
            FlashcardReviewMode.Review,
        ) as unknown as {
            loadDailyLimits(): Promise<DailyLimits>;
            loadCustomStudyContext(spec: CustomStudySpec): Promise<CustomStudyContext>;
        };
        return { loader, readMonths };
    }

    beforeEach(() => {
        globalDateProvider.setDayBoundary(FOUR_AM);
    });

    afterEach(() => {
        globalDateProvider.setDayBoundary(null);
        jest.useRealTimers();
    });

    test("today's limits count from the day boundary: answers before it belong to the day before", async () => {
        jest.useFakeTimers().setSystemTime(at("2023-09-07T10:00:00Z"));
        const { loader, readMonths } = loaderWith([
            { t: at("2023-09-07T01:00:00Z"), n: 1 }, // the study day of 6 September
            { t: at("2023-09-07T03:59:59Z"), k: 1, c: "y" },
            { t: at("2023-09-07T04:00:00Z"), n: 1 }, // today
            { t: at("2023-09-07T09:00:00Z"), k: 1, c: "x" },
        ]);
        const limits = await loader.loadDailyLimits();
        expect(readMonths).toHaveBeenCalledWith(["2023-09"]);
        expect(limits.remainingNew()).toBe(1);
        expect(limits.remainingReviews()).toBe(1);
        expect(limits.countedToday("x")).toBe(true);
        expect(limits.countedToday("y")).toBe(false);
    });

    test("before the boundary, answers from before yesterday's boundary are not counted", async () => {
        jest.useFakeTimers().setSystemTime(at("2023-09-07T02:00:00Z"));
        const { loader } = loaderWith([
            { t: at("2023-09-06T01:00:00Z"), n: 1 }, // two study days ago
            { t: at("2023-09-06T05:00:00Z"), n: 1 }, // the study day still running
        ]);
        expect((await loader.loadDailyLimits()).remainingNew()).toBe(1);
    });

    test("custom study's forgotten cards of the last N days count each day from the boundary", async () => {
        jest.useFakeTimers().setSystemTime(at("2023-09-07T10:00:00Z"));
        const { loader } = loaderWith([
            { t: at("2023-09-06T01:00:00Z"), r: 1, c: "before" },
            { t: at("2023-09-06T05:00:00Z"), r: 1, c: "yesterday" },
            { t: at("2023-09-07T01:00:00Z"), r: 1, c: "late-yesterday" },
            { t: at("2023-09-07T05:00:00Z"), r: 1, c: "today" },
        ]);
        const forgotten = async (days: number) => [
            ...(await loader.loadCustomStudyContext({ type: "forgotten", days })).forgottenIds,
        ];
        expect(await forgotten(1)).toEqual(["today"]);
        expect(await forgotten(2)).toEqual(["yesterday", "late-yesterday", "today"]);
    });
});
