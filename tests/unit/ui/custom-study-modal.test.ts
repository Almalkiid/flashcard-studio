import { CustomStudyModal } from "src/ui/obsidian-ui-components/modals/custom-study-modal";
import { setupStaticDateProvider20230906 } from "src/utils/clock";

// Just enough of Obsidian's Modal and Setting to build the dialog on jsdom. The buttons are real buttons, so a disabled
// one ignores clicks as it does in Obsidian.
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
        setClass(cls: string) {
            this.settingEl.classList.add(cls);
            return this;
        }
        setName() {
            return this;
        }
        setDesc() {
            return this;
        }
        setHeading() {
            return this;
        }
        addText(cb: (text: unknown) => void) {
            const inputEl = element("input") as HTMLInputElement;
            this.settingEl.appendChild(inputEl);
            const text = {
                inputEl,
                setPlaceholder: () => text,
                setValue: (value: string) => ((inputEl.value = value), text),
                getValue: () => inputEl.value,
                setDisabled: (disabled: boolean) => ((inputEl.disabled = disabled), text),
            };
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
                setDisabled: (disabled: boolean) => ((buttonEl.disabled = disabled), button),
                onClick: (fn: () => void) => (buttonEl.addEventListener("click", fn), button),
            };
            cb(button);
            return this;
        }
        addDropdown(cb: (dropdown: unknown) => void) {
            const dropdown = { addOption: () => dropdown, onChange: () => dropdown };
            cb(dropdown);
            return this;
        }
        addToggle(cb: (toggle: unknown) => void) {
            const toggle = { onChange: () => toggle };
            cb(toggle);
            return this;
        }
    }
    return { ...actual, Modal, Setting };
});

beforeAll(() => {
    Object.assign(HTMLElement.prototype, {
        empty(this: HTMLElement) {
            this.replaceChildren();
        },
        addClass(this: HTMLElement, ...classes: string[]) {
            this.classList.add(...classes);
        },
        createDiv(this: HTMLElement, options?: DomElementInfo) {
            const div = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
            if (typeof options?.cls === "string") div.className = options.cls;
            this.appendChild(div);
            return div;
        },
    });
});

beforeEach(() => setupStaticDateProvider20230906());

function openCustomStudy() {
    let finishSave: () => void = () => undefined;
    const dataManager = {
        data: {
            settings: { dailyLimitsEnabled: true },
            limitOverride: undefined as unknown,
        },
        // The save of data.json, which takes a while on a phone, finishes when the test says so
        savePluginData: jest.fn(
            () =>
                new Promise<void>((resolve) => {
                    finishSave = resolve;
                }),
        ),
        vaultIndex: { reviewableRoot: { toDeckArray: (): unknown[] => [] } },
    };
    const onLimitsChanged = jest.fn();
    const modal = new CustomStudyModal({} as never, { dataManager } as never, {
        onLimitsChanged,
        onStartSession: jest.fn(),
    });
    modal.open();
    const applyNew = modal.contentEl.querySelector<HTMLButtonElement>(
        ".fs-custom-study-increase-new button",
    );
    return { dataManager, onLimitsChanged, applyNew, finishSave: () => finishSave() };
}

describe("raising today's limit in custom study", () => {
    test("a double click on Apply raises the limit once", async () => {
        const { dataManager, onLimitsChanged, applyNew, finishSave } = openCustomStudy();

        applyNew?.click();
        applyNew?.click();
        finishSave();
        await new Promise((resolve) => window.setTimeout(resolve, 0));

        expect(dataManager.data.limitOverride).toEqual({
            date: "2023-09-06",
            extraNew: 10,
            extraReviews: 0,
        });
        expect(dataManager.savePluginData).toHaveBeenCalledTimes(1);
        expect(onLimitsChanged).toHaveBeenCalledTimes(1);
    });
});
