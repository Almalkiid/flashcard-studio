import { isNewerVersion, StatusBarInput, statusItemStates } from "src/ui/status-bar-model";

const base: StatusBarInput = {
    show: true,
    showCards: true,
    showNotes: true,
    showUpdate: true,
    cardsDue: 12,
    notesDue: 3,
    updateAvailable: true,
};

describe("statusItemStates", () => {
    test("shows all three items with their counts", () => {
        const states = statusItemStates(base);
        expect(states.cards).toEqual({ visible: true, text: "Cards due: 12" });
        expect(states.notes).toEqual({ visible: true, text: "Notes due: 3" });
        expect(states.update).toEqual({
            visible: true,
            text: "Flashcard Studio: update available",
        });
    });

    test("the card and note items hide when nothing is due", () => {
        const states = statusItemStates({ ...base, cardsDue: 0, notesDue: 0 });
        expect(states.cards.visible).toBe(false);
        expect(states.notes.visible).toBe(false);
        expect(states.update.visible).toBe(true);
    });

    test("the update item hides when no update is known", () => {
        expect(statusItemStates({ ...base, updateAvailable: false }).update.visible).toBe(false);
    });

    test.each(["showCards", "showNotes", "showUpdate"] as const)(
        "the %s setting hides its own item only",
        (setting) => {
            const states = statusItemStates({ ...base, [setting]: false });
            const hidden = Object.entries(states).filter(([, state]) => !state.visible);
            expect(hidden).toHaveLength(1);
        },
    );

    test("the whole bar setting hides everything", () => {
        const states = statusItemStates({ ...base, show: false });
        expect(Object.values(states).some((state) => state.visible)).toBe(false);
    });
});

describe("isNewerVersion", () => {
    test.each([
        ["1.4.1", "1.4.0", true],
        ["v1.10.0", "1.9.9", true],
        ["2.0", "1.99.99", true],
        ["1.0.1", "1.0", true],
        ["1.4.0", "1.4.0", false],
        ["1.4.0", "1.4", false],
        ["1.3.9", "1.4.0", false],
        ["1.9.0", "1.10.0", false],
        ["1.5.0-beta.1", "1.4.0", true],
        ["latest", "1.4.0", false],
        ["1.4.0", "dev", false],
        ["", "1.0.0", false],
    ])("%s against installed %s: %s", (latest, installed, expected) => {
        expect(isNewerVersion(latest, installed)).toBe(expected);
    });
});
