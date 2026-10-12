/** The seam through which the plugin asks for random numbers, so tests can choose them. */
export interface IRandomNumberProvider {
    /** A whole number from `lowerBound` to `upperBound`, both included. */
    getInteger(lowerBound: number, upperBound: number): number;
}

export class RandomNumberProvider implements IRandomNumberProvider {
    getInteger(lowerBound: number, upperBound: number): number {
        return Math.floor(Math.random() * (upperBound - lowerBound + 1)) + lowerBound;
    }
}

/**
 * Test support: answers `next` for the one pair of bounds it was told to expect and 0 for any other pair, so a test
 * also learns that the code asked about the number of items it should have.
 */
export class StaticRandomNumberProvider implements IRandomNumberProvider {
    expectedLowerBound: number;
    expectedUpperBound: number;
    next: number;

    getInteger(lowerBound: number, upperBound: number): number {
        const asked =
            lowerBound === this.expectedLowerBound && upperBound === this.expectedUpperBound;
        return asked ? this.next : 0;
    }
}

export let globalRandomNumberProvider: IRandomNumberProvider = new RandomNumberProvider();

export const staticRandomNumberProvider = new StaticRandomNumberProvider();

export interface IStaticRandom {
    lower: number;
    upper: number;
    next: number;
}

/** Test support: the static provider answers `next` to a request for `lower` to `upper`. */
export function setupNextRandomNumber(info: IStaticRandom): void {
    Object.assign(staticRandomNumberProvider, {
        expectedLowerBound: info.lower,
        expectedUpperBound: info.upper,
        next: info.next,
    });
}

/** Test support: makes the static provider the global one. Do it before anything calls `WeightedRandomNumber.create`. */
export function setupStaticRandomNumberProvider(): void {
    globalRandomNumberProvider = staticRandomNumberProvider;
}

/** Picks one of several values at random, each as likely as its count says. */
export class WeightedRandomNumber {
    constructor(private readonly provider: IRandomNumberProvider) {}

    /** Uses the global provider as it is now: a later `setupStaticRandomNumberProvider` does not reach it. */
    static create(): WeightedRandomNumber {
        return new WeightedRandomNumber(globalRandomNumberProvider);
    }

    /**
     * Draws one item from a pool in which each key stands for `weights[key]` items. Keys are tried in object order
     * (0 and up ascending, then any others).
     *
     * @param weights Key to its number of items; every count must be a whole number, 0 or more, and one must be above 0.
     * @returns The key drawn, as a number, and which of that key's items it was (0 up).
     */
    getRandomValues(weights: Record<number, number>): [number, number] {
        const buckets = Object.entries(weights);
        if (buckets.some(([, count]) => !Number.isInteger(count) || count < 0)) {
            throw new Error("Each weight must be a whole number, 0 or more");
        }
        const total = buckets.reduce((sum, [, count]) => sum + count, 0);

        // With nothing to draw from, the provider is not asked
        const drawn = total === 0 ? -1 : this.provider.getInteger(0, total - 1);
        let remaining = drawn;
        if (Number.isInteger(drawn) && drawn >= 0) {
            for (const [key, count] of buckets) {
                if (remaining < count) return [Number(key), remaining];
                remaining -= count;
            }
        }
        throw new Error(
            "Could not draw an item: every weight is 0, or the provider answered outside the range it was asked for",
        );
    }
}
