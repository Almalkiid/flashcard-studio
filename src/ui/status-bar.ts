import "src/ui/status-bar.css";
import { Platform, request, setIcon, setTooltip } from "obsidian";

import { LATEST_RELEASE_API_URL } from "src/data/product";
import { STUDIO_ICON } from "src/icons/studio-icon";
import { IBaseLocale } from "src/lang/en-strings";
import { t } from "src/lang/translate";
import { FlashcardReviewMode } from "src/scheduling/review/review-mode";
import type FlashcardStudioPlugin from "src/studio-plugin";
import {
    isNewerVersion,
    StatusBarInput,
    StatusItemKind,
    statusItemStates,
} from "src/ui/status-bar-model";

const DAY_MS = 24 * 60 * 60 * 1000;

interface ItemSpec {
    icon: string;
    tooltip: keyof IBaseLocale;
    onClick?: () => void;
}

/**
 * The plugin's status bar items: cards due, notes due, and a hint that a newer release exists. Obsidian has no status
 * bar on a phone, so there the items are never made.
 */
export class StatusBar {
    private readonly items = new Map<StatusItemKind, { el: HTMLElement; text: HTMLElement }>();
    private updateAvailable = false;
    private lastUpdateCheck = 0;
    private lastInput: Omit<StatusBarInput, "updateAvailable"> | null = null;

    constructor(private readonly plugin: FlashcardStudioPlugin) {
        if (Platform.isMobile) return;
        const specs: Record<StatusItemKind, ItemSpec> = {
            cards: {
                icon: STUDIO_ICON,
                tooltip: "OPEN_DECK_FOR_REVIEW",
                onClick: () =>
                    void this.plugin.uiManager.openDeckContainer(FlashcardReviewMode.Review),
            },
            notes: {
                icon: "lucide-file-clock",
                tooltip: "OPEN_NOTE_FOR_REVIEW",
                onClick: () => void this.openNextNote(),
            },
            update: { icon: "lucide-circle-arrow-up", tooltip: "UPDATE_AVAILABLE" },
        };
        for (const [kind, spec] of Object.entries(specs) as [StatusItemKind, ItemSpec][]) {
            const el = plugin.addStatusBarItem();
            el.addClasses(["fs-status-item", "fs-is-hidden"]);
            setIcon(el.createSpan({ cls: "fs-status-icon" }), spec.icon);
            const text = el.createSpan();
            setTooltip(el, t(spec.tooltip));
            if (spec.onClick !== undefined) {
                el.addClass("mod-clickable");
                el.addEventListener("click", spec.onClick);
            }
            this.items.set(kind, { el, text });
        }
    }

    /** Shows the items for `input`, and, when the update hint is on, looks for a newer release at most once a day. */
    public render(input: Omit<StatusBarInput, "updateAvailable">): void {
        this.lastInput = input;
        const states = statusItemStates({ ...input, updateAvailable: this.updateAvailable });
        for (const [kind, item] of this.items) {
            item.text.setText(states[kind].text);
            item.el.toggleClass("fs-is-hidden", !states[kind].visible);
        }
        if (input.show && input.showUpdate) this.checkForUpdate();
    }

    private async openNextNote(): Promise<void> {
        const data = this.plugin.dataManager;
        if (data.syncLock) return;
        await data.sync();
        await this.plugin.nextNoteReviewHandler.reviewNextNoteModal();
    }

    /** Fire and forget: nothing waits for the network, and any failure counts as "no update". */
    private checkForUpdate(): void {
        const now = Date.now();
        if (now - this.lastUpdateCheck < DAY_MS) return;
        this.lastUpdateCheck = now;
        void request({ url: LATEST_RELEASE_API_URL })
            .then((body) => {
                const tag = (JSON.parse(body) as { tag_name?: string }).tag_name;
                this.updateAvailable =
                    tag !== undefined && isNewerVersion(tag, this.plugin.manifest.version);
                if (this.lastInput !== null) this.render(this.lastInput);
            })
            .catch((error: unknown) => {
                console.warn("Flashcard Studio: could not check for a newer release", error);
            });
    }
}
