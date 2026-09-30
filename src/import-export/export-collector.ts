import { Card } from "src/data/data-structures/card/card";
import { CardType, Question } from "src/data/data-structures/card/questions/question";
import { CardFrontBackUtil } from "src/data/data-structures/card/questions/question-type";
import { Deck } from "src/data/data-structures/deck/deck";
import { SettingsUtil, SRSettings } from "src/data/settings";
import { hasAnkiCloze } from "src/import-export/anki-cloze";
import { ANKI_DECK_SEPARATOR } from "src/import-export/anki-types";
import { BLANK_LINE_IN_CARD } from "src/import-export/card-builder";
import { convertClozesToAnki } from "src/import-export/export-cloze";
import { decodeGuid } from "src/import-export/guid-comment";
import { t } from "src/lang/helpers";
import { imagePathOf, occlusionSourceOf, parseOcclusionBlock } from "src/occlusion/occlusion-block";
import { cyrb53 } from "src/utils/strings";

export type ExportKind = "basic" | "reversed" | "cloze";

/** One flashcard note, ready to be written as an Anki note. Front and back are still Markdown. */
export interface ExportNote {
    /** Deck name with `::` between the levels. */
    deck: string;
    kind: ExportKind;
    /** The text of a cloze note for a cloze, else the front. */
    front: string;
    /** The back. For a cloze note, what Anki shows after the text on the back ("Back Extra"). */
    back: string;
    tags: string[];
    guid: string;
    /** The note the card is in, which the files it embeds are found from. */
    sourcePath: string;
}

export interface Collected {
    notes: ExportNote[];
    /** Cards Anki cannot show: a cloze whose deletions cannot be read under the current cloze patterns. */
    skipped: number;
}

const GUID_LINE = /^\s*<!--anki:(.*?)-->\s*$/;

/**
 * The Anki guid an import left after a card, so that exporting the card again updates the note in Anki instead of
 * adding a copy. The comment is on the line after the card's last line, or on its last line for a card that ends
 * before a blank line.
 */
function importedGuid(lines: string[], firstLine: number, lastLine: number): string | null {
    for (let i = firstLine; i <= lastLine + 1 && i < lines.length; i++) {
        const found = GUID_LINE.exec(lines[i]);
        if (found !== null) return decodeGuid(found[1]);
    }
    return null;
}

/**
 * An imported cloze note has its Anki "Back Extra" field after the text, in paragraphs of their own. The extra is the
 * paragraphs at the end that have no cloze deletion in them, which Anki shows on the back only.
 */
function splitClozeExtra(text: string): { text: string; extra: string } {
    const paragraphs = text.split(`\n${BLANK_LINE_IN_CARD}\n`);
    let keep = paragraphs.length;
    while (keep > 1 && !hasAnkiCloze(paragraphs[keep - 1])) keep--;
    return {
        text: paragraphs.slice(0, keep).join(`\n${BLANK_LINE_IN_CARD}\n`),
        extra: paragraphs.slice(keep).join(`\n${BLANK_LINE_IN_CARD}\n`),
    };
}

/**
 * The notes of an image occlusion block: one basic note for each mask, with the question and the picture on the front
 * and the mask's label on the back. Anki has no such card in its basic model, so the masks themselves are not drawn:
 * the picture is shown whole. This is an honest fallback, not a copy of the card.
 */
function occlusionSides(text: string): { front: string; back: string }[] {
    const source = occlusionSourceOf(text);
    const block = source === null ? null : parseOcclusionBlock(source);
    if (block === null) return [];

    const front = `${block.question || t("OCCLUSION_DEFAULT_QUESTION")}\n\n![[${imagePathOf(block.image)}]]`;
    return block.masks.map((mask, index) => ({
        front,
        back: mask.label || t("OCCLUSION_MASK_NUMBER", { n: index + 1 }),
    }));
}

/**
 * The name of a deck in Anki. The plugin's deck path starts with the flashcard tag (`flashcards/Spanish`), which
 * says nothing about the deck, so it is left out when something follows it.
 */
export function ankiDeckName(path: string[], flashcardTags: string[]): string {
    const roots = flashcardTags.map((tag) => tag.replace(/^#/, "").split("/")[0].toLowerCase());
    const levels = path.length > 1 && roots.includes(path[0].toLowerCase()) ? path.slice(1) : path;
    return levels.length === 0 ? "Default" : levels.join(ANKI_DECK_SEPARATOR);
}

/** The tags of a note file that are not what makes it flashcards or notes to review, as Anki tags. */
function ankiTagsOf(fileTags: string[], settings: SRSettings): string[] {
    const tags = fileTags
        .filter((tag) => !SettingsUtil.isTagInList(settings.flashcardTags, tag))
        .filter((tag) => !SettingsUtil.isTagInList(settings.tagsToReview, tag))
        .map((tag) => tag.replace(/^#/, "").split("/").join(ANKI_DECK_SEPARATOR));
    return Array.from(new Set(tags)).sort();
}

/**
 * Reads the flashcards of a deck tree (and its subdecks) as notes to export. A question with several cards, such
 * as a reversed card or a cloze, is one note. Notes come in the order of the deck tree, and in each deck in the order of
 * their notes and lines.
 *
 * @param root - The deck to export: the root of the tree for everything, or one deck of it.
 */
export async function collectExportNotes(root: Deck, settings: SRSettings): Promise<Collected> {
    const collected: Collected = { notes: [], skipped: 0 };
    const seenQuestions = new Set<Question>();
    const seenGuids = new Set<string>();
    const fileLines = new Map<string, string[]>();

    for (const deck of root.toDeckArray()) {
        const deckName = ankiDeckName(deck.getTopicPath().path, settings.flashcardTags);
        const questions: Question[] = [];
        for (const item of [...deck.newRepItems, ...deck.dueRepItems]) {
            if (!(item instanceof Card) || seenQuestions.has(item.question)) continue;
            seenQuestions.add(item.question);
            questions.push(item.question);
        }
        questions.sort(
            (a, b) => a.note.filePath.localeCompare(b.note.filePath) || a.lineNo - b.lineNo,
        );

        for (const question of questions) {
            const type = question.questionType;
            const text = question.questionText.actualQuestion;
            // One question is one note, except an occlusion block, which is one note for each mask
            const sides: { kind: ExportKind; front: string; back: string }[] = [];
            if (type === CardType.Cloze) {
                const converted = convertClozesToAnki(text, settings.clozePatterns);
                if (converted === null) {
                    collected.skipped++;
                    continue;
                }
                const parts = splitClozeExtra(converted.trim());
                sides.push({ kind: "cloze", front: parts.text, back: parts.extra });
            } else if (type === CardType.ImageOcclusion) {
                for (const side of occlusionSides(text)) sides.push({ kind: "basic", ...side });
            } else {
                const side = CardFrontBackUtil.expand(type, text, settings)[0];
                sides.push({
                    kind:
                        type === CardType.SingleLineReversed || type === CardType.MultiLineReversed
                            ? "reversed"
                            : "basic",
                    front: side.front.trim(),
                    back: side.back.trim(),
                });
            }

            const path = question.note.filePath;
            if (!fileLines.has(path)) {
                fileLines.set(path, (await question.note.file.cachedRead()).split("\n"));
            }
            const imported = importedGuid(
                fileLines.get(path),
                question.parsedQuestionInfo.firstLineNum,
                question.parsedQuestionInfo.lastLineNum,
            );

            for (const { kind, front, back } of sides) {
                // Cards made in Obsidian get an id from their content, so that exporting them again gives the same note
                let guid = imported ?? "cw-" + cyrb53([deckName, kind, front, back].join("\u001f"));
                // Two notes of one guid would be one note in Anki: the same card twice in a deck gets a number
                const baseGuid = guid;
                for (let repeat = 2; seenGuids.has(guid); repeat++) guid = `${baseGuid}-${repeat}`;
                seenGuids.add(guid);

                collected.notes.push({
                    deck: deckName,
                    kind,
                    front,
                    back,
                    tags: ankiTagsOf(question.note.file.getAllTagsFromCache(), settings),
                    guid,
                    sourcePath: path,
                });
            }
        }
    }
    return collected;
}
