import { Latch, singleFlight } from "src/ui/single-flight";

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe("singleFlight", () => {
    test("a second call while the first runs joins it", async () => {
        const gate = deferred();
        const action = jest.fn(() => gate.promise);
        const run = singleFlight(action);

        const first = run();
        const second = run();
        expect(action).toHaveBeenCalledTimes(1);
        gate.resolve();
        await Promise.all([first, second]);
        expect(first).toBe(second);
    });

    test("a call after it finished runs again", async () => {
        const action = jest.fn(() => Promise.resolve());
        const run = singleFlight(action);
        await run();
        await run();
        expect(action).toHaveBeenCalledTimes(2);
    });

    test("a failed action does not block the next call", async () => {
        let fail = true;
        const run = singleFlight(() =>
            fail ? Promise.reject(new Error("no")) : Promise.resolve(),
        );
        await expect(run()).rejects.toThrow("no");
        fail = false;
        await expect(run()).resolves.toBeUndefined();
    });
});

describe("Latch", () => {
    test("lets one through until it leaves", () => {
        const latch = new Latch();
        expect(latch.enter()).toBe(true);
        expect(latch.enter()).toBe(false);
        expect(latch.isHeld).toBe(true);
        latch.leave();
        expect(latch.enter()).toBe(true);
    });
});
