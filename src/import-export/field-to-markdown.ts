/**
 * Converts the HTML of an Anki field to Markdown that the flashcard parser reads as one card side.
 *
 * Obsidian's `htmlToMarkdown` does the general conversion. This module does what it cannot know about Anki around it:
 * media references, MathJax, Anki's `<div>` line structure and the blank lines that would end a card.
 */

export interface FieldConversionContext {
    /** Obsidian's `htmlToMarkdown`, injected so this module runs (and is tested) without Obsidian. */
    htmlToMarkdown: (html: string) => string;
    /**
     * The vault file name to embed for a media reference in a field (`x.png` of `<img src="x.png">`), or null when the
     * reference is not a file, such as a web address.
     */
    resolveMedia: (reference: string) => string | null;
}

const SOUND_REFERENCE = /\[sound:([^\]]+)\]/g;
const MEDIA_TAG = /<(img|audio|video)\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
const SOURCE_TAG = /<\/?source\b[^>]*>/gi;

/** Every media file a field refers to, in order: images, audio and video tags and `[sound:...]` references. */
export function findMediaReferences(html: string): string[] {
    const references: string[] = [];
    for (const match of html.matchAll(SOUND_REFERENCE)) references.push(match[1].trim());
    for (const match of html.matchAll(MEDIA_TAG)) {
        references.push(decodeEntities(match[2] ?? match[3] ?? match[4] ?? "").trim());
    }
    return references.filter((reference) => reference.length > 0);
}

/** True for web addresses and inline data, which are not files of the package. */
export function isExternalReference(reference: string): boolean {
    return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(reference) || /^data:/i.test(reference);
}

const ENTITIES: Record<string, string> = {
    "&lt;": "<",
    "&gt;": ">",
    "&amp;": "&",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
};

/** Decodes the few entities Anki writes, in one pass so that `&amp;lt;` becomes `&lt;`, not `<`. */
export function decodeEntities(text: string): string {
    return text.replace(/&(?:lt|gt|amp|quot|apos|nbsp|#39);/g, (entity) => ENTITIES[entity]);
}

function escapeHtmlText(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The inside of a MathJax expression, as one line of TeX. */
function cleanMath(html: string): string {
    return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, ""))
        .replace(/\s*\n\s*/g, " ")
        .trim();
}

/**
 * Anki writes lines as `<div>`s (or `<br>`s). Obsidian's converter would turn each `<div>` into a paragraph, so
 * lines are rewritten to `<br>` first, keeping the number of blank lines the author saw.
 */
function normaliseLines(html: string): string {
    return (
        html
            // A div holding only a <br> is an empty line, which is what the empty div stands for
            .replace(/<div\b[^>]*>\s*<br\s*\/?>\s*<\/div>/gi, "<div></div>")
            // The first div starts the text, the others start a new line
            .replace(/^\s*<div\b[^>]*>/i, "")
            // Text after a closing div starts a new line, another div's own opening already does
            .replace(/<\/div>(?!\s*(?:<\/?div\b|$))/gi, "<br>")
            .replace(/<div\b[^>]*>/gi, "<br>")
            .replace(/<\/div>/gi, "")
    );
}

/**
 * Blank lines end a card, so inside a card side they are written as a line with only `<br>`, which reads as a blank
 * line. Fenced code blocks keep their blank lines, the parser reads them as part of the code.
 */
function tidyMarkdown(markdown: string): string {
    const lines = markdown
        .replace(/\u00a0/g, " ")
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/, ""));

    const result: string[] = [];
    let inFence = false;
    let pendingBlank = false;
    for (const line of lines) {
        const isFence = /^\s*(```|~~~)/.test(line);
        if (!inFence && line === "") {
            pendingBlank = result.length > 0;
            continue;
        }
        if (pendingBlank) result.push("<br>");
        pendingBlank = false;
        // A number and a dot at the start of a line were escaped so they would not start a list, which is how the
        // author's numbered lines read best
        result.push(inFence || isFence ? line : line.replace(/^(\s*\d+)\\\./, "$1."));
        if (isFence) inFence = !inFence;
    }
    return result.join("\n");
}

/**
 * Converts one Anki field.
 *
 * @param html - The field content. HTML, unless `plainText` is set, when it is text to show as it is.
 * @returns Markdown without blank lines, or an empty string for an empty field.
 */
export function fieldToMarkdown(
    html: string,
    context: FieldConversionContext,
    plainText = false,
): string {
    let source = html.replace(/\r\n?/g, "\n");
    if (plainText) source = escapeHtmlText(source).replace(/\n/g, "<br>");

    // Whatever must reach the output exactly as written is swapped for a token the converter leaves alone
    const replacements: string[] = [];
    const token = (replacement: string): string => {
        replacements.push(replacement);
        return `ZZCW${replacements.length - 1}ZZ`;
    };

    source = source
        .replace(/\\\(([\s\S]+?)\\\)/g, (_match, tex: string) => token(`$${cleanMath(tex)}$`))
        .replace(/\\\[([\s\S]+?)\\\]/g, (_match, tex: string) => token(`$$${cleanMath(tex)}$$`))
        .replace(/\[\$\$\]([\s\S]+?)\[\/\$\$\]/g, (_match, tex: string) =>
            token(`$$${cleanMath(tex)}$$`),
        )
        .replace(/\[\$\]([\s\S]+?)\[\/\$\]/g, (_match, tex: string) =>
            token(`$${cleanMath(tex)}$`),
        );

    const embed = (reference: string): string => {
        const name = context.resolveMedia(decodeEntities(reference).trim());
        return name === null ? "" : token(`![[${name}]]`);
    };
    source = source
        .replace(SOUND_REFERENCE, (_match, reference: string) => embed(reference))
        .replace(SOURCE_TAG, "")
        .replace(
            MEDIA_TAG,
            (tag: string, _name: string, quoted?: string, singleQuoted?: string, bare?: string) => {
                const reference = decodeEntities(quoted ?? singleQuoted ?? bare ?? "").trim();
                // A web image stays an image tag, for the converter to turn into a Markdown link
                return context.resolveMedia(reference) === null ? tag : embed(reference);
            },
        );

    const markdown = context.htmlToMarkdown(normaliseLines(source));
    return tidyMarkdown(
        markdown.replace(/ZZCW(\d+)ZZ/g, (_token, index: string) => replacements[Number(index)]),
    ).trim();
}
