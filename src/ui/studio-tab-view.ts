import "src/ui/obsidian-ui-components/content-container/desktop/desktop-shell.css";
import "src/ui/obsidian-ui-components/content-container/desktop/desktop-home.css";
import "src/ui/obsidian-ui-components/item-views/review-tab.css";
import { ItemView, Platform, WorkspaceLeaf } from "obsidian";

import { STUDIO_TAB_VIEW } from "src/data/formats";
import { PRODUCT_NAME } from "src/data/product";
import { StudioSettings } from "src/data/settings-model";
import { EXAM_VIEW_TYPE } from "src/exam/exam-view";
import { STUDIO_ICON } from "src/icons/studio-icon";
import type FlashcardStudioPlugin from "src/studio-plugin";
import { reduceMobileChrome, restoreMobileChrome } from "src/ui/mobile-chrome";
import {
    desktopTabWanted,
    layoutToShow,
} from "src/ui/obsidian-ui-components/content-container/desktop/desktop-shell";
import ContentManager from "src/ui/obsidian-ui-components/content-container/review-screen";
import { ReviewQueueLoader } from "src/ui/session-queue";

/**
 * The Studio in a tab. It shows one study session at a time: `startSession` gives an open tab a new one, which
 * replaces the old.
 */
export class StudioTabView extends ItemView {
    navigation = false;

    private readonly shellEl: HTMLElement;
    private contentManager: ContentManager | null = null;
    private resizeObserver: ResizeObserver | null = null;
    // Whether the content on screen is drawn with the desktop shell, so a resize only rebuilds it when that changes
    private desktopLayout = false;
    // Builds run one after another: a resize or a new session during a build waits for it
    private building: Promise<void> = Promise.resolve();
    private setUp = false;

    constructor(
        leaf: WorkspaceLeaf,
        private readonly plugin: FlashcardStudioPlugin,
        private loader: ReviewQueueLoader | null,
    ) {
        super(leaf);
        const isMobile = Platform.isMobile;
        // The desktop tab takes the whole pane: it was asked for by its own setting, not by the sizes of the window
        const fullPane = desktopTabWanted(this.settings, isMobile);
        const percents = (desktop: number, mobile: number): number =>
            fullPane ? 100 : isMobile ? mobile : desktop;
        const width = percents(
            this.settings.flashcardWidthPercentage,
            this.settings.flashcardWidthPercentageMobile,
        );
        const height = percents(
            this.settings.flashcardHeightPercentage,
            this.settings.flashcardHeightPercentageMobile,
        );

        this.contentEl.addClasses(["fs-tab-view", "fs-view"]);
        this.shellEl = this.contentEl.createDiv("fs-tab-view-content");
        this.shellEl.setCssProps({
            "--fs-view-width": width + "%",
            "--fs-view-height": height + "%",
        });
        this.shellEl.toggleClass("fs-center-view", width < 100 || height < 100);
    }

    private get settings(): StudioSettings {
        return this.plugin.dataManager.settingsManager.settings;
    }

    public getViewType(): string {
        return STUDIO_TAB_VIEW;
    }

    public getIcon(): string {
        return STUDIO_ICON;
    }

    public getDisplayText(): string {
        return PRODUCT_NAME;
    }

    protected async onOpen(): Promise<void> {
        // A tab that Obsidian restored has no session to show
        if (this.loader === null) return;
        await this.startSession(this.loader);
    }

    /** Shows `loader`'s session in this tab, in place of whatever it shows now. */
    public async startSession(loader: ReviewQueueLoader): Promise<void> {
        this.loader = loader;
        this.setUpOnce();
        await this.build(false);
    }

    protected onClose(): Promise<void> {
        // An exam tab needs the same room at the bottom, so it keeps what this tab changed
        if (this.app.workspace.getLeavesOfType(EXAM_VIEW_TYPE).length === 0) restoreMobileChrome();
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        const manager = this.contentManager;
        this.contentManager = null;
        if (manager !== null) {
            manager.close();
            this.plugin.uiManager.forgetContentManager(manager);
        }
        return Promise.resolve();
    }

    /** What happens once, when the tab first gets a session: the phone chrome and the layout watcher. */
    private setUpOnce(): void {
        if (this.setUp) return;
        this.setUp = true;
        reduceMobileChrome();
        // The desktop layout needs a wide pane: a narrow split, or a window made narrower, gets the phone layout
        this.resizeObserver = new ResizeObserver(() => this.switchLayoutIfNeeded());
        this.resizeObserver.observe(this.contentEl);
    }

    /**
     * The layout the pane calls for: the desktop layout in a wide pane, on a desktop. A pane that is not shown (a
     * tab in the background) or a session in progress keeps the layout on screen, since rebuilding drops the session.
     */
    private wantsDesktopLayout(): boolean {
        return layoutToShow(this.desktopLayout, {
            isMobile: Platform.isMobile,
            desktopLayout: this.settings.desktopLayout,
            classic: this.settings.reviewLook === "classic",
            paneWidth: this.contentEl.clientWidth,
            inSession: this.contentManager?.inSession ?? false,
        });
    }

    private switchLayoutIfNeeded(): void {
        if (this.wantsDesktopLayout() !== this.desktopLayout) void this.build(true);
    }

    /**
     * @param stayOnDeckList - Rebuilding for another layout happens from the deck list, so it goes back there instead
     * of into the cards of a lone deck.
     */
    private build(stayOnDeckList: boolean): Promise<void> {
        this.building = this.building
            .then(() => this.buildNow(stayOnDeckList))
            .catch((error: unknown) => {
                console.error("Flashcard Studio: could not build the Studio tab", error);
            });
        return this.building;
    }

    private async buildNow(stayOnDeckList: boolean): Promise<void> {
        if (this.loader === null) return;
        // A resize that queued this build may have been answered by an earlier one
        if (stayOnDeckList && this.wantsDesktopLayout() === this.desktopLayout) return;

        this.desktopLayout = this.wantsDesktopLayout();
        // Closing the old content lets go of the keyboard, which the new content takes back
        const inFocus = this.app.workspace.getActiveViewOfType(StudioTabView) === this;
        const previous = this.contentManager;
        previous?.close();
        this.shellEl.empty();
        this.contentEl.toggleClass("fs-desktop-view", this.desktopLayout);
        this.shellEl.toggleClass("fs-desktop-root", this.desktopLayout);

        const manager = new ContentManager(
            this.app,
            this.plugin,
            this.loader,
            this.settings,
            this.shellEl,
            undefined,
            this.desktopLayout,
        );
        this.contentManager = manager;
        const ui = this.plugin.uiManager;
        ui.setContentManager(manager);
        ui.setStudioViewInFocus(inFocus);
        // A switch that waited for a session to end happens once the screen is back on the deck list, after the deck
        // list has finished drawing
        manager.onDeckList = () => window.setTimeout(() => this.switchLayoutIfNeeded(), 0);
        await manager.open(stayOnDeckList);
    }
}
