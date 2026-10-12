import {
    globalRandomNumberProvider,
    IRandomNumberProvider,
    RandomNumberProvider,
    setupNextRandomNumber,
    setupStaticRandomNumberProvider,
    StaticRandomNumberProvider,
    staticRandomNumberProvider,
    WeightedRandomNumber,
} from "src/utils/random";

/** A provider that answers from a list and remembers what it was asked. */
function scriptedProvider(...answers: number[]): IRandomNumberProvider & {
    asked: [number, number][];
} {
    const asked: [number, number][] = [];
    return {
        asked,
        getInteger(lower: number, upper: number): number {
            asked.push([lower, upper]);
            return answers.shift() ?? 0;
        },
    };
}

/** What `getRandomValues` answers for each provider answer in turn (a fresh provider for every one). */
function drawAll(weights: Record<number, number>, answers: number[]): [number, number][] {
    return answers.map((answer) =>
        new WeightedRandomNumber(scriptedProvider(answer)).getRandomValues(weights),
    );
}

describe("RandomNumberProvider", () => {
    afterEach(() => jest.restoreAllMocks());

    test("reaches both ends of the range and nothing beyond", () => {
        const provider = new RandomNumberProvider();
        const random = jest.spyOn(Math, "random");
        random.mockReturnValue(0);
        expect(provider.getInteger(3, 6)).toBe(3);
        random.mockReturnValue(0.999999);
        expect(provider.getInteger(3, 6)).toBe(6);
    });

    test("every value of a small range is reachable", () => {
        const provider = new RandomNumberProvider();
        const random = jest.spyOn(Math, "random");
        const seen = new Set<number>();
        for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
            random.mockReturnValue(r);
            seen.add(provider.getInteger(3, 6));
        }
        expect([...seen].sort()).toEqual([3, 4, 5, 6]);
    });

    test("a range of one value gives that value", () => {
        expect(new RandomNumberProvider().getInteger(5, 5)).toBe(5);
    });

    test("negative bounds work", () => {
        jest.spyOn(Math, "random").mockReturnValue(0.5);
        expect(new RandomNumberProvider().getInteger(-4, -1)).toBe(-2);
    });
});

describe("StaticRandomNumberProvider", () => {
    test("answers `next` only for the bounds it expects", () => {
        const provider = new StaticRandomNumberProvider();
        provider.expectedLowerBound = 0;
        provider.expectedUpperBound = 4;
        provider.next = 3;
        expect(provider.getInteger(0, 4)).toBe(3);
        expect(provider.getInteger(0, 5)).toBe(0);
        expect(provider.getInteger(1, 4)).toBe(0);
    });

    test("answers 0 before it is armed", () => {
        expect(new StaticRandomNumberProvider().getInteger(0, 9)).toBe(0);
    });
});

describe("the test setup helpers", () => {
    test("setupNextRandomNumber arms the shared static provider", () => {
        setupNextRandomNumber({ lower: 0, upper: 4, next: 3 });
        expect(staticRandomNumberProvider.getInteger(0, 4)).toBe(3);
        expect(staticRandomNumberProvider.getInteger(0, 5)).toBe(0);
        expect(staticRandomNumberProvider.getInteger(1, 4)).toBe(0);
    });

    test("arming again replaces the earlier setting", () => {
        setupNextRandomNumber({ lower: 0, upper: 4, next: 3 });
        setupNextRandomNumber({ lower: 0, upper: 1, next: 1 });
        expect(staticRandomNumberProvider.getInteger(0, 4)).toBe(0);
        expect(staticRandomNumberProvider.getInteger(0, 1)).toBe(1);
    });

    // Last of the group: it changes the shared global, and later tests in this file start from the static one
    test("setupStaticRandomNumberProvider points the global provider at the static one", () => {
        expect(globalRandomNumberProvider).toBeInstanceOf(RandomNumberProvider);
        setupStaticRandomNumberProvider();
        expect(globalRandomNumberProvider).toBe(staticRandomNumberProvider);
    });
});

describe("WeightedRandomNumber", () => {
    test("walks the buckets in order and gives the offset inside the bucket", () => {
        expect(drawAll({ 1: 2, 2: 3 }, [0, 1, 2, 3, 4])).toEqual([
            [1, 0],
            [1, 1],
            [2, 0],
            [2, 1],
            [2, 2],
        ]);
    });

    test("asks the provider once, for 0 to total - 1", () => {
        const provider = scriptedProvider(0);
        new WeightedRandomNumber(provider).getRandomValues({ 1: 2, 2: 3 });
        expect(provider.asked).toEqual([[0, 4]]);
    });

    test("keys come in ascending numeric order, whatever order they were added in", () => {
        expect(drawAll({ 5: 1, 2: 1, 10: 1 }, [0, 1, 2]).map(([key]) => key)).toEqual([2, 5, 10]);
    });

    test("a bucket of zero is skipped", () => {
        expect(drawAll({ 1: 0, 2: 3 }, [0, 1, 2])).toEqual([
            [2, 0],
            [2, 1],
            [2, 2],
        ]);
    });

    test("negative keys come after the others", () => {
        expect(drawAll({ "-1": 1, 0: 1 }, [0, 1])).toEqual([
            [0, 0],
            [-1, 0],
        ]);
    });

    test("with the static provider armed for the total, it gets what the test chose", () => {
        setupStaticRandomNumberProvider();
        setupNextRandomNumber({ lower: 0, upper: 6, next: 5 });
        expect(WeightedRandomNumber.create().getRandomValues({ 7: 3, 9: 4 })).toEqual([9, 2]);
    });

    describe("weights that are not whole numbers of zero or more", () => {
        // Each of these must be refused by looking at the weights: the provider is never asked, so the throw cannot
        // come from a mismatch between its armed bounds and the total (which is how the old test passed by accident)
        test.each([
            ["negative", { 1: -1, 2: 3 }],
            ["fractional", { 1: 1.5 }],
            ["NaN", { 1: NaN }],
            ["infinite", { 1: Infinity }],
            ["a string", { 1: "2" as unknown as number }],
            ["a negative one that cancels a positive one", { 1: -2, 2: 2 }],
        ])("%s", (_name, weights) => {
            const provider = scriptedProvider(0);
            expect(() => new WeightedRandomNumber(provider).getRandomValues(weights)).toThrow(
                "Each weight must be a whole number, 0 or more",
            );
            expect(provider.asked).toEqual([]);
        });
    });

    describe("when there is nothing to choose", () => {
        test.each([
            ["no weights", {}],
            ["only zeros", { 1: 0, 2: 0 }],
        ])("%s", (_name, weights) => {
            const provider = scriptedProvider(0);
            expect(() => new WeightedRandomNumber(provider).getRandomValues(weights)).toThrow(
                "Could not draw an item",
            );
            expect(provider.asked).toEqual([]);
        });
    });

    describe("a provider that answers outside 0 to total - 1", () => {
        test.each([
            ["too big", 5],
            ["negative", -1],
            ["fractional", 1.5],
        ])("%s", (_name, answer) => {
            expect(() =>
                new WeightedRandomNumber(scriptedProvider(answer)).getRandomValues({ 1: 5 }),
            ).toThrow("Could not draw an item");
        });
    });

    test("create() keeps the provider that was global when it was called", async () => {
        // A fresh copy of the module, so the global provider starts as the real one
        jest.resetModules();
        const fresh = await import("src/utils/random");
        const early = fresh.WeightedRandomNumber.create();

        fresh.setupStaticRandomNumberProvider();
        fresh.setupNextRandomNumber({ lower: 0, upper: 1, next: 1 });
        jest.spyOn(Math, "random").mockReturnValue(0);

        // `early` still draws with the real provider (random 0 gives the first bucket); one made now uses the static
        expect(early.getRandomValues({ 4: 1, 6: 1 })).toEqual([4, 0]);
        expect(fresh.WeightedRandomNumber.create().getRandomValues({ 4: 1, 6: 1 })).toEqual([6, 0]);
        jest.restoreAllMocks();
    });
});
