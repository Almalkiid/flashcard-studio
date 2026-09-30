import "src/ui/obsidian-ui-components/item-views/tab-view.css";
import "src/ui/obsidian-ui-components/content-container/desktop/desktop-shell.css";
import "src/ui/obsidian-ui-components/content-container/desktop/desktop-home.css";
import { ItemView, Platform, WorkspaceLeaf } from "obsidian";

import { SR_TAB_VIEW } from "src/data/constants";
import { PRODUCT_NAME } from "src/data/product";
import { SRSettings } from "src/data/settings";
import SRPlugin from "src/main";
import ContentManager from "src/ui/obsidian-ui-components/content-container/content-manager";
import { layoutToShow } from "src/ui/obsidian-ui-components/content-container/desktop/desktop-shell";
import { ReviewQueueLoader } from "src/ui/review-queue-loader";
import EmulatedPlatform from "src/utils/platform-detector";

/**
 * Represents a tab view for spaced repetition plugin.
 *
 * This class extends the ItemView and is used to display the deck and flashcard uis.
 *
 * @property {SRPlugin} plugin - The main plugin instance.
 * @property {SRPlugin} leaf - The leaf instance for the view.
 * @property {ReviewQueueLoader} reviewQueueLoader - The review queue loader instance.
 *
 * @method getViewType - Returns the view type identifier.
 * @method getIcon - Returns the icon identifier for the view.
 * @method getDisplayText - Returns the display text for the view.
 * @method onOpen - Initializes the view and loads necessary data when opened.
 * @method onClose - Cleans up resources when the view is closed.
 */
export class SRTabView extends ItemView {
    private reviewQueueLoader: ReviewQueueLoader | null = null;
    private contentManager: ContentManager | null = null;

    private plugin: SRPlugin | null = null;
    private viewContainerEl: HTMLElement | null = null;
    private viewContentEl: HTMLElement | null = null;
    private settings: SRSettings | null = null;
    private resizeObserver: ResizeObserver | null = null;
    // Whether the content on screen is drawn with the desktop shell, so a resize only rebuilds it when that changes
    private desktopLayout: boolean = false;
    private rebuilding: boolean = false;
    private rebuildAgain: boolean = false;

    constructor(
        leaf: WorkspaceLeaf,
        plugin: SRPlugin,
        settings: SRSettings,
        reviewQueueLoader: ReviewQueueLoader | null,
    ) {
        super(leaf);

        if (!plugin.isDataManagerLoaded()) {
            this.leaf.detach();
            return;
        }

        // throw new Error("SR plugin or data not initialized!!!");
        // Init properties
        this.plugin = plugin;
        this.navigation = false;
        this.settings = settings;
        this.reviewQueueLoader = reviewQueueLoader;

        // Build ui
        const viewContent = this.containerEl.getElementsByClassName("view-content");

        if (viewContent.length === 0) return;

        this.viewContainerEl = viewContent[0] as HTMLElement;
        this.viewContainerEl.addClass("sr-tab-view");
        this.viewContainerEl.addClass("sr-view");

        this.viewContentEl = this.viewContainerEl.createDiv("sr-tab-view-content");
        const isMobile: boolean = Platform.isMobile || EmulatedPlatform().isMobile;
        const heightPercent: number = isMobile
            ? this.settings.flashcardHeightPercentageMobile
            : this.settings.flashcardHeightPercentage;

        const widthPercent: number = isMobile
            ? this.settings.flashcardWidthPercentageMobile
            : this.settings.flashcardWidthPercentage;

        this.setSize(widthPercent, heightPercent);

        if (heightPercent < 100 || widthPercent < 100) {
            this.viewContentEl.addClass("sr-center-view");
        }
    }

    /**
     * Returns the view type identifier for the SRTabView.
     *
     * @returns {string} The view type identifier.
     */
    getViewType() {
        return SR_TAB_VIEW;
    }

    /**
     * Retrieves the icon identifier for the SRTabView.
     *
     * @returns {string} The tab icon identifier.
     */
    getIcon() {
        return "SpacedRepIcon";
    }

    /**
     * Returns the display text for the SRTabView.
     *
     * @returns {string} The display text for the SRTabView.
     */
    getDisplayText() {
        return PRODUCT_NAME;
    }

    /**
     * Initializes the SRTabView when opened by loading the review sequencer data
     * and setting up the deck and flashcard views if they are not already initialized.
     */
    async onOpen() {
        // This happens when the tab was open before the plugin was loaded -> Closing and reopening the obsidian window
        // So we have to wait for the plugin to load and just ignore this
        if (
            this.viewContainerEl === null ||
            this.viewContentEl === null ||
            this.reviewQueueLoader === null
        )
            return;

        // Reposition the navbar if it's mobile, because lese it overlaps the buttons in the tab view
        if (activeDocument.body.classList.contains("is-mobile")) {
            const mobileNavbar = activeDocument.getElementsByClassName("mobile-navbar")[0];
            if (mobileNavbar) {
                (mobileNavbar as HTMLElement).setCssProps({ position: "relative" });
            }
        }

        // Removes the bottom fade mask if it's mobile and floating nav, because else it overlaps the bottom part of the flashcard and makes it hard to read
        if (
            activeDocument.body.classList.contains("is-phone") &&
            activeDocument.body.classList.contains("is-floating-nav")
        ) {
            activeDocument.body.addClass("sr-reduced-bottom-fade-mask");
        }

        if (this.settings === null || this.plugin === null) {
            this.leaf.detach();
            return;
        }

        await this.buildContent();

        // The desktop layout needs a wide pane: a narrow split, or a window made narrower, gets the phone layout
        this.resizeObserver = new ResizeObserver(() => this.switchLayoutIfNeeded());
        this.resizeObserver.observe(this.viewContainerEl);
    }

    /**
     * The layout the pane calls for: the desktop layout in a wide pane, on a desktop. A pane that is not shown (a tab
     * in the background) or a session in progress keeps the layout on screen, since rebuilding drops the session.
     */
    private wantsDesktopLayout(): boolean {
        if (this.viewContainerEl === null || this.settings === null) return false;
        return layoutToShow(this.desktopLayout, {
            isMobile: Platform.isMobile || EmulatedPlatform().isMobile,
            classic: this.settings.reviewLook === "classic",
            paneWidth: this.viewContainerEl.clientWidth,
            inSession: this.contentManager?.inSession ?? false,
        });
    }

    /** Rebuilds the content when the pane calls for the other layout. */
    private switchLayoutIfNeeded(): void {
        if (this.wantsDesktopLayout() !== this.desktopLayout) void this.buildContent();
    }

    /**
     * Draws the deck list and the cards, in the desktop shell or in the phone layout, whichever the pane calls for.
     * Called again when the pane changes width across the limit.
     */
    private async buildContent(): Promise<void> {
        if (
            this.viewContainerEl === null ||
            this.viewContentEl === null ||
            this.reviewQueueLoader === null ||
            this.settings === null ||
            this.plugin === null
        )
            return;
        // A resize during a rebuild is picked up when this one is done
        if (this.rebuilding) {
            this.rebuildAgain = true;
            return;
        }
        this.rebuilding = true;
        try {
            do {
                this.rebuildAgain = false;
                // Rebuilding for the other layout happens from the deck list, so it goes back to the deck list
                const rebuilding = this.contentManager !== null;
                this.desktopLayout = this.wantsDesktopLayout();
                // Closing the old content lets go of the keyboard, which the new content takes back
                const inFocus = this.plugin.uiManager?.isSRInFocus ?? false;
                this.contentManager?.close();
                this.viewContentEl.empty();
                this.viewContainerEl.toggleClass("fs-desktop-view", this.desktopLayout);
                this.viewContentEl.toggleClass("fs-desktop-root", this.desktopLayout);

                this.contentManager = new ContentManager(
                    this.app,
                    this.plugin,
                    this.reviewQueueLoader,
                    this.settings,
                    this.viewContentEl,
                    undefined,
                    this.desktopLayout,
                );
                if (this.plugin.uiManager === null) {
                    throw new Error("UI manager not initialized!!!");
                }
                this.plugin.uiManager.setContentManager(this.contentManager);
                this.plugin.uiManager.setSRViewInFocus(inFocus);
                // A switch that waited for a session to end happens once the screen is back on the deck list, after
                // the deck list has finished drawing
                this.contentManager.onDeckList = () =>
                    window.setTimeout(() => this.switchLayoutIfNeeded(), 0);

                await this.contentManager.open(rebuilding);
            } while (this.rebuildAgain && this.wantsDesktopLayout() !== this.desktopLayout);
        } finally {
            this.rebuilding = false;
        }
    }

    /**
     * Closes the SRTabView by shutting down any active deck or flashcard views.
     * Ensures that resources associated with these views are properly released.
     */

    async onClose() {
        // Resets the changes made in onOpen
        if (activeDocument.body.classList.contains("is-mobile")) {
            const mobileNavbar = activeDocument.getElementsByClassName("mobile-navbar")[0];
            if (mobileNavbar) {
                (mobileNavbar as HTMLElement).setCssProps({ position: "unset" });
            }
        }

        // Resets the changes made in onOpen
        if (
            activeDocument.body.classList.contains("is-phone") &&
            activeDocument.body.classList.contains("is-floating-nav")
        ) {
            activeDocument.body.removeClass("sr-reduced-bottom-fade-mask");
        }

        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        if (this.contentManager) this.contentManager.close();
    }

    private setSize(widthPercent: number, heightPercent: number) {
        if (!this.viewContentEl) return;
        this.viewContentEl.setCssProps({
            "--sr-view-width": widthPercent + "%",
            "--sr-view-height": heightPercent + "%",
        });
    }
}
