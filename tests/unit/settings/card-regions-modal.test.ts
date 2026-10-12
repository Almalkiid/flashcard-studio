import { CardRegionsModal } from "src/settings/card-regions-modal";

jest.mock("src/settings/settings.css", () => ({}));

// The helpers Obsidian adds to every element, and the Modal and Setting pieces the dialog uses, are not there in a
// unit test. Just enough of them is rebuilt here to run the dialog on jsdom.
function create(tag: string): HTMLElement {
    return document.createElementNS("http://www.w3.org/1999/xhtml", tag);
}

function make(parent: HTMLElement, tag: string, options: DomElementInfo = {}): HTMLElement {
    const el = create(tag);
    if (typeof options.cls === "string") el.className = options.cls;
    if (typeof options.text === "string") el.textContent = options.text;
    parent.appendChild(el);
    return el;
}

const obsidianHelpers = {
    createEl(this: HTMLElement, tag: string, options?: DomElementInfo): HTMLElement {
        return make(this, tag, options);
    },
    createDiv(this: HTMLElement, options?: DomElementInfo): HTMLElement {
        return make(this, "div", options);
    },
    empty(this: HTMLElement): void {
        this.replaceChildren();
    },
    setText(this: HTMLElement, text: string): void {
        this.textContent = text;
    },
};

beforeAll(() => {
    Object.assign(HTMLElement.prototype, obsidianHelpers);
});

jest.mock("obsidian", () => {
    class Modal {
        contentEl = create("div");
        modalEl = create("div");
        closed = false;
        constructor(public app: unknown) {}
        setTitle(title: string) {
            this.modalEl.setAttribute("data-title", title);
            return this;
        }
        open() {
            (this as unknown as { onOpen(): void }).onOpen();
        }
        close() {
            this.closed = true;
        }
    }
    class Setting {
        private readonly rowEl: HTMLElement;
        constructor(containerEl: HTMLElement) {
            this.rowEl = create("div");
            this.rowEl.className = "setting-item";
            containerEl.appendChild(this.rowEl);
        }
        setName(name: string) {
            const nameEl = create("div");
            nameEl.className = "setting-item-name";
            nameEl.textContent = name;
            this.rowEl.appendChild(nameEl);
            return this;
        }
        addText(cb: (text: unknown) => void) {
            const inputEl = create("input") as HTMLInputElement;
            this.rowEl.appendChild(inputEl);
            const text = {
                inputEl,
                setPlaceholder: (placeholder: string) => (
                    inputEl.setAttribute("placeholder", placeholder),
                    text
                ),
                setValue: (value: string) => ((inputEl.value = value), text),
                onChange: (fn: (value: string) => void) => (
                    inputEl.addEventListener("input", () => fn(inputEl.value)),
                    text
                ),
            };
            cb(text);
            return this;
        }
        addButton(cb: (button: unknown) => void) {
            const el = create("button") as HTMLButtonElement;
            this.rowEl.appendChild(el);
            const button = {
                buttonEl: el,
                setButtonText: (text: string) => ((el.textContent = text), button),
                setCta: () => button,
                setDisabled: (disabled: boolean) => ((el.disabled = disabled), button),
                onClick: (fn: () => void) => (el.addEventListener("click", fn), button),
            };
            cb(button);
            return this;
        }
    }
    return { Modal, Setting };
});

function openRegions(start = "", end = "") {
    const onSave = jest.fn((_start: string, _end: string) => Promise.resolve());
    const modal = new CardRegionsModal({} as never, start, end, onSave);
    // In the document, so that focus() has an effect to look at.
    document.body.appendChild(modal.contentEl);
    modal.open();
    const el = modal.contentEl;
    const field = (label: string) =>
        Array.from(el.querySelectorAll(".setting-item"))
            .find((row) => row.querySelector(".setting-item-name")?.textContent === label)
            ?.querySelector("input");
    const startInput = field("Start marker");
    const endInput = field("End marker");
    const buttons = Array.from(el.querySelectorAll("button"));
    const save = buttons.find((b) => b.textContent === "Save");
    const cancel = buttons.find((b) => b.textContent === "Cancel");
    const error = () => el.querySelector(".fs-text-prompt-error")?.textContent ?? "";
    const type = (input: HTMLInputElement, value: string) => {
        input.value = value;
        input.dispatchEvent(new Event("input"));
    };
    const enter = (input: HTMLInputElement) =>
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    const closed = () => (modal as unknown as { closed: boolean }).closed;
    return { modal, el, startInput, endInput, save, cancel, error, type, enter, closed, onSave };
}

const flush = () => new Promise((resolve) => window.setTimeout(resolve, 0));

afterEach(() => document.body.replaceChildren());

test("it shows the title, the warning, both fields with their placeholders, Save and Cancel", () => {
    const { modal, el, startInput, endInput, save, cancel } = openRegions();
    expect(modal.modalEl.getAttribute("data-title")).toBe("Card regions");
    expect(el.querySelector("p")?.textContent).toBe(
        "Cards outside the markers stop being found, and their schedules stay in the note until you add the markers around them.",
    );
    expect(startInput.placeholder).toBe("+++");
    expect(endInput.placeholder).toBe("---");
    expect(save).toBeDefined();
    expect(cancel).toBeDefined();
});

test("the Start field has the cursor when it opens", () => {
    const { startInput } = openRegions();
    expect(document.activeElement).toBe(startInput);
});

test("the fields start with the markers it was given", () => {
    const { startInput, endInput } = openRegions("<<<", ">>>");
    expect(startInput.value).toBe("<<<");
    expect(endInput.value).toBe(">>>");
});

test("Save is on and no error shows when it opens, including with no markers", () => {
    const { save, error } = openRegions();
    expect(save.disabled).toBe(false);
    expect(error()).toBe("");
});

test("the same marker can open and close a region, so Save stays on and nothing is refused", async () => {
    const { closed, save, error, type, startInput, endInput, onSave } = openRegions("+++", "+++");
    expect(save.disabled).toBe(false);
    expect(error()).toBe("");
    type(startInput, "<<<");
    type(endInput, "<<<");
    expect(save.disabled).toBe(false);
    expect(error()).toBe("");
    save.click();
    await flush();
    expect(onSave).toHaveBeenCalledWith("<<<", "<<<");
    expect(closed()).toBe(true);
});

test("Save hands over the trimmed markers and closes", async () => {
    const { closed, save, type, startInput, endInput, onSave } = openRegions();
    type(startInput, "  +++ ");
    type(endInput, " --- ");
    save.click();
    await flush();
    expect(onSave).toHaveBeenCalledWith("+++", "---");
    expect(closed()).toBe(true);
});

test("clearing both fields and saving turns regions off", async () => {
    const { closed, save, type, startInput, endInput, onSave } = openRegions("+++", "---");
    type(startInput, "");
    type(endInput, "");
    save.click();
    await flush();
    expect(onSave).toHaveBeenCalledWith("", "");
    expect(closed()).toBe(true);
});

test("Enter saves from either field", async () => {
    const { closed, enter, endInput, onSave } = openRegions("+++", "---");
    enter(endInput);
    await flush();
    expect(onSave).toHaveBeenCalledWith("+++", "---");
    expect(closed()).toBe(true);
});

test("Enter that confirms an input-method composition does not save, and is left for the input method", async () => {
    const { startInput, endInput, onSave } = openRegions("+++", "---");
    for (const input of [startInput, endInput]) {
        const composing = new KeyboardEvent("keydown", {
            key: "Enter",
            isComposing: true,
            cancelable: true,
        });
        input.dispatchEvent(composing);
        expect(composing.defaultPrevented).toBe(false);
    }
    await flush();
    expect(onSave).not.toHaveBeenCalled();

    const plain = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    startInput.dispatchEvent(plain);
    await flush();
    expect(onSave).toHaveBeenCalledWith("+++", "---");
    expect(plain.defaultPrevented).toBe(true);
});

test("pressing Enter twice quickly saves once", async () => {
    const { enter, startInput, onSave } = openRegions("+++", "---");
    enter(startInput);
    enter(startInput);
    await flush();
    expect(onSave).toHaveBeenCalledTimes(1);
});

test("Cancel closes without saving", () => {
    const { closed, cancel, type, startInput, onSave } = openRegions();
    type(startInput, "+++");
    cancel.click();
    expect(onSave).not.toHaveBeenCalled();
    expect(closed()).toBe(true);
});

test("a save that fails keeps the dialog open and says why", async () => {
    const { closed, save, error, onSave } = openRegions("+++", "---");
    onSave.mockRejectedValueOnce(new Error("disk full"));
    save.click();
    await flush();
    expect(closed()).toBe(false);
    expect(error()).toContain("disk full");
    expect(save.disabled).toBe(false);
});
