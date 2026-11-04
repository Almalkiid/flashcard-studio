import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import { IReviewSession, UndoRecord } from "src/scheduling/review/review-session";
import { ReviewResponse } from "src/scheduling/schedule/review-item";
import { UndoHistory } from "src/scheduling/undo-history";
import ContentManager from "src/ui/obsidian-ui-components/content-container/review-screen";
import { SessionSummaryActions } from "src/ui/obsidian-ui-components/content-container/session-summary/session-summary";
import { UIState } from "src/ui/studio-ui";

import { ReviewSessionContext } from "../helpers/review-session-context";

jest.mock("obsidian", () => ({
    ...jest.requireActual<Record<string, unknown>>("../support/obsidian"),
    // Classes that modules of the review screen extend
    ButtonComponent: class {},
    DropdownComponent: class {},
    TextComponent: class {},
}));

// The card screen and the deck list draw what they are told; here they only record it
jest.mock("src/ui/obsidian-ui-components/content-container/card-container/card-screen", () => ({
    __esModule: true,
    default: class {
        openSession = jest.fn().mockResolvedValue(undefined);
        closeSession = jest.fn();
        drawCardFront = jest.fn().mockResolvedValue(undefined);
        drawBack = jest.fn().mockResolvedValue(undefined);
        drawPendingState = jest.fn();
        showSessionSummary = jest.fn();
        setSessionAnswers = jest.fn();
        invalidateMeaningCheck = jest.fn();
        hideAnswerToast = jest.fn();
        showAnswerToast = jest.fn();
        showFlag = jest.fn();
        isShowingSessionSummary = false;
        choosesByNumber = false;
    },
}));
jest.mock("src/ui/obsidian-ui-components/content-container/deck-container/deck-screen", () => ({
    __esModule: true,
    default: class {
        showList = jest.fn();
        closeList = jest.fn();
    },
}));

interface FakeCardPane {
    openSession: jest.Mock;
    closeSession: jest.Mock;
    drawCardFront: jest.Mock;
    drawBack: jest.Mock;
    showSessionSummary: jest.Mock<void, [unknown, SessionSummaryActions]>;
    setSessionAnswers: jest.Mock;
}

/** What the plugin's UI manager is asked to do by the review screen. */
class FakeUi {
    uiState = UIState.Closed;
    isStudioInFocus = true;
    contentManager: ContentManager | null = null;

    setUIState(state: UIState): void {
        this.uiState = state;
    }

    setStudioViewInFocus(focused: boolean): void {
        this.isStudioInFocus = focused;
    }
}

/**
 * Loads the review queue as ReviewQueueLoader does, from a note held in memory: a Review queue reads the note again,
 * a custom study queue (Cram) holds all of its cards.
 */
class FakeLoader {
    private reviewMode = FlashcardReviewMode.Review;
    private customStudy: unknown = null;
    private gate: Promise<void> | null = null;

    constructor(private readonly note: ReviewSessionContext) {}

    getReviewMode(): FlashcardReviewMode {
        return this.reviewMode;
    }

    setReviewMode(mode: FlashcardReviewMode): void {
        this.reviewMode = mode;
    }

    getCustomStudy(): unknown {
        return this.customStudy;
    }

    setCustomStudy(spec: unknown): void {
        this.customStudy = spec;
    }

    getSingleNote(): null {
        return null;
    }

    opensOnDeckList(): boolean {
        return false;
    }

    /** The next load waits until the returned function is called, as the rescan of a large vault does. */
    hold(): () => void {
        let release = (): void => undefined;
        this.gate = new Promise<void>((resolve) => (release = resolve));
        return release;
    }

    async loadReviewQueue(undoHistory: UndoHistory<UndoRecord>): Promise<IReviewSession> {
        const gate = this.gate;
        this.gate = null;
        if (gate !== null) await gate;
        if (this.reviewMode === FlashcardReviewMode.Cram) {
            const cram = await ReviewSessionContext.create(this.note.text, {
                mode: FlashcardReviewMode.Cram,
            });
            return cram.reviewSession;
        }
        this.note.undoHistory = undoHistory;
        await this.note.reopen();
        return this.note.reviewSession;
    }
}

const settings: StudioSettings = { ...DEFAULT_SETTINGS, reviewButtonDelay: 0 };

beforeAll(() => {
    Object.assign(window, { activeWindow: window, activeDocument: document });
});

// A review card (FSRS) that was due on 2023-09-02: due today, and gone from the session once answered Good
const DUE_REVIEW = "!fsrs,2023-09-02T00:00:00.000Z,4,4.5,5.2,2,3,0,0,2023-08-29T00:00:00.000Z";

async function setUp(text: string) {
    const note = await ReviewSessionContext.create(text);
    const loader = new FakeLoader(note);
    const ui = new FakeUi();
    const plugin = {
        uiManager: ui,
        dataManager: { reviewLog: { readAll: () => Promise.resolve(note.log.entries) } },
        manifest: { id: "flashcard-studio" },
    };
    const cm = new ContentManager(
        {} as never,
        plugin as never,
        loader as never,
        settings,
        document.createElementNS("http://www.w3.org/1999/xhtml", "div"),
    );
    ui.contentManager = cm;
    const cardPane = (cm as never as { cardPane: FakeCardPane }).cardPane;
    return { cm, note, loader, ui, cardPane };
}

/** Lets the work started by a button (which is not awaited) run to its end. */
const settle = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 0));

/** Answers the only card of the review Good, which ends the session on its summary. */
async function answerToSummary(cm: ContentManager, cardPane: FakeCardPane) {
    await cm.open();
    await cm._showAnswer();
    await cm._processReview(ReviewResponse.Good);
    expect(cardPane.showSessionSummary).toHaveBeenCalledTimes(1);
    return cardPane.showSessionSummary.mock.calls[0][1];
}

describe("a review closed while its cards are loading", () => {
    // The bug: the review went on into the cards once they had loaded, although it was closed. Its card screen came
    // back hidden, listening to the keys, and took the Space of every later review: it revealed and answered the cards
    // of a session nobody could see.
    test("Review mistakes stays closed", async () => {
        const { cm, loader, ui, cardPane } = await setUp(
            `#flashcards Q1::A1 <!--SR:${DUE_REVIEW}-->\n`,
        );
        const summary = await answerToSummary(cm, cardPane);
        const opened = cardPane.openSession.mock.calls.length;

        const release = loader.hold();
        summary.onReviewMistakes();
        cm.close();
        release();
        await settle();

        expect(cardPane.openSession).toHaveBeenCalledTimes(opened);
        expect(ui.uiState).toBe(UIState.Closed);
    });

    test("an undo that reloads the cards stays closed", async () => {
        const { cm, note, loader, ui, cardPane } = await setUp(
            `#flashcards Q1::A1 <!--SR:${DUE_REVIEW}-->\n`,
        );
        const summary = await answerToSummary(cm, cardPane);
        // Back to the decks: the answer now belongs to a session that has ended
        summary.onBackToDecks();
        await settle();
        const opened = cardPane.openSession.mock.calls.length;

        const release = loader.hold();
        const undo = cm.cardActions.undo();
        cm.close();
        release();
        await undo;

        // The answer is taken back all the same
        expect(note.log.entries).toHaveLength(0);
        expect(cardPane.openSession).toHaveBeenCalledTimes(opened);
        expect(ui.uiState).toBe(UIState.Closed);
    });
});
