import type { App } from "obsidian";

import { emptyCardMeta } from "src/data/card-meta";
import { Card } from "src/data/data-structures/card/flashcard";
import { CardType, Question } from "src/data/data-structures/card/question";
import { Deck } from "src/data/decks/deck";
import { TopicPath, TopicPathList } from "src/data/decks/topic-path";
import { cloneDefaultSettings, StudioSettings } from "src/data/settings-model";
import {
    emptyAnswer,
    ExamCardFilter,
    ExamCardInput,
    ExamResult,
    ExamSetup,
    pickExamQuestions,
    summarizeExam,
} from "src/exam/exam";
import { ExamDraft, makeDraft } from "src/exam/exam-draft";
import { ExamSetupModal, ExamSource, startingSource } from "src/exam/exam-setup-modal";
import type FlashcardStudioPlugin from "src/studio-plugin";

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
    cards: ExamCardInput[];
    drafts: ExamDraft[];
    contentEl: HTMLElement;
    source: ExamSource;
    notes: string[];
    filter: ExamCardFilter;
    count: number;
    goneNotes: string[];
    statusEl: HTMLElement | null;
    startButton: HTMLButtonElement | null;
    selectedDecks(): string[];
    defaultTitle(): string;
    baseSetup(): ExamSetup;
    renderRecent(parent: HTMLElement): void;
    renderNotes(field: HTMLElement): void;
    refresh(): void;
    onOpen(): void;
}

/** A vault with one card in each note given, in the deck named by the note's folder. */
function vaultOf(notes: string[]): Deck {
    const tree = new Deck("root", null);
    notes.forEach((path, index) => {
        const question = {
            topicPathList: new TopicPathList([new TopicPath([path.split("/")[0]])]),
            questionType: CardType.MultiLineBasic,
            note: { filePath: path },
            questionText: { textHash: `h${index}` },
        } as unknown as Question;
        const meta = emptyCardMeta();
        meta.id = `c${index}`;
        const card = new Card({
            question,
            meta,
            front: `Question ${index}?`,
            back: `Answer ${index}`,
            cardIdx: 0,
        });
        tree.appendReviewItem(question.topicPathList, card);
    });
    return tree;
}

/**
 * The dialog made as the plugin makes it, for a plugin with only what the dialog reads: the notes with a card, the
 * settings, the AI key, and the last exam's setup.
 */
function openedSetup(options: {
    notes: string[];
    last?: ExamSetup;
    settings?: StudioSettings;
    key?: string;
}): SetupInternals {
    const settings = options.settings ?? cloneDefaultSettings();
    const app = { secretStorage: { getSecret: () => options.key ?? "" } } as unknown as App;
    const plugin = {
        app,
        dataManager: {
            vaultIndex: { reviewableRoot: vaultOf(options.notes) },
            data: { settings },
        },
    } as unknown as FlashcardStudioPlugin;
    const recent = options.last === undefined ? [] : [summarizeExam(options.last, [], 0, 60_000)];
    return new ExamSetupModal(plugin, recent, [], () => undefined) as unknown as SetupInternals;
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

// The element helpers Obsidian adds, as many of them as the dialog uses
beforeAll(() => {
    Object.assign(window, { activeWindow: window, activeDocument: document });
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
        createEl(this: HTMLElement, tag: string, options?: DomElementInfo): HTMLElement {
            return make(this, tag, options);
        },
        toggleClass(this: HTMLElement, cls: string, on: boolean): void {
            this.classList.toggle(cls, on);
        },
        addClass(this: HTMLElement, ...cls: string[]): void {
            this.classList.add(...cls);
        },
        removeClass(this: HTMLElement, ...cls: string[]): void {
            this.classList.remove(...cls);
        },
        setCssProps(this: HTMLElement, props: Record<string, string>): void {
            for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
        },
        empty(this: HTMLElement): void {
            this.replaceChildren();
        },
        setText(this: HTMLElement, text: string): void {
            this.textContent = text;
        },
    });
});

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

describe("a retake of an exam from notes", () => {
    const LAST: ExamSetup = {
        decks: [],
        count: 20,
        minutes: null,
        filter: "all",
        passPercent: 75,
        title: "Exam · Cell, DNA, Genes",
        notes: ["Biology/Cell.md", "Biology/DNA.md", "Biology/Genes.md"],
    };

    test("keeps the notes that can still give questions, and names the ones that cannot", () => {
        const askable = new Map([
            ["Biology/Cell.md", 4],
            ["Biology/Genes.md", 0],
        ]);
        expect(startingSource(LAST, undefined, askable)).toEqual({
            source: "notes",
            notes: ["Biology/Cell.md"],
            gone: ["Biology/DNA.md", "Biology/Genes.md"],
        });
        // An exam from decks starts from decks as before, and a note it was opened for wins
        expect(startingSource({ ...LAST, notes: undefined }, undefined, askable)).toEqual({
            source: "decks",
            notes: [],
            gone: [],
        });
        expect(startingSource(LAST, "Other.md", askable)).toEqual({
            source: "notes",
            notes: ["Other.md"],
            gone: [],
        });
    });

    test("whose notes are all gone stays on Notes with none chosen, and Start waits for a note", () => {
        expect(startingSource(LAST, undefined, new Map([["Physics/Force.md", 3]]))).toEqual({
            source: "notes",
            notes: [],
            gone: LAST.notes,
        });

        // The vault still has a card in a deck: it must not become the exam
        const setup = openedSetup({ notes: ["Physics/Force.md"], last: LAST });
        expect(setup.cards.map((card) => card.deck)).toEqual(["Physics"]);
        expect(setup.source).toBe("notes");
        expect(setup.notes).toEqual([]);
        expect(setup.goneNotes).toEqual(LAST.notes);
        expect(setup.baseSetup()).toMatchObject({ decks: [], notes: [] });

        setup.onOpen();
        expect(setup.startButton?.disabled).toBe(true);
        expect(setup.statusEl?.textContent).toBe("Add a note to take the exam from.");
        // The notes left out are named, so the person knows what went
        expect(setup.contentEl.querySelector(".fs-exam-notes-gone")?.textContent).toBe(
            "These notes from the last exam are no longer available: Cell, DNA, Genes. They were renamed or deleted, or have no cards to ask.",
        );
    });
});

describe("the exam setup with no cards in the vault", () => {
    test("still offers the unfinished exams, which hold their own questions, before saying so", () => {
        const setup: ExamSetup = {
            decks: [],
            count: 1,
            minutes: null,
            filter: "all",
            passPercent: 75,
            title: "Exam · Physics",
        };
        const card: ExamCardInput = {
            id: "p1",
            deck: "Physics",
            front: "What is a newton?",
            back: "A unit of force",
            isCloze: false,
            suspended: false,
        };
        const questions = pickExamQuestions([card], setup, () => 0);
        const modal = Object.create(ExamSetupModal.prototype) as SetupInternals;
        Object.assign(modal, {
            contentEl: create("div"),
            cards: [],
            drafts: [
                makeDraft(
                    {
                        setup,
                        questions,
                        answers: questions.map(emptyAnswer),
                        current: 0,
                        startedMs: Date.now(),
                    },
                    Date.now(),
                ),
            ],
        });
        modal.onOpen();

        const content = modal.contentEl;
        expect(content.querySelector(".fs-exam-draft-title")?.textContent).toBe("Exam · Physics");
        expect(content.querySelector(".fs-exam-draft-resume")).not.toBeNull();
        const empty = content.querySelector(".fs-exam-empty");
        expect(empty?.textContent).toBe("There are no cards to make an exam from yet.");
        // The unfinished exam comes first; only starting a new one is left out
        const drafts = content.querySelector(".fs-exam-resume");
        expect(
            drafts !== null &&
                empty !== null &&
                drafts.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(content.querySelector(".fs-exam-start")).toBeNull();
        expect(content.querySelector(".fs-exam-presets")).toBeNull();
    });
});
