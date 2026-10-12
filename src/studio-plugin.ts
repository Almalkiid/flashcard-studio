// The order of these stylesheets is the order of the cascade: where two rules are equally specific, the later wins.
import "src/ui/design/studio-tokens.css";
import "src/ai/generate-cards.css";
import "src/ui/obsidian-ui-components/modals/welcome-modal.css";
import "src/ui/global.css";
import "src/exam/exam.css";
import "src/settings/settings.css";
import "src/ui/obsidian-ui-components/item-views/review-tab.css";
import "src/ui/obsidian-ui-components/content-container/desktop/desktop-shell.css";
import "src/ui/obsidian-ui-components/content-container/desktop/desktop-home.css";
import "src/occlusion/occlusion.css";
import { getLanguage, Notice, Plugin } from "obsidian";

import { addAnswerCommands, removeAnswerCommands } from "src/commands/answer-commands";
import { registerStudioCommands } from "src/commands/studio-commands";
import { DataManager } from "src/data/data-hub";
import { PluginDataManager, SettingsManager } from "src/data/stored-data";
import { registerStudioIcon } from "src/icons/studio-icon";
import { setLocale, t } from "src/lang/translate";
import { setClozeMathMacro } from "src/math/cloze-macro";
import { NextNoteReviewHandler } from "src/note-review/next-note-review-handler";
import { NoteReviewQueue } from "src/note-review/note-review-queue";
import { registerOcclusion } from "src/occlusion/occlusion-processors";
import { showWelcomeOnFirstRun } from "src/onboarding/onboarding";
import { ReminderManager } from "src/scheduling/reminders";
import { reapplySettings } from "src/settings/effect-host";
import { renderReviewLog } from "src/ui/review-log-renderer";
import { UIManager } from "src/ui/studio-ui";
import { registerHoverLinkSource } from "src/utils/markdown-render";
import { TextDirection } from "src/utils/text";

/** How long the first scan of the vault may take before the person is told it is still going. */
const SLOW_SCAN_MS = 20000;

function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : "unknown error";
}

/** The part, or an error that says why it is not there yet. */
function needed<T>(part: T | null, problem: string): T {
    if (part === null) throw new Error(`Flashcard Studio: ${problem}`);
    return part;
}

/**
 * Flashcard Studio. Loading happens in two steps. `onload` registers everything Obsidian needs to know about at once
 * (commands, views, the ribbon icon, the settings tab), so these exist whatever happens next. Once the workspace is
 * ready, `scanVault` reads the notes; the plugin counts as initialized, and its commands start to work, when that is
 * done. A failure in either step is shown to the person instead of leaving a plugin that does nothing.
 */
export default class FlashcardStudioPlugin extends Plugin {
    /** True once the vault has been scanned and the plugin is ready to use. The end-to-end tests wait for it. */
    public isInitialized = false;

    private _dataManager: DataManager | null = null;
    private _uiManager: UIManager | null = null;
    private _nextNoteReviewHandler: NextNoteReviewHandler | null = null;
    private _reminderManager: ReminderManager | null = null;
    private unloaded = false;

    get dataManager(): DataManager {
        return needed(this._dataManager, "data is not loaded yet.");
    }

    get uiManager(): UIManager {
        return needed(this._uiManager, "the interface is not ready.");
    }

    get nextNoteReviewHandler(): NextNoteReviewHandler {
        return needed(this._nextNoteReviewHandler, "the note review is not ready.");
    }

    get reminderManager(): ReminderManager {
        return needed(this._reminderManager, "reminders are not ready.");
    }

    public isUiManagerLoaded = (): boolean => this._uiManager !== null;

    public isDataManagerLoaded = (): boolean => this._dataManager !== null;

    /** Whether the plugin is ready; if not, tells the person so. For commands and buttons that need the scan. */
    public ensureReady(): boolean {
        if (!this.isInitialized) new Notice(t("STUDIO_NOT_READY"));
        return this.isInitialized;
    }

    async onload(): Promise<void> {
        try {
            await this.registerEverything();
        } catch (error) {
            console.error("Flashcard Studio: could not start", error);
            new Notice(t("STUDIO_START_FAILED", { reason: reasonOf(error) }));
            return;
        }
        this.app.workspace.onLayoutReady(() => void this.scanVault());
    }

    onunload(): void {
        this.unloaded = true;
        void setClozeMathMacro(false);
        this._reminderManager?.stopReviewReminders();
        this._uiManager?.destroy();
    }

    /** Everything that does not need the vault: data, commands, views, ribbon, settings tab, note processors. */
    private async registerEverything(): Promise<void> {
        setLocale(getLanguage());
        registerStudioIcon();

        const pluginData = new PluginDataManager(this);
        await pluginData.loadData();
        const settingsManager = new SettingsManager(pluginData.pluginData.settings, (settings) =>
            pluginData.writeSettings(settings),
        );
        this._dataManager = new DataManager(this, pluginData, settingsManager);

        // Commands first: they are the way in, and they check for themselves that the plugin is ready when they run
        if (settingsManager.settings.useCustomHotkeys) this.addCustomHotkeys();
        registerStudioCommands(this);

        // The note review pane can be restored by Obsidian at any moment, so its handler exists from the start
        this._nextNoteReviewHandler = new NextNoteReviewHandler(
            this.app,
            settingsManager.settings,
            new NoteReviewQueue(),
        );
        this._uiManager = new UIManager(this, settingsManager);

        // Review log files render as a readable table instead of raw JSON lines
        this.registerMarkdownCodeBlockProcessor("srlog", (source, el) =>
            renderReviewLog(source, el),
        );
        // Image occlusion: its cards, the block in a note, and the command that adds one
        registerOcclusion(this);
        // Links in cards show a page preview on hover, as in reading view; Page preview settings can turn it off
        registerHoverLinkSource(this);
    }

    /** Reads the vault and makes the plugin ready. Runs once the workspace has been laid out. */
    private async scanVault(): Promise<void> {
        if (this._dataManager === null || this._uiManager === null) return;
        const slow = window.setTimeout(() => new Notice(t("STUDIO_SCAN_SLOW")), SLOW_SCAN_MS);
        try {
            const [data, ui] = [this.dataManager, this.uiManager];
            // Teach MathJax the \cloze macro, if clozes in LaTeX math are on
            void setClozeMathMacro(data.settingsManager.settings.latexClozes);
            data.loadData();
            await data.initVaultIndex(this.nextNoteReviewHandler.noteReviewQueue, () => {
                ui.onDataChanged();
                return Promise.resolve();
            });
            await ui.onLayoutReady();
            await data.sync();
            if (this.unloaded) return;
            this._reminderManager = new ReminderManager(this, ui, data);
            this.isInitialized = true;
            this._reminderManager.restartReviewReminders();
        } catch (error) {
            console.error("Flashcard Studio: could not read the notes", error);
            new Notice(t("STUDIO_SCAN_FAILED", { reason: reasonOf(error) }));
            return;
        } finally {
            window.clearTimeout(slow);
        }

        try {
            await showWelcomeOnFirstRun(this);
            // An exam that was started and not finished is offered for resuming, as the clock is still running
            await this.uiManager.offerExamResume();
        } catch (error) {
            console.error("Flashcard Studio: could not show the start-up dialogs", error);
        }
    }

    /**
     * Obsidian calls this when data.json was changed by a sync service or another program. The settings are read
     * again into the object everything shares, their effects are redone (scheduler, reminders, MathJax macro, parser
     * flags) and the vault is scanned again, as the cards depend on them. Before the first scan only the reading is
     * needed: the scan will use what was read.
     */
    async onExternalSettingsChange(): Promise<void> {
        if (this._dataManager === null) return;
        try {
            await this._dataManager.reloadSettings();
            if (!this.isInitialized) return;
            reapplySettings(this);
            await this._dataManager.sync();
        } catch (error) {
            console.error("Flashcard Studio: could not apply the settings changed on disk", error);
        }
    }

    public addCustomHotkeys(): void {
        addAnswerCommands(this);
    }

    public removeCustomHotkeys(): void {
        removeAnswerCommands(this);
    }

    /** The text direction Obsidian is set to, for notes that do not say. */
    public getObsidianRtlSetting(): TextDirection {
        return activeDocument.body.hasClass("mod-rtl") ? TextDirection.Rtl : TextDirection.Ltr;
    }
}
