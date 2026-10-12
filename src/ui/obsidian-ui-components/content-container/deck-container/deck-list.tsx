import "src/ui/obsidian-ui-components/content-container/deck-container/deck-list.css";
import { setIcon } from "obsidian";

import { Deck } from "src/data/decks/deck";
import { StudioSettings } from "src/data/settings-model";
import { t } from "src/lang/translate";
import { IReviewSession } from "src/scheduling/review/review-session";
import { hiddenByLimitText } from "src/ui/deck-counts";
import {
    HomeActions,
    renderStudioHome,
} from "src/ui/obsidian-ui-components/content-container/deck-container/studio-home";
import {
    DesktopHomeServices,
    renderDesktopHome,
} from "src/ui/obsidian-ui-components/content-container/desktop/desktop-home";
import { makePressable } from "src/ui/obsidian-ui-components/content-container/desktop/desktop-shell";

const HIDDEN = "fs-is-hidden";

/** What the Studio home needs from outside the deck list. */
export type HomeServices = Omit<HomeActions, "startReviewOfDeck" | "learnerName"> & {
    /** Set inside the desktop shell: the deck list then draws the desktop home in place of the Studio home. */
    desktop?: DesktopHomeServices;
};

/**
 * The deck screen's body. The Studio look draws a home (decks as cards, insights, or the desktop dashboard); the Classic
 * look, and a library with no cards at all, draw a table: one row per deck with its due, new, seen and total counts.
 */
export default class DeckListComponent {
    private readonly content: HTMLDivElement;
    private readonly treeHeaderRow: HTMLDivElement;
    private readonly treeContainer: HTMLDivElement;
    // The Studio look's home screen, shown instead of the table
    private readonly homeEl: HTMLDivElement;
    private readonly startReviewOfDeck: (deck: Deck) => void;
    private readonly homeServices: HomeServices | null;

    public constructor(
        parentEl: HTMLElement,
        startReviewOfDeck: (deck: Deck) => void,
        homeServices: HomeServices | null = null,
    ) {
        this.startReviewOfDeck = startReviewOfDeck;
        this.homeServices = homeServices;

        const scrollWrapper = parentEl.createDiv({ cls: "fs-scroll-wrapper" });
        this.content = scrollWrapper.createDiv({ cls: "fs-content" });
        this.treeHeaderRow = this.content.createDiv({
            cls: "fs-tree-row fs-header-row tree-item fs-tree-item-container",
        });
        this.drawHeaderRow(this.treeHeaderRow);
        this.treeContainer = this.content.createDiv({ cls: "fs-tree-container" });
        this.homeEl = this.content.createDiv("fs-home");
    }

    public redraw(reviewSession: IReviewSession, settings: StudioSettings): void {
        this.treeContainer.empty();
        const root = reviewSession.originalRoot;
        const rootStats = reviewSession.getDeckStats(root.getTopicPath());

        const studio =
            settings.reviewLook !== "classic" &&
            rootStats.totalCount > 0 &&
            this.homeServices !== null;
        this.treeHeaderRow.toggleClass(HIDDEN, studio || rootStats.totalCount === 0);
        this.treeContainer.toggleClass(HIDDEN, studio);
        this.homeEl.toggleClass(HIDDEN, !studio);
        if (studio && this.homeServices !== null) {
            const { desktop, ...services } = this.homeServices;
            const actions = {
                ...services,
                startReviewOfDeck: this.startReviewOfDeck,
                learnerName: settings.learnerName,
            };
            if (desktop === undefined) {
                renderStudioHome(this.homeEl, reviewSession, actions);
            } else {
                renderDesktopHome(this.homeEl, reviewSession, {
                    ...actions,
                    ...desktop,
                    retentionTarget: settings.fsrsDesiredRetention,
                    modeLabel: desktop.modeLabel(),
                });
            }
            return;
        }

        if (rootStats.totalCount === 0) {
            this.treeContainer.createDiv({
                cls: "fs-no-decks-to-review",
                text: t("NO_DECKS_TO_REVIEW", { tags: settings.flashcardTags.join(", ") }),
            });
            return;
        }
        this.drawRow(root, t("ALL_DECKS"), reviewSession, settings, this.treeContainer, true);
        for (const subdeck of root.subdecks) {
            this.drawRow(subdeck, subdeck.deckName, reviewSession, settings, this.treeContainer);
        }
    }

    private drawHeaderRow(row: HTMLElement): void {
        const self = row.createDiv({ cls: "tree-item-self fs-tree-item-row" });
        const inner = self.createDiv({ cls: "tree-item-inner" });
        inner.createDiv({ cls: "tag-pane-tag-text" }).createSpan({
            cls: "tag-pane-tag-self fs-tree-row-text",
            text: t("DECK_TITLE_COLUMN"),
        });
        const labels = self.createDiv({
            cls: "tree-item-flair-outer fs-tree-stats-container",
        });
        const label = (text: string, color: string): void => {
            labels.createSpan({
                cls: `tag-pane-tag-count tree-item-flair fs-tree-stats-count fs-tree-numbers-text ${color}`,
                text,
            });
        };
        label(t("DUE"), "fs-fg-green");
        label(t("NEW"), "fs-fg-blue");
        label(t("SEEN"), "fs-fg-yellow");
        label(t("TOTAL"), "fs-fg-red");
    }

    /** A deck's row and, below it, the rows of its subdecks. The first row ("All Decks") has no subdecks below it. */
    private drawRow(
        deck: Deck,
        name: string,
        reviewSession: IReviewSession,
        settings: StudioSettings,
        parent: HTMLElement,
        isRoot: boolean = false,
    ): void {
        const stats = reviewSession.getDeckStats(deck.getTopicPath());
        const hasSubdecks = !isRoot && deck.subdecks.length > 0;
        const clickable = stats.dueCount + stats.newCount > 0;

        const row = parent.createDiv({ cls: "fs-tree-row tree-item fs-tree-item-container" });
        const self = row.createDiv({
            cls: `tree-item-self fs-tree-item-row ${clickable ? "is-clickable tag-pane-tag" : "is-disabled"}`,
        });
        const chevron = self.createDiv({ cls: "tree-item-icon collapse-icon" });
        setIcon(chevron, "chevron-down");
        chevron.toggleClass(HIDDEN, !hasSubdecks);

        const inner = self.createDiv({ cls: "tree-item-inner" });
        inner
            .createDiv({ cls: "tag-pane-tag-text" })
            .createSpan({ cls: "tag-pane-tag-self fs-tree-row-text", text: name });
        const hidden = hiddenByLimitText(stats);
        if (hidden !== "") inner.createDiv({ cls: "fs-tree-hidden-note", text: hidden });

        const counts = self.createDiv({ cls: "tree-item-flair-outer fs-tree-stats-container" });
        const pill = (count: number, color: string, label: string): void => {
            counts.createSpan({
                cls: `tag-pane-tag-count tree-item-flair fs-tree-stats-count ${color}${count === 0 ? " fs-is-zero" : ""}`,
                text: String(count),
                attr: { "aria-label": label },
            });
        };
        pill(stats.dueCount, "fs-bg-green", t("DUE_CARDS"));
        pill(stats.newCount, "fs-bg-blue", t("NEW_CARDS"));
        pill(stats.totalCount - stats.newCount - stats.dueCount, "fs-bg-yellow", t("SEEN_CARDS"));
        pill(stats.totalCount, "fs-bg-red", t("TOTAL_CARDS"));

        const children = row.createDiv({ cls: "tree-item-children" });
        if (clickable) makePressable(self, () => this.startReviewOfDeck(deck));
        else self.setAttribute("aria-disabled", "true");

        children.toggleClass(HIDDEN, !hasSubdecks && !isRoot);
        if (!hasSubdecks) return;
        let collapsed = !settings.initiallyExpandAllSubdecksInTree;
        const show = (): void => {
            chevron.toggleClass("is-collapsed", collapsed);
            children.toggleClass("fs-is-hidden", collapsed);
            self.setAttribute("aria-expanded", String(!collapsed));
        };
        show();
        chevron.addEventListener("click", (event) => {
            event.stopPropagation();
            collapsed = !collapsed;
            show();
        });
        // A deck row is a button that starts the review, so the arrow keys open and close its subdecks
        self.addEventListener("keydown", (event) => {
            if (event.target !== self) return;
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            collapsed = event.key === "ArrowLeft";
            event.preventDefault();
            show();
        });
        for (const subdeck of deck.subdecks) {
            this.drawRow(subdeck, subdeck.deckName, reviewSession, settings, children);
        }
    }
}
