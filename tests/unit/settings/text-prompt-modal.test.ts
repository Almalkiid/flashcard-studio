import { TextPromptModal } from "src/settings/text-prompt-modal";

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
    if (options.type) el.setAttribute("type", options.type);
    if (options.placeholder) el.setAttribute("placeholder", options.placeholder);
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
        constructor(public containerEl: HTMLElement) {}
        addButton(cb: (button: unknown) => void) {
            const el = create("button") as HTMLButtonElement;
            this.containerEl.appendChild(el);
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

function openPrompt(overrides: Partial<ConstructorParameters<typeof TextPromptModal>[1]> = {}) {
    const onSubmit = jest.fn(() => Promise.resolve());
    const check = jest.fn((value: string) =>
        value.trim() === ""
            ? "Can't be empty."
            : value === "dup"
              ? "Already in the list."
              : undefined,
    );
    const modal = new TextPromptModal({} as never, {
        title: "Skip a folder",
        placeholder: "Templates",
        check,
        onSubmit,
        ...overrides,
    });
    modal.open();
    const el = modal.contentEl;
    const input = el.querySelector("input");
    const buttons = Array.from(el.querySelectorAll("button"));
    const add = buttons.find((b) => b.textContent === "Add");
    const cancel = buttons.find((b) => b.textContent === "Cancel");
    const error = () => el.querySelector(".fs-text-prompt-error")?.textContent ?? "";
    const type = (value: string) => {
        input.value = value;
        input.dispatchEvent(new Event("input"));
    };
    const enter = () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    const closed = () => (modal as unknown as { closed: boolean }).closed;
    return { modal, input, add, cancel, error, type, enter, closed, onSubmit, check };
}

const flush = () => new Promise((resolve) => window.setTimeout(resolve, 0));

test("it shows the title, the placeholder, an Add button and a Cancel button", () => {
    const { modal, input, add, cancel } = openPrompt();
    expect(modal.modalEl.getAttribute("data-title")).toBe("Skip a folder");
    expect(input.placeholder).toBe("Templates");
    expect(add).toBeDefined();
    expect(cancel).toBeDefined();
});

test("Add is off and no error shows before anything is typed", () => {
    const { add, error } = openPrompt();
    expect(add.disabled).toBe(true);
    expect(error()).toBe("");
});

test("Add is off while the check fails, and the reason shows on its line", () => {
    const { add, error, type } = openPrompt();
    type("dup");
    expect(add.disabled).toBe(true);
    expect(error()).toBe("Already in the list.");
    type("Templates");
    expect(add.disabled).toBe(false);
    expect(error()).toBe("");
});

test("Add submits what was typed and closes", async () => {
    const { closed, add, type, onSubmit } = openPrompt();
    type("Templates");
    add.click();
    await flush();
    expect(onSubmit).toHaveBeenCalledWith("Templates");
    expect(closed()).toBe(true);
});

test("Enter submits too, but not while the check fails", async () => {
    const { closed, type, enter, onSubmit } = openPrompt();
    type("dup");
    enter();
    await flush();
    expect(onSubmit).not.toHaveBeenCalled();
    type("Templates");
    enter();
    await flush();
    expect(onSubmit).toHaveBeenCalledWith("Templates");
    expect(closed()).toBe(true);
});

test("Enter that confirms an input-method composition does not submit, and is left for the input method", async () => {
    const { input, type, onSubmit } = openPrompt();
    type("Templates");
    const composing = new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        cancelable: true,
    });
    input.dispatchEvent(composing);
    await flush();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(composing.defaultPrevented).toBe(false);

    const plain = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    input.dispatchEvent(plain);
    await flush();
    expect(onSubmit).toHaveBeenCalledWith("Templates");
    expect(plain.defaultPrevented).toBe(true);
});

test("pressing Enter twice quickly submits once", async () => {
    const { type, enter, onSubmit } = openPrompt();
    type("Templates");
    enter();
    enter();
    await flush();
    expect(onSubmit).toHaveBeenCalledTimes(1);
});

test("Cancel closes without submitting", () => {
    const { closed, cancel, type, onSubmit } = openPrompt();
    type("Templates");
    cancel.click();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(closed()).toBe(true);
});

test("a submit that fails keeps the dialog open and says why", async () => {
    const { closed, add, type, error, onSubmit } = openPrompt();
    onSubmit.mockRejectedValueOnce(new Error("disk full"));
    type("Templates");
    add.click();
    await flush();
    expect(closed()).toBe(false);
    expect(error()).toContain("disk full");
});
