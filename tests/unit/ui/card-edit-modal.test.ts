import { Notice } from "obsidian";

import { CardType } from "src/data/data-structures/card/question";
import { cloneDefaultSettings, StudioSettings } from "src/data/settings-model";
import { t } from "src/lang/translate";
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
    let settled = false;
    result.then(
        () => (settled = true),
        () => (settled = true),
    );
    // The promise settles in a microtask after the dialog acts
    const isSettled = async () => {
        await Promise.resolve();
        return settled;
    };
    return { result, fields, save, isSettled };
}

beforeEach(() => jest.mocked(Notice).mockClear());

describe("saving the edit dialog", () => {
    test.each([{ ctrlKey: true }, { metaKey: true }])(
        "Enter with %o saves the draft",
        async (modifier) => {
            const { result, fields } = openEditor(CardType.SingleLineBasic, "Q::A");
            fields[1].value = "B";
            const event = new KeyboardEvent("keydown", {
                key: "Enter",
                cancelable: true,
                ...modifier,
            });
            fields[1].dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
            await expect(result).resolves.toBe("Q::B");
        },
    );

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

    // A card with no schedule yet is written as it is: a line break left at its end put a blank line in the note, and
    // moved its block id to a line of its own
    test.each([
        { type: CardType.SingleLineBasic, text: "Q::A", field: 1, edit: "B\n", saved: "Q::B" },
        {
            type: CardType.MultiLineBasic,
            text: "Q\n?\nA",
            field: 1,
            edit: "B\n  \n",
            saved: "Q\n?\nB",
        },
        {
            type: CardType.Cloze,
            text: "A ==b== c",
            field: 0,
            edit: "A ==b== d\n",
            saved: "A ==b== d",
        },
    ])("line breaks typed at the end of $text are not saved", async (edit) => {
        const { result, fields, save } = openEditor(edit.type, edit.text);
        fields[edit.field].value = edit.edit;
        save();
        await expect(result).resolves.toBe(edit.saved);
    });

    test("only taking away the line break a tagged card with a schedule ends in is not a change", async () => {
        // The text of `#flashcards Q::A` with its schedule comment on the next line
        const { result, fields, save } = openEditor(CardType.SingleLineBasic, "Q::A\n");
        expect(fields[1].value).toBe("A\n");
        fields[1].value = "A";
        save();
        await expect(result).rejects.toBeInstanceOf(EditCancelled);
    });

    // The parser would read these back as another card, or none, and the schedule comment would be on the wrong line
    test.each([
        {
            name: "Enter at the end of the question",
            type: CardType.SingleLineBasic,
            text: "Capital of France::Paris",
            field: 0,
            refused: "Capital of France\n",
            fixed: "Capital of Italy",
            saved: "Capital of Italy::Paris",
        },
        {
            name: "a second line in a single-line answer",
            type: CardType.SingleLineBasic,
            text: "Q::A",
            field: 1,
            refused: "A\nB",
            fixed: "A B",
            saved: "Q::A B",
        },
        {
            name: "a paragraph break in a multi-line answer",
            type: CardType.MultiLineBasic,
            text: "Q\n?\nA",
            field: 1,
            refused: "A\n\nB",
            fixed: "A\nB",
            saved: "Q\n?\nA\nB",
        },
        {
            name: "a paragraph break in a cloze",
            type: CardType.Cloze,
            text: "Some ==text== here",
            field: 0,
            refused: "Some ==text==\n\nhere",
            fixed: "Some ==text==\nhere",
            saved: "Some ==text==\nhere",
        },
    ])("$name is refused, and the dialog stays open", async (edit) => {
        const { result, fields, save, isSettled } = openEditor(edit.type, edit.text);
        fields[edit.field].value = edit.refused;
        save();
        expect(Notice).toHaveBeenCalledWith(t("EDIT_NOT_READ_BACK"));
        expect(await isSettled()).toBe(false);

        fields[edit.field].value = edit.fixed;
        save();
        await expect(result).resolves.toBe(edit.saved);
    });

    test("a card this check does not read back as it is now can still be edited", async () => {
        // Not a card the parser finds under these settings: the check does not hold the edit to it
        const { result, fields, save } = openEditor(CardType.MultiLineBasic, "Q\n\n?\n\nA");
        fields[1].value = "A\n\nB";
        save();
        await expect(result).resolves.toBe("Q\n\n?\n\nA\n\nB");
        expect(Notice).not.toHaveBeenCalled();
    });
});
