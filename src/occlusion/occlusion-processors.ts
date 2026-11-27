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

import {
    imageClozeNoteProblem,
    readImageClozeQuestion,
    resolveImageClozeContext,
} from "src/cards/image-cloze-question";
import { Question } from "src/data/data-structures/card/question";
import { StudioSettings } from "src/data/settings-model";
import { t } from "src/lang/translate";
import { createClozeNote } from "src/math/math-cloze";
import {
    formatImageClozeBlock,
    IMAGE_CLOZE_LANG,
    ImageClozeBlock,
    parseImageClozeBlock,
    scanImageClozeFences,
} from "src/occlusion/image-cloze-block";
import {
    imageClozeInsertion,
    locateImageClozeBlock,
    replaceImageClozeBlock,
} from "src/occlusion/image-cloze-edit";
import {
    IMAGE_CLOZE_CARD_LANG,
    parseImageClozeCardSpec,
    renderImageClozeCard,
    renderImageClozeNote,
} from "src/occlusion/image-cloze-view";
import {
    BlockKind,
    BlockKindSuggestModal,
    ImageSuggestModal,
    isImageFile,
    vaultImages,
} from "src/occlusion/image-suggest-modal";
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
import type FlashcardStudioPlugin from "src/studio-plugin";

/**
 * Everything image occlusion adds to the plugin that needs a running Obsidian: the two Markdown code block
 * processors (the card of the study screen, and the block in a note), and the command and editor menu entry that
 * add a block to a note.
 */
export function registerOcclusion(plugin: FlashcardStudioPlugin): void {
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

    // An image cloze card in the study screen: `fs-image-cloze-card`, which the card's front and back hold
    plugin.registerMarkdownCodeBlockProcessor(IMAGE_CLOZE_CARD_LANG, (source, el, ctx) => {
        const spec = parseImageClozeCardSpec(source);
        if (spec === null) {
            el.addClass("fs-studio", "fs-occ");
            el.createDiv({ cls: "fs-occ-missing", text: t("IMAGE_CLOZE_INVALID_CARD") });
            return;
        }
        renderImageClozeCard(el, plugin.app, ctx.sourcePath, spec, ownerOf(el, ctx));
    });

    // An image cloze block in a note: the picture with each mask's card field and hint on it
    plugin.registerMarkdownCodeBlockProcessor(IMAGE_CLOZE_LANG, (source, el, ctx) => {
        const settings = plugin.dataManager.data.settings;
        const section = ctx.getSectionInfo(el);
        const problem =
            section === null
                ? null
                : imageClozeNoteProblem(section.text, section.lineStart, settings);
        const stage = renderImageClozeNote(
            el,
            plugin.app,
            ctx.sourcePath,
            source,
            ownerOf(el, ctx),
            problem === null ? undefined : t(problem),
        );
        const read = parseImageClozeBlock(source);
        if (stage === null || read.ok === false) return;

        const edit = stage.createEl("button", {
            cls: "fs-occ-edit",
            attr: { type: "button", "aria-label": t("OCCLUSION_EDIT") },
        });
        setIcon(edit, "pencil");
        edit.addEventListener("click", (event) => {
            event.stopPropagation();
            editImageClozeBlock(plugin, read.block, el, ctx);
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
    plugin: FlashcardStudioPlugin,
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
 * Opens the editor on an image cloze block of a note; saving rewrites only that block's lines. Its schedule comment is
 * not touched: its segments carry card numbers, so they stay with their cards whatever the masks do.
 */
function editImageClozeBlock(
    plugin: FlashcardStudioPlugin,
    block: ImageClozeBlock,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
): void {
    const app = plugin.app;
    const section = ctx.getSectionInfo(el);
    if (section === null) {
        new Notice(t("OCCLUSION_BLOCK_NOT_FOUND"));
        return;
    }
    // The text clozes beside the block share its card numbers: a new mask gets one they do not use
    const context = resolveImageClozeContext(
        section.text,
        section.lineStart,
        plugin.dataManager.data.settings,
    );
    const textCards =
        context?.kind === "question" && context.read?.ok === true
            ? context.read.question.textCards
            : 0;

    OcclusionEditorModal.forCloze(
        app,
        ctx.sourcePath,
        block,
        textCards,
        async ({ block: edited }) => {
            const file = app.vault.getFileByPath(ctx.sourcePath);
            if (file === null) {
                new Notice(t("OCCLUSION_BLOCK_NOT_FOUND"));
                return false;
            }
            const outcome: { refused: "not-found" | "ambiguous" | null } = { refused: null };
            await app.vault.process(file, (text) => {
                // The note may have changed since the block was drawn: only the block that was opened is rewritten
                const line = locateImageClozeBlock(text, section.lineStart, block);
                if (typeof line !== "number") {
                    outcome.refused = line;
                    return text;
                }
                return replaceImageClozeBlock(text, line, edited);
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
 * The "Edit card" of the study screen, for an image cloze question (a block alone, or text clozes with a block): the
 * editor on the block inside the question. The text around it is kept as it is. The masks and their card fields are
 * locked: the question's cards are in the queue, and their numbers cannot change during a session. Resolves with the
 * new text of the question; rejects when the editor is closed without saving.
 */
export function editImageClozeQuestion(
    app: App,
    question: Question,
    settings: StudioSettings,
): Promise<string> {
    const text = question.questionText.actualQuestion;
    const read = readImageClozeQuestion(text, settings);
    const span = scanImageClozeFences(text.split("\n")).find((one) => one.leftEdge);

    return new Promise<string>((resolve, reject) => {
        if (read === null || read.ok === false || span === undefined) {
            reject(new Error("The card's block cannot be read"));
            return;
        }
        let saved: string | null = null;
        OcclusionEditorModal.forCloze(
            app,
            question.note.filePath,
            read.question.block,
            read.question.textCards,
            ({ block }) => {
                saved = replaceImageClozeBlock(text, span.open, block);
            },
            {
                lockMasks: true,
                onClosed: () =>
                    saved === null ? reject(new Error(t("NO_INPUT"))) : resolve(saved),
            },
        ).open();
    });
}

/**
 * The "Edit card" of the study screen, for an occlusion card: the occlusion editor on the card's block. It resolves
 * with the new text of the question, which the review session writes to the note and puts on the cards. The masks
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
function imageOnCursorLine(
    editor: Editor,
    plugin: FlashcardStudioPlugin,
    sourcePath: string,
): TFile | null {
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

/** How many cards the text clozes of the cursor's paragraph make: a new block there shares their numbers. */
function textCardsAtCursor(editor: Editor, settings: StudioSettings): number {
    const lines = editor.getValue().split("\n");
    let first = editor.getCursor().line;
    let last = first;
    const blank = (at: number) => (lines[at] ?? "").trim() === "";
    if (blank(first)) return 0;
    while (first > 0 && !blank(first - 1)) first--;
    while (last + 1 < lines.length && !blank(last + 1)) last++;
    const paragraph = lines.slice(first, last + 1).join("\n");
    const made = createClozeNote(paragraph, settings.clozePatterns, settings.latexClozes === true, {
        asking: () => "",
        showingAnswer: () => "",
        hiding: () => "",
    });
    return made.note?.numCards ?? 0;
}

/** Puts a new image cloze block into the note: under the cursor's cloze paragraph, or on lines of its own. */
function insertImageClozeBlock(
    editor: Editor,
    block: ImageClozeBlock,
    settings: StudioSettings,
): void {
    const fenced = "```" + IMAGE_CLOZE_LANG + "\n" + formatImageClozeBlock(block) + "\n```";
    if (editor.somethingSelected()) {
        editor.replaceSelection(fenced + "\n");
        return;
    }
    const lines = editor.getValue().split("\n");
    const { line, text } = imageClozeInsertion(
        lines,
        editor.getCursor().line,
        fenced,
        settings.clozePatterns,
    );
    editor.replaceRange(text, { line, ch: lines[line].length });
}

/** The command: choose an image (or use the one the cursor is on), draw the masks, insert the block. */
function addImageOcclusion(
    plugin: FlashcardStudioPlugin,
    editor: Editor,
    view: MarkdownView | MarkdownFileInfo,
): void {
    const app = plugin.app;
    const sourcePath = view.file?.path ?? "";

    const edit = (kind: BlockKind, file: TFile) => {
        // The link the vault's own settings would write for the image, as a link: the block reads it either way
        const image = app.fileManager.generateMarkdownLink(file, sourcePath).replace(/^!/, "");
        if (kind === "answers") {
            new OcclusionEditorModal(
                app,
                sourcePath,
                { image, mode: "hide-all", question: "", masks: [] },
                ({ block }) => insertBlock(editor, block),
            ).open();
            return;
        }
        const settings = plugin.dataManager.data.settings;
        OcclusionEditorModal.forCloze(
            app,
            sourcePath,
            { image, mode: "hide-all", question: "", masks: [] },
            textCardsAtCursor(editor, settings),
            ({ block }) => insertImageClozeBlock(editor, block, settings),
        ).open();
    };

    // The kind first: answers (as the command always made), or cloze cards
    new BlockKindSuggestModal(app, (kind) => {
        const embedded = imageOnCursorLine(editor, plugin, sourcePath);
        if (embedded !== null) {
            edit(kind, embedded);
        } else if (vaultImages(app).length === 0) {
            new Notice(t("OCCLUSION_NO_IMAGES"));
        } else {
            new ImageSuggestModal(app, (file) => edit(kind, file)).open();
        }
    }).open();
}
