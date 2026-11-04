import { ExamResult } from "src/exam/exam";
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
    recent: ExamResult[];
    selectedDecks(): string[];
    defaultTitle(): string;
    renderRecent(parent: HTMLElement): void;
}

/** An element, made the way jsdom has it: the element helpers Obsidian adds are not there in a unit test. */
function create(tag: string): HTMLElement {
    return document.createElementNS("http://www.w3.org/1999/xhtml", tag);
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

describe("the recent exams of the exam setup", () => {
    // The element helpers Obsidian adds, as many of them as the list uses
    beforeAll(() => {
        function make(parent: HTMLElement, tag: string, options: DomElementInfo = {}): HTMLElement {
            const el = create(tag);
            if (typeof options.cls === "string") el.className = options.cls;
            if (typeof options.text === "string") el.textContent = options.text;
            parent.appendChild(el);
            return el;
        }
        Object.assign(HTMLElement.prototype, {
            createDiv(this: HTMLElement, options?: DomElementInfo): HTMLElement {
                return make(this, "div", options);
            },
            createSpan(this: HTMLElement, options?: DomElementInfo): HTMLElement {
                return make(this, "span", options);
            },
            toggleClass(this: HTMLElement, cls: string, on: boolean): void {
                this.classList.toggle(cls, on);
            },
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    /** When the list says an exam that ended at `endedMs` was taken. */
    function whenShown(endedMs: number): string {
        const setup = Object.create(ExamSetupModal.prototype) as SetupInternals;
        setup.recent = [
            {
                setup: { title: "Exam" },
                right: 1,
                total: 1,
                percent: 100,
                passed: true,
                startedMs: endedMs - 60_000,
                endedMs,
            } as ExamResult,
        ];
        const parent = create("div");
        setup.renderRecent(parent);
        const detail = parent.querySelector(".fs-exam-recent-detail")?.textContent ?? "";
        return detail.split(" · ").pop() ?? "";
    }

    test("says today and yesterday by the day the exam ended, not by 24 hours", () => {
        jest.useFakeTimers({ now: new Date(2026, 10, 4, 9) });
        expect(whenShown(new Date(2026, 10, 4, 8).getTime())).toBe("today");
        // 10 hours ago, but on the day before
        expect(whenShown(new Date(2026, 10, 3, 23).getTime())).toBe("yesterday");
        // 34 hours ago, two days before
        expect(whenShown(new Date(2026, 10, 2, 23).getTime())).not.toMatch(/today|yesterday/);
    });
});
