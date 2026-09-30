import { isEditable, trapTab } from "src/exam/exam-dom";

// The helpers Obsidian adds to every element are not there in a unit test
const create = <T extends HTMLElement = HTMLElement>(tag: string): T =>
    document.createElementNS("http://www.w3.org/1999/xhtml", tag) as T;

function dialog(): {
    box: HTMLElement;
    first: HTMLButtonElement;
    middle: HTMLButtonElement;
    last: HTMLButtonElement;
} {
    const box = create("div");
    const first = create<HTMLButtonElement>("button");
    const middle = create<HTMLButtonElement>("button");
    const last = create<HTMLButtonElement>("button");
    box.append(first, middle, last);
    document.body.append(box);
    trapTab(box);
    return { box, first, middle, last };
}

function press(el: HTMLElement, shiftKey = false): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey,
        bubbles: true,
        cancelable: true,
    });
    el.dispatchEvent(event);
    return event;
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("trapTab", () => {
    test("Tab from the last control goes to the first, and Shift+Tab from the first to the last", () => {
        const { first, last } = dialog();
        last.focus();
        expect(press(last).defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(first);
        expect(press(first, true).defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(last);
    });

    test("Tab between the controls in the middle is left to the browser", () => {
        const { first, middle } = dialog();
        first.focus();
        expect(press(first).defaultPrevented).toBe(false);
        middle.focus();
        expect(press(middle, true).defaultPrevented).toBe(false);
    });

    test("a Tab from outside the dialog is brought back into it", () => {
        const { first, last } = dialog();
        const outside = create("button");
        document.body.append(outside);
        outside.focus();
        // The listener is on the dialog, so the event has to be sent to it while focus is elsewhere
        const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
        first.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(first);
        const back = new KeyboardEvent("keydown", {
            key: "Tab",
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        });
        outside.focus();
        last.dispatchEvent(back);
        expect(document.activeElement).toBe(last);
    });

    test("other keys are not touched, and a dialog with no controls is left alone", () => {
        const { first } = dialog();
        const event = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
        first.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        const empty = create("div");
        document.body.append(empty);
        trapTab(empty);
        expect(press(empty).defaultPrevented).toBe(false);
    });

    test("a disabled control is skipped", () => {
        const { first, middle, last } = dialog();
        last.disabled = true;
        middle.focus();
        expect(press(middle).defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(first);
    });
});

describe("isEditable", () => {
    test("a field where the person types is editable, a button is not", () => {
        expect(isEditable(create("input"))).toBe(true);
        expect(isEditable(create("textarea"))).toBe(true);
        expect(isEditable(create("select"))).toBe(true);
        expect(isEditable(create("button"))).toBe(false);
        expect(isEditable(create("div"))).toBe(false);
        expect(isEditable(null)).toBe(false);
        expect(isEditable(document)).toBe(false);
    });

    test("an element that can be edited in place is editable", () => {
        const div = create("div");
        Object.defineProperty(div, "isContentEditable", { value: true });
        expect(isEditable(div)).toBe(true);
    });
});
