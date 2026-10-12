import "src/ui/obsidian-ui-components/modals/review-modal.css";
import { App, debounce, Modal, Notice, Platform } from "obsidian";

import { SettingsManager } from "src/data/stored-data";
import { t } from "src/lang/translate";
import FlashcardStudioPlugin from "src/studio-plugin";
import ContentManager from "src/ui/obsidian-ui-components/content-container/review-screen";
import { ReviewQueueLoader } from "src/ui/session-queue";

/** Corners are rounded unless the modal fills its container in either direction. */
const FULL = 100;

/**
 * The review in a modal window. On a computer the window is sized from the settings and can be dragged to another size,
 * which is remembered; on a phone or tablet it fills the screen.
 */
export class StudioModalView extends Modal {
    private readonly contentManager: ContentManager;
    private resizeObserver: ResizeObserver | null = null;
    private windowSize: [number, number] = [0, 0];
    // A resize fires many callbacks; write data.json once it settles, so syncing doesn't churn on every frame
    private readonly persistSize = debounce(
        (): void => {
            void this.plugin.dataManager.savePluginData();
        },
        1000,
        true,
    );

    constructor(
        app: App,
        private readonly plugin: FlashcardStudioPlugin,
        private readonly settingsManager: SettingsManager,
        reviewQueueLoader: ReviewQueueLoader,
    ) {
        super(app);
        const settings = settingsManager.settings;
        const [height, width] = Platform.isMobile
            ? [settings.flashcardHeightPercentageMobile, settings.flashcardWidthPercentageMobile]
            : [settings.flashcardHeightPercentage, settings.flashcardWidthPercentage];
        this.modalEl.setCssProps({ height: `${height}%`, width: `${width}%` });
        // A phone or tablet keeps the corners that Obsidian gives its windows
        if (!Platform.isMobile) this.setCorners(height, width);

        this.modalEl.id = "fs-modal-view";
        this.modalEl.addClass("fs-view");
        this.contentEl.addClass("fs-modal-content");

        // Only a computer can drag the window to another size
        if (!Platform.isMobile) {
            this.windowSize = [window.innerWidth, window.innerHeight];
            this.resizeObserver = new ResizeObserver(() => this.onResize());
            this.resizeObserver.observe(this.modalEl);
        }

        this.contentManager = new ContentManager(
            app,
            plugin,
            reviewQueueLoader,
            settings,
            this.contentEl,
            () => this.close(),
        );
        plugin.uiManager.setContentManager(this.contentManager);
    }

    onOpen(): void {
        this.contentManager.open().catch((error: unknown) => {
            console.error("Flashcard Studio: the review could not be opened", error);
            new Notice(error instanceof Error ? error.message : t("CLOSE"));
        });
    }

    onClose(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.contentManager.close();
    }

    private setCorners(heightPercent: number, widthPercent: number): void {
        const rounded = heightPercent < FULL && widthPercent < FULL;
        this.modalEl.toggleClass("fs-modal-rounded", rounded);
        this.modalEl.toggleClass("fs-modal-square", !rounded);
    }

    private onResize(): void {
        const parent = this.modalEl.parentElement;
        if (parent === null || parent.offsetHeight === 0 || parent.offsetWidth === 0) return;
        const heightPercent = Math.round((this.modalEl.offsetHeight / parent.offsetHeight) * FULL);
        const widthPercent = Math.round((this.modalEl.offsetWidth / parent.offsetWidth) * FULL);
        this.setCorners(heightPercent, widthPercent);

        // The window changing size moves the percentages too, but it is not the person choosing a size
        const windowSize: [number, number] = [window.innerWidth, window.innerHeight];
        const windowResized =
            windowSize[0] !== this.windowSize[0] || windowSize[1] !== this.windowSize[1];
        this.windowSize = windowSize;
        if (windowResized) return;

        const settings = this.settingsManager.settings;
        // Opening the modal reports its size too; don't rewrite data.json when nothing changed
        if (
            settings.flashcardHeightPercentage === heightPercent &&
            settings.flashcardWidthPercentage === widthPercent
        ) {
            return;
        }
        settings.flashcardHeightPercentage = heightPercent;
        settings.flashcardWidthPercentage = widthPercent;
        this.persistSize();
    }
}
