import { setIcon } from "obsidian";

import type { Deck } from "src/data/data-structures/deck/deck";
import type { TopicPath } from "src/data/data-structures/deck/topic-path";
import { PRODUCT_NAME } from "src/data/product";
import type { SRSettings } from "src/data/settings";
import { IBaseLocale } from "src/lang/base-locale";
import { t } from "src/lang/helpers";
import type { DeckStats } from "src/scheduling/flashcard-review-sequencer";
import { deckToneOf, readableDeckName } from "src/ui/design/deck-identity";
import {
    clockText,
    topLevelDecks,
} from "src/ui/obsidian-ui-components/content-container/desktop/desktop-data";

/** A pane at least this wide (in pixels) gets the desktop layout; a narrower one keeps the phone layout. */
export const DESKTOP_MIN_WIDTH = 900;

/** Whether to draw the desktop layout: not on a phone or tablet, and only in a pane wide enough for it. */
export function useDesktopLayout(isMobile: boolean, paneWidth: number): boolean {
    return !isMobile && paneWidth >= DESKTOP_MIN_WIDTH;
}

/**
 * Whether the Studio opens as a full tab with the desktop interface, whatever "Open in new tab" says: on a computer,
 * with the Studio look, when the Desktop layout setting is on. The Classic look and the phone are not affected.
 */
export function desktopTabWanted(
    settings: Pick<SRSettings, "desktopLayout" | "reviewLook">,
    isMobile: boolean,
): boolean {
    return !isMobile && settings.desktopLayout && settings.reviewLook !== "classic";
}

/** What the pane is like, for `layoutToShow`. */
export interface LayoutContext {
    isMobile: boolean;
    /** The Desktop layout setting: off keeps the phone layout, in a tab too. */
    desktopLayout: boolean;
    /** The Classic look keeps the layout it has always had. */
    classic: boolean;
    /** The width of the pane in pixels; 0 when the pane is not shown. */
    paneWidth: number;
    /** A study session is in progress. */
    inSession: boolean;
}

/**
 * The layout that should be on screen, given the one that is. The width decides, except that:
 * - a pane that is not shown (a tab in the background is `display: none` and measures 0) says nothing about its
 *   width, so what is on screen stays;
 * - a session in progress keeps its layout, because switching rebuilds the screen and would drop the session. The
 *   switch happens when it is back on the deck list.
 */
export function layoutToShow(current: boolean, context: LayoutContext): boolean {
    if (context.paneWidth <= 0 || context.inSession) return current;
    return (
        context.desktopLayout &&
        !context.classic &&
        useDesktopLayout(context.isMobile, context.paneWidth)
    );
}

export type DesktopSection = "home" | "study" | "exams" | "browse" | "statistics" | "ai";

/**
 * What the shell's navigation does. An item whose action is absent is not shown at all.
 */
export interface DesktopShellActions {
    openHome(): void;
    startReviewOfDeck(deck: Deck): void;
    openExams?(): void;
    openBrowse(): void;
    openStatistics(): void;
    openAiGenerator?(): void;
    openSettings(): void;
}

interface NavItemSpec {
    section: DesktopSection | "settings";
    icon: string;
    label: keyof IBaseLocale;
    badge?: keyof IBaseLocale;
    run: (() => void) | undefined;
}

/**
 * Makes a div behave as a button: focusable, and Enter or Space press it. A click lets go of the focus it gives: the
 * screen that opens has keys of its own (Space shows the answer, Enter goes on), and they would press the item again.
 */
export function makePressable(el: HTMLElement, onPress: () => void): void {
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.addEventListener("click", (event: MouseEvent) => {
        // A pointer click has a detail; the click that a script makes has none, and keeps the focus where it was
        if (event.detail > 0) el.blur();
        onPress();
    });
    el.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onPress();
        }
    });
}

/**
 * The frame of the desktop interface: a sidebar (brand, navigation, the deck tree, settings), the main area where the
 * home or the study screen is drawn, and a right panel that only shows while studying. While studying the sidebar
 * shrinks to a rail of icons, so the card gets the room.
 */
export class DesktopShell {
    /** Where the home or the study screen is drawn. */
    readonly mainEl: HTMLElement;
    /** The right panel, only shown while studying. */
    readonly asideEl: HTMLElement;

    private readonly rootEl: HTMLElement;
    private readonly sideEl: HTMLElement;
    private readonly navEl: HTMLElement;
    private readonly treeEl: HTMLElement;
    private readonly actions: DesktopShellActions;
    private readonly navItems = new Map<string, HTMLElement>();
    private studyBadge: HTMLElement | null = null;
    private studyRoot: Deck | null = null;
    // Decks the person opened or closed, by deck path, so a redraw keeps the tree as they left it
    private readonly toggled = new Map<string, boolean>();
    private clockEl: HTMLElement | null = null;

    constructor(root: HTMLElement, actions: DesktopShellActions) {
        this.actions = actions;
        this.rootEl = root.createDiv({ cls: "fs-desktop-shell fs-studio" });
        this.rootEl.setAttribute("data-section", "home");

        const side = this.rootEl.createDiv({ cls: "fs-desktop-side" });
        this.sideEl = side;
        const brand = side.createDiv({ cls: "fs-desktop-brand" });
        setIcon(brand.createDiv({ cls: "fs-desktop-logo" }), "layers");
        brand.createSpan({ cls: "fs-desktop-brand-name", text: PRODUCT_NAME });

        this.navEl = side.createDiv({ cls: "fs-desktop-nav" });
        this.renderNav();

        side.createDiv({ cls: "fs-desktop-decks-label fs-label", text: t("DECKS") });
        this.treeEl = side.createDiv({ cls: "fs-desktop-tree" });
        this.treeEl.setAttribute("role", "tree");

        side.createDiv({ cls: "fs-desktop-spacer" });
        this.navItem(side, {
            section: "settings",
            icon: "settings",
            label: "OPEN_SETTINGS_SHORT",
            run: () => this.actions.openSettings(),
        });

        this.mainEl = this.rootEl.createDiv({ cls: "fs-desktop-main" });
        this.asideEl = this.rootEl.createDiv({ cls: "fs-desktop-aside fs-study-side-panel" });
    }

    /**
     * Highlights the section's item in the navigation. Studying collapses the sidebar to an icon rail and shows the
     * right panel.
     */
    setSection(section: DesktopSection): void {
        this.blurSidebar();
        this.rootEl.setAttribute("data-section", section);
        this.rootEl.toggleClass("is-study", section === "study");
        for (const [key, el] of this.navItems) {
            el.toggleClass("is-active", key === section);
            el.setAttribute("aria-current", key === section ? "page" : "false");
        }
    }

    /** Shrinks the sidebar to its icon rail, without the study side panel: an exam takes the room. */
    setRail(on: boolean): void {
        this.blurSidebar();
        this.rootEl.toggleClass("is-rail", on);
    }

    /**
     * Lets go of the focus when it is on a sidebar item. Opening a screen with the keyboard leaves the focus on the item
     * that opened it, which stays on screen in the rail, and the keys of the new screen would press it again.
     */
    private blurSidebar(): void {
        const focused = activeDocument.activeElement;
        if (focused?.instanceOf(HTMLElement) && this.sideEl.contains(focused)) focused.blur();
    }

    /** The count beside Study in the navigation: the cards to study now. */
    setDueCount(count: number): void {
        if (this.studyBadge === null) return;
        this.studyBadge.setText(count > 0 ? String(count) : "");
        this.studyBadge.toggleClass("is-empty", count === 0);
    }

    /**
     * Draws the deck tree: each deck with the cards to study and its total, and a click on a row studies that deck.
     * Decks with subdecks open and close; the top level starts open.
     */
    renderDeckTree(root: Deck, stats: (path: TopicPath) => DeckStats): void {
        this.studyRoot = root;
        this.treeEl.empty();
        for (const deck of topLevelDecks(root)) this.renderDeck(this.treeEl, deck, 0, stats);
    }

    /** Shows the session clock in the study top bar, or removes it with null. */
    setClock(elapsedMs: number | null): void {
        if (elapsedMs === null) {
            this.clockEl?.remove();
            this.clockEl = null;
            return;
        }
        if (this.clockEl === null || !this.clockEl.isConnected) {
            const menu = this.mainEl.querySelector(".sr-card-toolbar .sr-extended-menu-button");
            const toolbar = menu?.parentElement;
            if (!menu || !toolbar) return;
            this.clockEl = createDiv({ cls: "fs-desktop-clock" });
            setIcon(this.clockEl.createSpan({ cls: "fs-desktop-clock-icon" }), "clock");
            this.clockEl.createSpan({ cls: "fs-desktop-clock-text" });
            toolbar.insertBefore(this.clockEl, menu);
        }
        this.clockEl.querySelector(".fs-desktop-clock-text")?.setText(clockText(elapsedMs));
    }

    destroy(): void {
        this.clockEl = null;
        this.rootEl.remove();
    }

    private renderNav(): void {
        const specs: NavItemSpec[] = [
            {
                section: "home",
                icon: "home",
                label: "DESKTOP_NAV_HOME",
                run: () => this.actions.openHome(),
            },
            {
                section: "study",
                icon: "play",
                label: "DESKTOP_NAV_STUDY",
                run: () => {
                    if (this.studyRoot !== null) this.actions.startReviewOfDeck(this.studyRoot);
                },
            },
            {
                section: "exams",
                icon: "clipboard-check",
                label: "DESKTOP_NAV_EXAMS",
                run: this.actions.openExams?.bind(this.actions),
            },
            {
                section: "browse",
                icon: "search",
                label: "DESKTOP_NAV_BROWSE",
                run: () => this.actions.openBrowse(),
            },
            {
                section: "statistics",
                icon: "bar-chart-3",
                label: "OPEN_STATISTICS_SHORT",
                run: () => this.actions.openStatistics(),
            },
            {
                section: "ai",
                icon: "sparkles",
                label: "DESKTOP_NAV_AI",
                badge: "DESKTOP_BADGE_AI",
                run: this.actions.openAiGenerator?.bind(this.actions),
            },
        ];
        for (const spec of specs) {
            // Not available yet: hidden rather than disabled
            if (spec.run === undefined) continue;
            this.navItem(this.navEl, spec);
        }
    }

    private navItem(parent: HTMLElement, spec: NavItemSpec): void {
        const label = t(spec.label);
        const item = parent.createDiv({ cls: "fs-desktop-nav-item" });
        item.setAttribute("aria-label", label);
        item.setAttribute("data-tooltip-position", "right");
        setIcon(item.createSpan({ cls: "fs-desktop-nav-icon" }), spec.icon);
        item.createSpan({ cls: "fs-desktop-nav-label", text: label });
        if (spec.section === "study") {
            this.studyBadge = item.createSpan({ cls: "fs-desktop-nav-badge is-empty" });
        } else if (spec.badge !== undefined) {
            item.createSpan({ cls: "fs-desktop-nav-tag", text: t(spec.badge) });
        }
        const run = spec.run;
        if (run !== undefined) makePressable(item, run);
        this.navItems.set(spec.section, item);
    }

    private renderDeck(
        parent: HTMLElement,
        deck: Deck,
        depth: number,
        stats: (path: TopicPath) => DeckStats,
    ): void {
        const path = deck.getTopicPath();
        const key = path.path.join("/");
        const deckStats = stats(path);
        const toStudy = deckStats.dueCount + deckStats.newCount;
        const hasChildren = deck.subdecks.length > 0;
        const open = this.toggled.get(key) ?? depth === 0;

        const row = parent.createDiv({ cls: "fs-desktop-deck" });
        row.setAttribute("role", "treeitem");
        row.setAttribute("data-depth", String(Math.min(depth, 4)));
        row.setAttribute("aria-level", String(depth + 1));
        row.setCssProps({ "--fs-depth": String(depth) });

        const chevron = row.createSpan({ cls: "fs-desktop-deck-chevron" });
        if (hasChildren) {
            setIcon(chevron, open ? "chevron-down" : "chevron-right");
            row.setAttribute("aria-expanded", String(open));
        }
        if (depth === 0) {
            row.createSpan({ cls: `fs-desktop-deck-dot fs-tone-${deckToneOf(deck.deckName)}` });
        }
        row.createSpan({ cls: "fs-desktop-deck-name", text: readableDeckName(deck.deckName) });
        const counts = row.createSpan({ cls: "fs-desktop-deck-counts" });
        if (toStudy > 0) {
            counts.createEl("b", { text: String(toStudy) });
            counts.createSpan({ text: ` · ${deckStats.totalCount}` });
        } else {
            counts.createSpan({ text: String(deckStats.totalCount) });
        }

        const children = parent.createDiv({ cls: "fs-desktop-deck-children" });
        children.toggleClass("sr-is-hidden", !open);
        if (hasChildren) {
            for (const child of deck.subdecks) this.renderDeck(children, child, depth + 1, stats);
        }

        makePressable(row, () => this.actions.startReviewOfDeck(deck));
        if (hasChildren) {
            chevron.addEventListener("click", (event) => {
                event.stopPropagation();
                const nowOpen = children.hasClass("sr-is-hidden");
                this.toggled.set(key, nowOpen);
                children.toggleClass("sr-is-hidden", !nowOpen);
                row.setAttribute("aria-expanded", String(nowOpen));
                chevron.empty();
                setIcon(chevron, nowOpen ? "chevron-down" : "chevron-right");
            });
        }
    }
}
