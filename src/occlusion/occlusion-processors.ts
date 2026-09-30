import "src/occlusion/occlusion.css";
import {
    App,
    Editor,
    MarkdownFileInfo,
    MarkdownPostProcessorContext,
    MarkdownRenderChild,
    MarkdownView,
    Notice,
    setIcon,
    TFile,
} from "obsidian";

import { Question } from "src/data/data-structures/card/questions/question";
import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";
import { ImageSuggestModal, isImageFile, vaultImages } from "src/occlusion/image-suggest-modal";
import {
    OCCLUSION_LANG,
    OcclusionBlock,
    occlusionSourceOf,
    parseOcclusionBlock,
} from "src/occlusion/occlusion-block";
import { OcclusionEditorModal } from "src/occlusion/occlusion-editor-modal";
import {
    emptyScheduleSegment,
    insertOcclusionBlock,
    locateOcclusionBlock,
    replaceOcclusionBlock,
} from "src/occlusion/occlusion-rewrite";
import {
    maskStates,
    OCCLUSION_CARD_LANG,
    parseOcclusionCardSpec,
    renderOcclusion,
    resolveImagePath,
} from "src/occlusion/occlusion-view";

/**
 * Everything image occlusion adds to the plugin that needs a running Obsidian: the two Markdown code block
 * processors (the card of the study screen, and the block in a note), and the command and editor menu entry that
 * add a block to a note.
 */
export function registerOcclusion(plugin: SRPlugin): void {
    // A card in the study screen: `fs-occlusion-card`, which the card's front and back are made of
    plugin.registerMarkdownCodeBlockProcessor(OCCLUSION_CARD_LANG, (source, el, ctx) => {
        const spec = parseOcclusionCardSpec(source);
        if (spec === null) {
            el.addClass("fs-studio", "fs-occ");
            el.createDiv({ cls: "fs-occ-missing", text: t("OCCLUSION_INVALID_CARD") });
            return;
        }
        renderOcclusion(
            el,
            plugin.app,
            ctx.sourcePath,
            spec.block,
            maskStates(spec),
            ownerOf(el, ctx),
        );
    });

    // The block in a note: the picture with every label on its mask, and a pencil that opens the editor
    plugin.registerMarkdownCodeBlockProcessor(OCCLUSION_LANG, (source, el, ctx) => {
        const block = parseOcclusionBlock(source);
        if (block === null) {
            el.addClass("fs-studio", "fs-occ");
            el.createDiv({ cls: "fs-occ-missing", text: t("OCCLUSION_INVALID_BLOCK") });
            return;
        }
        const stage = renderOcclusion(
            el,
            plugin.app,
            ctx.sourcePath,
            block,
            "labels",
            ownerOf(el, ctx),
        );
        if (stage === null) return;

        const edit = stage.createEl("button", {
            cls: "fs-occ-edit",
            attr: { type: "button", "aria-label": t("OCCLUSION_EDIT") },
        });
        setIcon(edit, "pencil");
        edit.addEventListener("click", (event) => {
            event.stopPropagation();
            editBlock(plugin, block, el, ctx);
        });
    });

    plugin.addCommand({
        id: "fs-add-image-occlusion",
        name: t("OCCLUSION_ADD_COMMAND"),
        editorCallback: (editor, view) => addImageOcclusion(plugin, editor, view),
    });
    plugin.registerEvent(
        plugin.app.workspace.on("editor-menu", (menu, editor, view) => {
            // Only on an image: a menu that gains an item for everyone would change every right-click there is
            if (imageOnCursorLine(editor, plugin, view.file?.path ?? "") === null) return;
            menu.addItem((item) =>
                item
                    .setTitle(t("OCCLUSION_ADD_COMMAND"))
                    .setIcon("image-plus")
                    .onClick(() => addImageOcclusion(plugin, editor, view)),
            );
        }),
    );
}

/** The component that what a processor renders belongs to, so that it is cleaned up with the block. */
function ownerOf(el: HTMLElement, ctx: MarkdownPostProcessorContext): MarkdownRenderChild {
    const owner = new MarkdownRenderChild(el);
    ctx.addChild(owner);
    return owner;
}

/** Opens the editor on a block of a note; saving rewrites that block in the note. */
function editBlock(
    plugin: SRPlugin,
    block: OcclusionBlock,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
): void {
    const app = plugin.app;
    const section = ctx.getSectionInfo(el);
    if (section === null) {
        new Notice(t("OCCLUSION_BLOCK_NOT_FOUND"));
        return;
    }

    new OcclusionEditorModal(
        app,
        ctx.sourcePath,
        block,
        async ({ block: edited, oldIndexOfNew }) => {
            const file = app.vault.getFileByPath(ctx.sourcePath);
            if (file === null) {
                new Notice(t("OCCLUSION_BLOCK_NOT_FOUND"));
                return false;
            }
            const emptySegment = emptyScheduleSegment(plugin.dataManager.data.settings);

            const outcome: { refused: "not-found" | "ambiguous" | null } = { refused: null };
            await app.vault.process(file, (text) => {
                // The note may have changed since the block was drawn: only the block that was opened is rewritten
                const line = locateOcclusionBlock(text, section.lineStart, block);
                if (typeof line !== "number") {
                    outcome.refused = line;
                    return text;
                }
                return replaceOcclusionBlock(text, line, edited, oldIndexOfNew, emptySegment);
            });
            if (outcome.refused === null) return true;
            new Notice(
                t(
                    outcome.refused === "ambiguous"
                        ? "OCCLUSION_BLOCK_AMBIGUOUS"
                        : "OCCLUSION_BLOCK_NOT_FOUND",
                ),
            );
            return false;
        },
    ).open();
}

/**
 * The "Edit card" of the study screen, for an occlusion card: the occlusion editor on the card's block. It resolves
 * with the new text of the question, which the review sequencer writes to the note and puts on the cards. The masks
 * are locked, because the cards of the block are in the queue and their number and order cannot change during a
 * session. Rejects when the editor is closed without saving.
 */
export function editOcclusionQuestion(app: App, question: Question): Promise<string> {
    const text = question.questionText.actualQuestion;
    const source = occlusionSourceOf(text);
    const block = source === null ? null : parseOcclusionBlock(source);

    return new Promise<string>((resolve, reject) => {
        if (block === null) {
            reject(new Error("The card's block cannot be read"));
            return;
        }
        let saved: string | null = null;
        new OcclusionEditorModal(
            app,
            question.note.filePath,
            block,
            ({ block: edited, oldIndexOfNew }) => {
                // The block is the question text: no comment after it, and the masks keep their places
                saved = replaceOcclusionBlock(text, 0, edited, oldIndexOfNew, "");
            },
            {
                lockMasks: true,
                onClosed: () =>
                    saved === null ? reject(new Error(t("NO_INPUT"))) : resolve(saved),
            },
        ).open();
    });
}

/** The image the cursor's line embeds, when there is one in the vault. */
function imageOnCursorLine(editor: Editor, plugin: SRPlugin, sourcePath: string): TFile | null {
    const line = editor.getLine(editor.getCursor().line);
    const embed = /!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]+\)/.exec(line);
    if (embed === null) return null;
    const file = resolveImagePath(plugin.app, embed[0], sourcePath);
    return file !== null && isImageFile(file) ? file : null;
}

/** Puts a block into the note: over the selection, at an empty line, or on a line of its own under the cursor's. */
function insertBlock(editor: Editor, block: OcclusionBlock): void {
    const text = insertOcclusionBlock(block);
    const { line } = editor.getCursor();
    const current = editor.getLine(line);
    if (editor.somethingSelected() || current.trim().length === 0) editor.replaceSelection(text);
    else editor.replaceRange("\n\n" + text, { line, ch: current.length });
}

/** The command: choose an image (or use the one the cursor is on), draw the masks, insert the block. */
function addImageOcclusion(
    plugin: SRPlugin,
    editor: Editor,
    view: MarkdownView | MarkdownFileInfo,
): void {
    const app = plugin.app;
    const sourcePath = view.file?.path ?? "";

    const edit = (file: TFile) => {
        // The link the vault's own settings would write for the image, as a link: the block reads it either way
        const image = app.fileManager.generateMarkdownLink(file, sourcePath).replace(/^!/, "");
        new OcclusionEditorModal(
            app,
            sourcePath,
            { image, mode: "hide-all", question: "", masks: [] },
            ({ block }) => insertBlock(editor, block),
        ).open();
    };

    const embedded = imageOnCursorLine(editor, plugin, sourcePath);
    if (embedded !== null) {
        edit(embedded);
    } else if (vaultImages(app).length === 0) {
        new Notice(t("OCCLUSION_NO_IMAGES"));
    } else {
        new ImageSuggestModal(app, edit).open();
    }
}
