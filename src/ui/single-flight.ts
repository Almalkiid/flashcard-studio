/**
 * Wraps an async action so that a call made while the action is still running joins it instead of starting another.
 * A double click on a confirmation, or a key held down on a button, then runs the action once.
 *
 * @returns The same promise to every caller that arrives while the action runs.
 */
export function singleFlight<A extends unknown[], R>(
    action: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
    let running: Promise<R> | null = null;
    return (...args: A): Promise<R> => {
        if (running === null) {
            running = action(...args).finally(() => {
                running = null;
            });
        }
        return running;
    };
}

/**
 * A latch that lets one pass at a time: `enter` is true for the first caller and false for everyone after it, until the
 * first caller calls `leave`. For actions whose second press must be dropped, not joined, such as a rating.
 */
export class Latch {
    private held = false;

    /** @returns Whether the caller got the latch; the caller that did must `leave` when it is done. */
    enter(): boolean {
        if (this.held) return false;
        this.held = true;
        return true;
    }

    leave(): void {
        this.held = false;
    }

    get isHeld(): boolean {
        return this.held;
    }
}
