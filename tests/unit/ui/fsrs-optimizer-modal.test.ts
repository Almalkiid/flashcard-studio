import { cloneDefaultSettings } from "src/data/settings-model";
import { optimizeParameters } from "src/scheduling/optimizer/optimize";
import { FsrsOptimizerModal } from "src/ui/obsidian-ui-components/modals/fsrs-optimizer-modal";

// Just enough of Obsidian's Modal and Setting to run the dialog on jsdom
jest.mock("obsidian", () => {
    const actual = jest.requireActual<Record<string, unknown>>("../support/obsidian");
    const element = (tag: string) => document.createElementNS("http://www.w3.org/1999/xhtml", tag);
    class Modal {
        contentEl = element("div");
        modalEl = element("div");
        constructor(public app: unknown) {}
        open() {
            (this as unknown as { onOpen(): void }).onOpen();
        }
        close() {
            (this as unknown as { onClose(): void }).onClose();
        }
        setTitle() {
            return this;
        }
    }
    class Setting {
        settingEl = element("div");
        constructor(containerEl: HTMLElement) {
            containerEl.appendChild(this.settingEl);
        }
        setName() {
            return this;
        }
        setDesc() {
            return this;
        }
        addText(cb: (text: unknown) => void) {
            const text = { setValue: () => text, onChange: () => text };
            cb(text);
            return this;
        }
        addButton(cb: (button: unknown) => void) {
            const buttonEl = element("button") as HTMLButtonElement;
            this.settingEl.appendChild(buttonEl);
            const button = {
                buttonEl,
                setButtonText: () => button,
                setCta: () => button,
                setClass: (cls: string) => (buttonEl.classList.add(cls), button),
                setDisabled: (disabled: boolean) => ((buttonEl.disabled = disabled), button),
                onClick: (fn: () => void) => (buttonEl.addEventListener("click", fn), button),
            };
            cb(button);
            return this;
        }
    }
    return { ...actual, Modal, Setting };
});

// The optimizer blocks the thread for its whole run; the test only needs to know whether it was started
jest.mock("src/scheduling/optimizer/optimize", () => ({
    ...jest.requireActual<Record<string, unknown>>("src/scheduling/optimizer/optimize"),
    optimizeParameters: jest.fn(() => {
        throw new Error("not run in this test");
    }),
}));
jest.mock("src/scheduling/optimizer/training-set", () => ({
    buildCardHistories: (): unknown[] => [],
    countTrainingReviews: () => 500,
}));

beforeAll(() => {
    Object.assign(HTMLElement.prototype, {
        empty(this: HTMLElement) {
            this.replaceChildren();
        },
        addClass(this: HTMLElement, ...classes: string[]) {
            this.classList.add(...classes);
        },
        createEl(this: HTMLElement, tag: string, options?: DomElementInfo) {
            const el = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
            if (typeof options?.cls === "string") el.className = options.cls;
            if (typeof options?.text === "string") el.textContent = options.text;
            this.appendChild(el);
            return el;
        },
    });
});

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/** Opens the dialog and presses Optimize; reading the review log takes until `finishReading` is called. */
function startOptimizing() {
    let finishReading: (entries: unknown[]) => void = () => undefined;
    const dataManager = {
        data: { settings: cloneDefaultSettings() },
        reviewLog: {
            readAll: () =>
                new Promise<unknown[]>((resolve) => {
                    finishReading = resolve;
                }),
        },
    };
    const modal = new FsrsOptimizerModal({} as never, { dataManager } as never, jest.fn());
    modal.open();
    modal.contentEl.querySelector<HTMLButtonElement>(".fs-optimizer-run")?.click();
    return { modal, finishReading: () => finishReading([]) };
}

beforeEach(() => jest.mocked(optimizeParameters).mockClear());

describe("the optimizer dialog", () => {
    test("runs the optimization and shows the result", async () => {
        const fit = { logLoss: 0.4, rmse: 0.05 };
        jest.mocked(optimizeParameters).mockReturnValueOnce({
            weights: [],
            reviewsUsed: 500,
            cardCount: 10,
            elapsedMs: 100,
            current: { ...fit, logLoss: 0.5 },
            optimized: fit,
        } as never);
        const { modal, finishReading } = startOptimizing();

        finishReading();
        await jest.advanceTimersByTimeAsync(1000);

        expect(optimizeParameters).toHaveBeenCalledTimes(1);
        expect(modal.contentEl.querySelector(".fs-optimizer-result")).not.toBeNull();
    });

    // The optimizer blocked Obsidian for its whole run, and drew its result into the closed dialog
    test("closed while the review log loads, it does not start the optimization", async () => {
        const { modal, finishReading } = startOptimizing();

        modal.close();
        finishReading();
        await jest.advanceTimersByTimeAsync(1000);

        expect(optimizeParameters).not.toHaveBeenCalled();
        expect(modal.contentEl.childElementCount).toBe(0);
    });
});
