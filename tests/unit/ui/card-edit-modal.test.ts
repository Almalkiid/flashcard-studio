import { CardType } from "src/data/data-structures/card/question";
import { cloneDefaultSettings, StudioSettings } from "src/data/settings-model";
import {
    EditCancelled,
    FlashcardEditModal,
} from "src/ui/obsidian-ui-components/modals/card-edit-modal";
import { TextDirection } from "src/utils/text";

jest.mock("obsidian", () => {
    const actual = jest.requireActual<Record<string, unknown>>("../support/obsidian");
    class ButtonComponent {
        buttonEl: HTMLButtonElement;
        constructor(container: HTMLElement) {
            this.buttonEl = container.createEl("button");
        }
        setButtonText(text: string) {
            this.buttonEl.textContent = text;
            return this;
        }
        setDisabled(disabled: boolean) {
            this.buttonEl.disabled = disabled;
            return this;
        }
        onClick(fn: () => void) {
            this.buttonEl.addEventListener("click", fn);
            return this;
        }
    }
    return { ...actual, ButtonComponent };
});

// The helpers Obsidian adds to every element, as far as the dialog uses them
function make(parent: HTMLElement, tag: string, options: DomElementInfo = {}): HTMLElement {
    const el = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
    if (typeof options.cls === "string") el.className = options.cls;
    if (typeof options.text === "string") el.textContent = options.text;
    for (const [name, value] of Object.entries(options.attr ?? {})) {
        el.setAttribute(name, String(value));
    }
    parent.appendChild(el);
    return el;
}

beforeAll(() => {
    Object.assign(HTMLElement.prototype, {
        createEl(this: HTMLElement, tag: string, options?: DomElementInfo) {
            return make(this, tag, options);
        },
        createDiv(this: HTMLElement, options?: DomElementInfo) {
            return make(this, "div", options);
        },
        empty(this: HTMLElement) {
            this.replaceChildren();
        },
        addClass(this: HTMLElement, ...classes: string[]) {
            this.classList.add(...classes);
        },
        addClasses(this: HTMLElement, classes: string[]) {
            this.classList.add(...classes);
        },
        toggleClass(this: HTMLElement, cls: string, on: boolean) {
            this.classList.toggle(cls, on);
        },
    });
});

const settings: StudioSettings = cloneDefaultSettings();

/** Opens the dialog on a card of `type` with `text`; `fields` are the front and back text areas. */
function openEditor(type: CardType, text: string) {
    const opened: FlashcardEditModal[] = [];
    const open = jest.spyOn(FlashcardEditModal.prototype, "open").mockImplementation(function (
        this: FlashcardEditModal,
    ) {
        opened.push(this);
        this.onOpen();
    });
    const card = { question: { questionType: type } } as never;
    const result = FlashcardEditModal.Prompt({} as never, settings, card, text, TextDirection.Ltr);
    open.mockRestore();
    const { contentEl } = opened[0];
    const fields = Array.from(contentEl.querySelectorAll("textarea"));
    const save = () => contentEl.querySelector<HTMLButtonElement>(".fs-save-button")?.click();
    return { result, fields, save };
}

describe("saving the edit dialog", () => {
    test("a card saved without a change is not written to the note", async () => {
        const { result, save } = openEditor(
            CardType.MultiLineBasic,
            "- Capital of France\n  ?\n  Paris",
        );
        save();
        await expect(result).rejects.toBeInstanceOf(EditCancelled);
    });

    test("an edit of the question keeps the indentation of the answer and of the separator", async () => {
        const { result, fields, save } = openEditor(
            CardType.MultiLineBasic,
            "How to print?\n  ?\n    print('hi')\n    more",
        );
        expect(fields.map((field) => field.value)).toEqual([
            "How to print?",
            "    print('hi')\n    more",
        ]);
        fields[0].value = "How to print in Python?";
        save();
        await expect(result).resolves.toBe(
            "How to print in Python?\n  ?\n    print('hi')\n    more",
        );
    });
});
