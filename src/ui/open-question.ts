import { App, TFile, WorkspaceLeaf } from "obsidian";

import type { Question } from "src/data/data-structures/card/question";

/**
 * Opens a question's note at the question, in a tab of its own: a tab that shows the note already is used, so repeated
 * jumps do not pile tabs up.
 *
 * @returns Whether the note was found and opened.
 */
export async function openQuestionInNote(app: App, question: Question): Promise<boolean> {
    const filePath = question.note.filePath;
    const file = app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return false;

    const workspace = app.workspace;
    const line = Math.max(0, question.lineNo);
    const blockId = question.questionText.obsidianBlockId;
    // The review is never that tab, and neither is whatever note the person happens to be in
    let leaf: WorkspaceLeaf | null = null;
    workspace.iterateAllLeaves((candidate) => {
        if (leaf === null && candidate.view.getViewType() === "markdown") {
            const shown = (candidate.view as { file?: TFile }).file;
            if (shown?.path === filePath) leaf = candidate;
        }
    });
    const target: WorkspaceLeaf = leaf ?? workspace.getLeaf("tab");
    const eState = blockId ? { subpath: `#^${blockId}` } : { line };
    await target.openFile(file, { eState });
    workspace.setActiveLeaf(target, { focus: true });
    const view = target.view as {
        editor?: {
            setCursor: (pos: { line: number; ch: number }) => void;
            scrollIntoView: (
                range: { from: { line: number; ch: number }; to: { line: number; ch: number } },
                center?: boolean,
            ) => void;
        };
    };
    if (!blockId && view.editor) {
        const position = { line, ch: 0 };
        view.editor.setCursor(position);
        view.editor.scrollIntoView({ from: position, to: position }, true);
    }
    return true;
}
