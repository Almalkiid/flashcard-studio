import { CardType } from "src/data/data-structures/card/question";
import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import CardContainer from "src/ui/obsidian-ui-components/content-container/card-container/card-screen";
import {
    CardState,
    SessionData,
} from "src/ui/obsidian-ui-components/content-container/session-data";
import { TextDirection } from "src/utils/text";

// A plain element, made without the helpers Obsidian adds (createDiv and the like), which jsdom does not have
const mockElement = (tag: string): HTMLElement =>
    document.createElementNS("http://www.w3.org/1999/xhtml", tag);

// Obsidian is not there in a unit test: a stand-in renderer that fills in the text when told to, so a test can act
// while a card is still being drawn
type Pending = { text: string; el: HTMLElement; done: () => void };
const pending: Pending[] = [];
let autoRender = true;

jest.mock("obsidian", () => ({
    ...jest.requireActual<Record<string, unknown>>("../support/obsidian"),
    ButtonComponent: class {},
    DropdownComponent: class {},
    MarkdownRenderer: {
        render: (_app: unknown, text: string, el: HTMLElement) =>
            new Promise<void>((resolve) => {
                const done = () => {
                    el.appendChild(document.createTextNode(text));
                    resolve();
                };
                if (autoRender) done();
                else pending.push({ text, el, done });
            }),
    },
}));

// The bar above the card and the answer buttons have screens of their own; here they only need to be there
jest.mock(
    "src/ui/obsidian-ui-components/content-container/card-container/toolbar/card-toolbar",
    () => ({
        __esModule: true,
        default: class {
            setTypeAnswersToggle = jest.fn();
            setSpeakHandler = jest.fn();
            setResetButtonDisabled = jest.fn();
            updateInfo = jest.fn();
            setSessionAnswers = jest.fn();
            markSessionComplete = jest.fn();
        },
    }),
);
jest.mock(
    "src/ui/obsidian-ui-components/content-container/card-container/response-section/answer-row",
    () => ({
        __esModule: true,
        default: class {
            responseEl = mockElement("div");
            defaultButton = { buttonEl: mockElement("button") };
            resetResponseButtons = jest.fn();
            hideAllButtons = jest.fn();
            showRatingButtons = jest.fn();
            setSuggested = jest.fn();
        },
    }),
);

// The helpers Obsidian adds to every element
function make(parent: HTMLElement, tag: string, options: DomElementInfo | string = {}) {
    const o: DomElementInfo = typeof options === "string" ? { cls: options } : options;
    const el = mockElement(tag);
    if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : String(o.cls);
    if (typeof o.text === "string") el.textContent = o.text;
    for (const [key, value] of Object.entries(o.attr ?? {})) el.setAttribute(key, String(value));
    parent.appendChild(el);
    return el;
}

const obsidianHelpers = {
    createEl(this: HTMLElement, tag: string, options?: DomElementInfo | string): HTMLElement {
        return make(this, tag, options);
    },
    createDiv(this: HTMLElement, options?: DomElementInfo | string): HTMLElement {
        return make(this, "div", options);
    },
    createSpan(this: HTMLElement, options?: DomElementInfo | string): HTMLElement {
        return make(this, "span", options);
    },
    addClass(this: HTMLElement, ...classes: string[]): void {
        this.classList.add(...classes);
    },
    removeClass(this: HTMLElement, ...classes: string[]): void {
        this.classList.remove(...classes);
    },
    hasClass(this: HTMLElement, cls: string): boolean {
        return this.classList.contains(cls);
    },
    toggleClass(this: HTMLElement, cls: string, on: boolean): void {
        this.classList.toggle(cls, on);
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
    Object.assign(Node.prototype, {
        instanceOf(this: Node, type: abstract new () => unknown): boolean {
            return Object.prototype.isPrototypeOf.call(type.prototype, this);
        },
    });
    Object.assign(window, { activeWindow: window, activeDocument: document });
    // jsdom does not scroll
    Object.assign(Element.prototype, { scrollIntoView: (): void => undefined });
});

const containers: CardContainer[] = [];

beforeEach(() => {
    pending.length = 0;
    autoRender = true;
});

afterEach(() => {
    // A container left open would hear the keys of the next test
    for (const container of containers.splice(0)) container.closeSession();
    document.body.replaceChildren();
});

const settings: StudioSettings = {
    ...DEFAULT_SETTINGS,
    reviewLook: "classic",
    showContextInCards: false,
    readQuestionAloud: false,
    readAnswerAloud: false,
    shuffleChoices: false,
};

function setUp() {
    const onReveal = jest.fn();
    const onAnswer = jest.fn().mockResolvedValue(undefined);
    const plugin = {
        isInitialized: true,
        dataManager: { data: { settings } },
        uiManager: { isStudioInFocus: true, setStudioViewInFocus: jest.fn() },
    };
    const actions = {
        undo: jest.fn(),
        canUndo: () => false,
        suspend: jest.fn(),
        bury: jest.fn(),
        setFlag: jest.fn(),
        currentFlag: () => 0,
    };
    const parent = mockElement("div");
    document.body.appendChild(parent);
    const container = new CardContainer(
        {} as never,
        plugin as never,
        settings,
        parent,
        jest.fn(),
        jest.fn().mockResolvedValue(undefined),
        jest.fn(),
        onAnswer,
        jest.fn(),
        onReveal,
        jest.fn().mockResolvedValue(undefined),
        jest.fn(),
        actions,
    );
    containers.push(container);
    const view = parent.querySelector<HTMLElement>(".fs-card-container");
    if (view === null) throw new Error("no card view");
    const { response } = container as never as { response: { setSuggested: jest.Mock } };
    return { container, view, onReveal, onAnswer, response };
}

/** A session on one card, as the review screen hands it to the card screen. */
function sessionOn(front: string, back: string): SessionData {
    const deck = { deckName: "Deck", getTopicPath: () => ({ path: ["Deck"] }) };
    const stats = { cardsInQueueCount: 1, dueCount: 1, newCount: 0 };
    const question = {
        questionType: CardType.MultiLineBasic,
        questionText: { textDirection: TextDirection.Ltr },
    };
    const card = { front, back, meta: { flag: 0 }, question };
    return {
        cardData: { currentCard: card, cardState: CardState.Front },
        deckData: {
            chosenDeck: deck,
            currentDeck: deck,
            previousDeck: null,
            currentDeckTotalCardsInQueue: 1,
            chosenDeckStats: stats,
            currentDeckStats: stats,
            previousDeckStats: null,
        },
        totalCardsInSession: 1,
        totalDecksInSession: 1,
        currentQuestion: question,
        currentNote: { filePath: "Deck.md" },
    } as never;
}

const pressSpace = (): void => {
    document.body.dispatchEvent(
        new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true, cancelable: true }),
    );
};

describe("CardContainer.openSession", () => {
    test("shows the first card and takes the review keys", async () => {
        const { container, view, onReveal } = setUp();

        await container.openSession(sessionOn("Capital of France?", "Paris"), settings);

        expect(view.hasClass("fs-is-hidden")).toBe(false);
        pressSpace();
        expect(onReveal).toHaveBeenCalledTimes(1);
    });

    // The bug: a review closed while the first card of its session was being drawn came back on its own.
    // closeSession did nothing because the screen was still hidden, and openSession then showed it and listened to
    // the keys for good: the next review's Space went to the closed one, which answered cards that were not on screen.
    test("a close while the first card is drawn wins: the screen stays hidden and takes no keys", async () => {
        const { container, view, onReveal } = setUp();
        autoRender = false;

        const opening = container.openSession(sessionOn("Capital of France?", "Paris"), settings);
        container.closeSession();
        pending.splice(0).forEach((render) => render.done());
        await opening;

        expect(view.hasClass("fs-is-hidden")).toBe(true);
        pressSpace();
        pressSpace();
        expect(onReveal).not.toHaveBeenCalled();
    });

    test("the screen opens again after such a close", async () => {
        const { container, view, onReveal } = setUp();
        autoRender = false;
        const opening = container.openSession(sessionOn("Capital of France?", "Paris"), settings);
        container.closeSession();
        pending.splice(0).forEach((render) => render.done());
        await opening;

        autoRender = true;
        await container.openSession(sessionOn("Capital of Italy?", "Rome"), settings);

        expect(view.hasClass("fs-is-hidden")).toBe(false);
        expect(view.textContent).toContain("Capital of Italy?");
        pressSpace();
        expect(onReveal).toHaveBeenCalledTimes(1);
    });
});

describe("CardContainer.drawBack", () => {
    const textsOf = (view: HTMLElement, selector: string): string[] =>
        Array.from(view.querySelectorAll(selector)).map((el) => el.textContent ?? "");

    // The bug: the answer side drawn again after an edit (Edit on the answer side) kept the multiple choice state of
    // the front, with the answers and the explanation as they were before the edit. It marked the old answer right,
    // showed the old explanation and suggested a rating from the old answer key.
    test("after an edit, a multiple choice card shows the edited answer key and explanation", async () => {
        const { container, view, response } = setUp();
        const session = sessionOn(
            "Capital of France?",
            "- [x] Paris\n- [ ] Lyon\n\nOld explanation",
        );
        await container.openSession(session, settings);
        view.querySelector<HTMLElement>(".fs-choices .fs-choice")?.click();
        session.cardData.cardState = CardState.Back;
        await container.drawBack(session, FlashcardReviewMode.Review, settings, () => null);
        expect(textsOf(view, ".fs-choice.is-correct .fs-choice-text")).toEqual(["Paris"]);

        // Saved from the editor: the card's text changes in place, and the answer side is drawn again
        const card = session.cardData.currentCard;
        if (card === null) throw new Error("no card");
        card.back = "- [ ] Paris\n- [x] Lyon\n\nNew explanation";
        await container.drawBack(session, FlashcardReviewMode.Review, settings, () => null);

        expect(textsOf(view, ".fs-choice.is-correct .fs-choice-text")).toEqual(["Lyon"]);
        // The option chosen on the front stays chosen, and is now the wrong one
        expect(textsOf(view, ".fs-choice.is-wrong .fs-choice-text")).toEqual(["Paris"]);
        expect(textsOf(view, ".fs-choice-explanation-text")).toEqual(["New explanation"]);
        expect(response.setSuggested).toHaveBeenLastCalledWith(ReviewResponse.Again);
    });
});
