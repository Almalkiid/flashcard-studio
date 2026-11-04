import { ExamSetupModal } from "src/exam/exam-setup-modal";

/** A deck in the dialog's list, as the dialog keeps it. */
interface Row {
    path: string;
    name: string;
    depth: number;
    count: number;
    below: string[];
}

/** The private parts of the dialog these tests reach. */
interface SetupInternals {
    rows: Row[];
    checked: Set<string>;
    selectedDecks(): string[];
    defaultTitle(): string;
}

/** The dialog's deck state without the plugin or the screen: only the deck list and what is ticked. */
function setupWith(rows: Row[], checked: string[]): SetupInternals {
    const setup = Object.create(ExamSetupModal.prototype) as SetupInternals;
    setup.rows = rows;
    setup.checked = new Set(checked);
    return setup;
}

/** Rows for decks given by path, parents before their children, as the dialog lists them. */
function rowsOf(paths: string[]): Row[] {
    return paths.map((path) => ({
        path,
        name: path.split("/").pop() ?? path,
        depth: path.split("/").length - 1,
        count: 1,
        below: paths.filter((other) => other.startsWith(path + "/")),
    }));
}

describe("the default title of the exam setup", () => {
    const rows = rowsOf(["CIA", "CIA/Part1", "CIA/Part2", "Law"]);

    test("names the top decks when every deck is ticked", () => {
        const setup = setupWith(
            rows,
            rows.map((row) => row.path),
        );
        expect(setup.defaultTitle()).toBe("Exam · CIA, Law");
    });

    test("names the decks chosen, leaving out a deck inside another chosen one", () => {
        expect(setupWith(rows, ["CIA/Part1", "Law"]).defaultTitle()).toBe("Exam · Part1, Law");
        expect(setupWith(rows, ["CIA", "CIA/Part1", "CIA/Part2"]).defaultTitle()).toBe(
            "Exam · CIA",
        );
    });

    test("works out the chosen decks once, however many decks there are", () => {
        // Every control of the dialog sets the title again, so with hundreds of decks a pass over the chosen decks
        // for each deck in the list froze the dialog on each click
        const paths = Array.from({ length: 50 }, (_, top) => [
            `Deck${top}`,
            ...Array.from({ length: 5 }, (_, sub) => `Deck${top}/Sub${sub}`),
        ]).flat();
        const setup = setupWith(
            rowsOf(paths),
            paths.filter((path) => path !== "Deck0/Sub0" && path !== "Deck0"),
        );
        const selectedDecks = jest.spyOn(setup, "selectedDecks");
        expect(setup.defaultTitle()).toBe("Exam · Sub1, Sub2, Sub3 +50");
        expect(selectedDecks).toHaveBeenCalledTimes(1);
    });
});
