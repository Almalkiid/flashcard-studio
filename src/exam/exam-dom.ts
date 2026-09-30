/**
 * Two small pieces of DOM behaviour the exam screens share, with no Obsidian in them.
 */

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Whether the target of an event is where the person types: a field, or an element edited in place. */
export function isEditable(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (el === null) return false;
    return el.isContentEditable === true || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * Keeps Tab inside a dialog: from the last control it goes to the first, with Shift from the first to the last, and a
 * Tab pressed while focus is outside the dialog is brought back into it. Tab between the controls is left alone.
 */
export function trapTab(container: HTMLElement): void {
    container.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key !== "Tab") return;
        const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (el) => !el.hasAttribute("disabled"),
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = container.ownerDocument.activeElement;
        const inside = active !== null && container.contains(active);
        if (event.shiftKey && (!inside || active === first)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (!inside || active === last)) {
            event.preventDefault();
            first.focus();
        }
    });
}
