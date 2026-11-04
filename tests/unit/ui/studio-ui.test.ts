import { Card } from "src/data/data-structures/card/flashcard";
import { Deck } from "src/data/decks/deck";
import { TopicPath, TopicPathList } from "src/data/decks/topic-path";
import { ReviewItemState } from "src/scheduling/schedule/review-item";
import { StatusBarInput } from "src/ui/status-bar-model";
import { UIManager } from "src/ui/studio-ui";

// The screens the UI manager opens are built on Obsidian classes that the shared stand-in does not have
jest.mock("obsidian", () => ({
    ...jest.requireActual<Record<string, unknown>>("../support/obsidian"),
    ButtonComponent: class {},
}));

/** A UI manager with only the parts the status bar reads; the rest needs a running Obsidian. */
function managerWith(parts: Record<string, unknown>): UIManager {
    return Object.assign(Object.create(UIManager.prototype) as UIManager, parts);
}

/** The status bar input `updateStatusBar` gives for a vault whose cards left to review today are in `remaining`. */
function statusBarFor(remaining: Deck): Omit<StatusBarInput, "updateAvailable"> {
    const render = jest.fn<void, [Omit<StatusBarInput, "updateAvailable">]>();
    const manager = managerWith({
        plugin: {
            dataManager: {
                isVaultIndexLoaded: () => true,
                vaultIndex: { remainingRoot: remaining, noteReviewQueue: { dueNotesCount: 0 } },
            },
        },
        settingsManager: {
            settings: {
                showStatusBar: true,
                showCardStatusBarItem: true,
                showNoteStatusBarItem: true,
                showUpdateAvailableStatusBarItem: true,
            },
        },
        statusBar: { render },
    });
    manager.updateStatusBar();
    return render.mock.calls[0][0];
}

const card = (state: ReviewItemState) => ({ reviewItemState: state }) as unknown as Card;

describe("the status bar's card count", () => {
    // A question tagged with two decks puts the same card in both, and the status bar counted it once per deck
    test("counts a card that is in several decks once", () => {
        const root = new Deck("Root", null);
        const twoDecks = new TopicPathList([new TopicPath(["a"]), new TopicPath(["b"])]);
        for (let index = 0; index < 3; index++) {
            root.appendReviewItem(twoDecks, card(ReviewItemState.NewItem));
        }
        root.appendReviewItem(twoDecks, card(ReviewItemState.DueItem));
        root.appendReviewItem(
            new TopicPathList([new TopicPath(["a"])]),
            card(ReviewItemState.DueItem),
        );

        expect(statusBarFor(root).cardsDue).toBe(5);
    });

    test("is zero before the vault is scanned", () => {
        const render = jest.fn();
        const manager = managerWith({
            plugin: { dataManager: { isVaultIndexLoaded: () => false } },
            settingsManager: { settings: {} },
            statusBar: { render },
        });
        manager.updateStatusBar();
        expect(render).toHaveBeenCalledWith(expect.objectContaining({ cardsDue: 0, notesDue: 0 }));
    });
});
