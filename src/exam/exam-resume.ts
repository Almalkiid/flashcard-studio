import "src/exam/exam.css";
import { Modal, setIcon } from "obsidian";

import { ExamStart } from "src/exam/exam";
import { trapTab } from "src/exam/exam-dom";
import { draftStatus, ExamDraft, startFromDraft } from "src/exam/exam-draft";
import { discardExamDraft } from "src/exam/exam-draft-store";
import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";
import { formatDuration } from "src/ui/statistics-view/format";

/** A second press within this time confirms a discard; after it, the button goes back to Discard. */
const CONFIRM_MS = 4000;

/** Where an exam was left, as one line: the question, and the time left (or that it ran out). */
function detailText(draft: ExamDraft): string {
    const status = draftStatus(draft, Date.now());
    let left: string;
    if (status.timeUp) left = t("EXAM_TIME_RAN_OUT");
    else if (status.leftMs === null) left = t("EXAM_NO_LIMIT");
    else left = t("EXAM_LEFT", { time: formatDuration(status.leftMs) });
    return t("EXAM_RESUME_DETAIL", { current: status.position, total: status.total, left });
}

/**
 * The unfinished exams, each with a button to take it up again and one to throw it away. Discarding takes two presses,
 * since an exam can be hours of work. `onChange` is called after one is discarded, with what is left.
 */
export function renderDraftRows(
    parent: HTMLElement,
    plugin: SRPlugin,
    drafts: ExamDraft[],
    onResume: (start: ExamStart) => void,
    onChange: (left: ExamDraft[]) => void,
): void {
    const list = parent.createDiv({ cls: "fs-exam-drafts" });
    for (const draft of drafts) {
        const row = list.createDiv({ cls: "fs-exam-draft" });
        setIcon(row.createDiv({ cls: "fs-exam-draft-icon" }), "history");
        const text = row.createDiv({ cls: "fs-exam-draft-text" });
        text.createDiv({ cls: "fs-exam-draft-title", text: draft.setup.title });
        text.createDiv({ cls: "fs-exam-draft-detail", text: detailText(draft) });

        const buttons = row.createDiv({ cls: "fs-exam-draft-buttons" });
        const timeUp = draftStatus(draft, Date.now()).timeUp;
        buttons
            .createEl("button", {
                cls: "fs-primary-button fs-exam-draft-resume",
                text: timeUp ? t("EXAM_SEE_RESULTS") : t("EXAM_RESUME_BUTTON"),
                attr: { type: "button" },
            })
            .addEventListener("click", () => onResume(startFromDraft(draft)));

        const discard = buttons.createEl("button", {
            cls: "fs-exam-ghost fs-exam-draft-discard",
            text: t("EXAM_DISCARD"),
            attr: { type: "button" },
        });
        let armed: number | null = null;
        discard.addEventListener("click", () => {
            if (armed === null) {
                discard.setText(t("EXAM_DISCARD_CONFIRM"));
                discard.addClass("is-armed");
                armed = window.setTimeout(() => {
                    armed = null;
                    discard.setText(t("EXAM_DISCARD"));
                    discard.removeClass("is-armed");
                }, CONFIRM_MS);
                return;
            }
            window.clearTimeout(armed);
            discardExamDraft(plugin, draft.id);
            onChange(drafts.filter((other) => other.id !== draft.id));
        });
    }
}

/**
 * Offered when Obsidian starts with an exam that was not finished: take it up again, discard it, or decide later. A
 * timed exam has been running all the while, as a real one would, and one that ran out is submitted as it was left.
 */
export class ExamResumeModal extends Modal {
    private readonly plugin: SRPlugin;
    private drafts: ExamDraft[];
    private readonly onResume: (start: ExamStart) => void;

    constructor(plugin: SRPlugin, drafts: ExamDraft[], onResume: (start: ExamStart) => void) {
        super(plugin.app);
        this.plugin = plugin;
        this.drafts = drafts;
        this.onResume = onResume;
        this.modalEl.addClass("fs-exam-modal", "fs-exam-resume-modal", "fs-studio");
        this.contentEl.addClass("fs-exam-setup");
        this.setTitle(t("EXAM_RESUME_TITLE"));
        trapTab(this.modalEl);
    }

    onOpen(): void {
        this.render();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        if (this.drafts.length === 0) {
            this.close();
            return;
        }
        contentEl.createDiv({ cls: "fs-exam-resume-intro", text: t("EXAM_RESUME_INTRO") });
        renderDraftRows(
            contentEl,
            this.plugin,
            this.drafts,
            (start) => {
                this.close();
                this.onResume(start);
            },
            (left) => {
                this.drafts = left;
                this.render();
            },
        );
        const actions = contentEl.createDiv({ cls: "fs-exam-actions is-setup" });
        actions
            .createEl("button", {
                cls: "fs-exam-ghost",
                text: t("EXAM_LATER"),
                attr: { type: "button" },
            })
            .addEventListener("click", () => this.close());
    }
}
