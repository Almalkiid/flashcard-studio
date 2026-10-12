/**
 * A small, deterministic Markdown to HTML converter for the text of flashcards, which is what Anki fields hold. It
 * covers what cards use: bold, italic, strikethrough, highlight, inline code and code blocks, lists, headings,
 * quotes, links, images and other embedded files, line breaks, and LaTeX. Anything else is written as text.
 */

export interface HtmlContext {
    /**
     * Called for each file embedded with `![[file]]` or `![](file)`. Returns the name the file has in Anki, or null
     * when it cannot be used, which leaves the embed as text.
     */
    embed(target: string): string | null;
}

const IMAGE_EXTENSIONS = new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "svg",
    "webp",
    "bmp",
    "avif",
    "ico",
]);
const SOUND_EXTENSIONS = new Set([
    "mp3",
    "wav",
    "ogg",
    "m4a",
    "flac",
    "aac",
    "3gp",
    "opus",
    "mp4",
    "webm",
    "mov",
    "ogv",
    "mkv",
]);

export function fileExtension(name: string): string {
    const dot = name.lastIndexOf(".");
    return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** True for the files a card can show or play. */
export function isMediaFile(name: string): boolean {
    const extension = fileExtension(name);
    return IMAGE_EXTENSIONS.has(extension) || SOUND_EXTENSIONS.has(extension);
}

export function escapeHtmlText(text: string): string {
    // An `&` that starts a character reference is left, so `&#58;` and `&amp;` are not escaped a second time
    return text
        .replace(/&(?!#?\w+;)/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

const escapeAttribute = (text: string): string => escapeHtmlText(text).replace(/"/g, "&quot;");

/** Tags written in a card that Anki shows as they are. */
const PASSTHROUGH_TAG =
    /<\/?(?:br|b|i|u|em|strong|s|del|sub|sup|mark|span|font|code|pre|div|p|ul|ol|li|table|thead|tbody|tr|td|th|a|img|hr|blockquote|h[1-6])\b[^<>]*>/gi;

const MARK_START = "";
const MARK_END = "";

function inlineToHtml(text: string, context: HtmlContext): string {
    const kept: string[] = [];
    const keep = (html: string): string => {
        kept.push(html);
        return `${MARK_START}${kept.length - 1}${MARK_END}`;
    };

    let result = text
        // Code, whose content is not Markdown
        .replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_match, _ticks, code: string) =>
            keep(`<code>${escapeHtmlText(code.trim())}</code>`),
        )
        // Math: `$$...$$` and `$...$` (which must not start or end at a space or be followed by a digit, like Obsidian)
        .replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex: string) =>
            keep(`\\[${escapeHtmlText(tex.trim())}\\]`),
        )
        .replace(/\$(?=\S)([^$\n]*?\S)\$(?!\d)/g, (_match, tex: string) =>
            keep(`\\(${escapeHtmlText(tex)}\\)`),
        )
        // A backslash escape is the character itself, and must not take part in emphasis
        .replace(/\\([\\`*_{}[\]()#+\-.!|~=>$])/g, (_match, char: string) =>
            keep(escapeHtmlText(char)),
        );

    const embedded = (target: string, alt: string): string => {
        const name = context.embed(target);
        if (name === null) return keep(escapeHtmlText(alt));
        return keep(
            isImage(name)
                ? `<img src="${escapeAttribute(name)}">`
                : `[sound:${name.replace(/\]/g, "")}]`,
        );
    };
    const isImage = (name: string): boolean => IMAGE_EXTENSIONS.has(fileExtension(name));

    result = result
        .replace(/!\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/g, (match, target: string) => {
            const file = target.split("#")[0].trim();
            // An embedded note is not something Anki can show: its name stands for it
            return isMediaFile(file) ? embedded(file, match) : keep(escapeHtmlText(file));
        })
        .replace(
            /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
            (match, alt: string, target: string) => {
                if (/^(?:https?:)?\/\//i.test(target) || /^data:/i.test(target)) {
                    return keep(
                        `<img src="${escapeAttribute(target)}" alt="${escapeAttribute(alt)}">`,
                    );
                }
                let path = target;
                try {
                    path = decodeURIComponent(target);
                } catch {
                    // Not an encoding: the path as written
                }
                return isMediaFile(path) ? embedded(path, match) : keep(escapeHtmlText(alt));
            },
        )
        // Links: a link out stays a link, a link to a note is its text
        .replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) =>
            keep(escapeHtmlText(alias ?? target.split(/[#^]/)[0])),
        )
        .replace(
            /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
            (_match, label: string, target: string) =>
                /^(?:https?:|mailto:)/i.test(target)
                    ? keep(`<a href="${escapeAttribute(target)}">${escapeHtmlText(label)}</a>`)
                    : keep(escapeHtmlText(label)),
        )
        .replace(PASSTHROUGH_TAG, (tag) => keep(tag));

    result = escapeHtmlText(result)
        .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, "<b><i>$1</i></b>")
        .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<b>$1</b>")
        .replace(/__(?=\S)([\s\S]*?\S)__/g, "<b>$1</b>")
        .replace(/\*(?=\S)([^*\n]*?\S)\*/g, "<i>$1</i>")
        .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?=[^\w]|$)/g, "$1<i>$2</i>")
        .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<s>$1</s>")
        .replace(/==(?=\S)([\s\S]*?\S)==/g, "<mark>$1</mark>");

    const restore = new RegExp(`${MARK_START}(\\d+)${MARK_END}`, "g");
    return result.replace(restore, (_match, index: string) => kept[Number(index)]);
}

interface ListItem {
    indent: number;
    ordered: boolean;
    text: string;
}

const LIST_LINE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function listToHtml(items: ListItem[], context: HtmlContext): string {
    let html = "";
    const open: { indent: number; ordered: boolean }[] = [];
    const closeTo = (indent: number): void => {
        while (open.length > 0 && open[open.length - 1].indent > indent) {
            const list = open.pop();
            html += `</li></${list.ordered ? "ol" : "ul"}>`;
        }
    };

    for (const item of items) {
        closeTo(item.indent);
        const top = open[open.length - 1];
        if (top !== undefined && top.indent === item.indent && top.ordered === item.ordered) {
            html += "</li>";
        } else if (top !== undefined && top.indent === item.indent) {
            // Another kind of list at the same level: it replaces the list before it
            html += `</li></${top.ordered ? "ol" : "ul"}>`;
            open.pop();
        }
        if (open.length === 0 || open[open.length - 1].indent !== item.indent) {
            html += item.ordered ? "<ol>" : "<ul>";
            open.push({ indent: item.indent, ordered: item.ordered });
        }
        html += `<li>${inlineToHtml(item.text, context)}`;
    }
    closeTo(-1);
    return html;
}

/** A callout's first line (`[!tip] Title`) becomes a bold title, the rest is a quote. */
function calloutTitle(line: string): string {
    const callout = /^\[!([\w-]+)\][+-]?\s*(.*)$/.exec(line);
    if (callout === null) return line;
    const title = callout[2].trim() || callout[1];
    return `**${title}**`;
}

/** Converts the Markdown of a card, or of one side of it, to HTML. */
export function markdownToHtml(markdown: string, context: HtmlContext): string {
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    const blocks: string[] = [];
    let paragraph: string[] = [];
    // A blank line between two paragraphs is a blank line in the result
    let afterBlankLine = false;
    let previousWasParagraph = false;

    const endParagraph = (): void => {
        if (paragraph.length === 0) return;
        if (afterBlankLine && previousWasParagraph) blocks.push("<br><br>");
        blocks.push(paragraph.map((line) => inlineToHtml(line, context)).join("<br>"));
        paragraph = [];
        afterBlankLine = false;
        previousWasParagraph = true;
    };
    const pushBlock = (html: string): void => {
        blocks.push(html);
        afterBlankLine = false;
        previousWasParagraph = false;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fence = /^\s*(```|~~~)/.exec(line);

        if (fence !== null) {
            endParagraph();
            const code: string[] = [];
            i++;
            while (i < lines.length && !lines[i].trimStart().startsWith(fence[1]))
                code.push(lines[i++]);
            pushBlock(`<pre><code>${escapeHtmlText(code.join("\n"))}</code></pre>`);
        } else if (/^\s*#{1,6}\s+\S/.test(line)) {
            endParagraph();
            const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line);
            pushBlock(
                `<h${heading[1].length}>${inlineToHtml(heading[2], context)}</h${heading[1].length}>`,
            );
        } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
            endParagraph();
            pushBlock("<hr>");
        } else if (LIST_LINE.test(line)) {
            endParagraph();
            const items: ListItem[] = [];
            for (; i < lines.length && LIST_LINE.test(lines[i]); i++) {
                const item = LIST_LINE.exec(lines[i]);
                items.push({
                    indent: item[1].replace(/\t/g, "    ").length,
                    ordered: /^\d/.test(item[2]),
                    text: item[3],
                });
            }
            i--;
            pushBlock(listToHtml(items, context));
        } else if (/^\s*>/.test(line)) {
            endParagraph();
            const quote: string[] = [];
            for (; i < lines.length && /^\s*>/.test(lines[i]); i++) {
                quote.push(lines[i].replace(/^\s*>\s?/, ""));
            }
            i--;
            quote[0] = calloutTitle(quote[0]);
            pushBlock(`<blockquote>${markdownToHtml(quote.join("\n"), context)}</blockquote>`);
        } else if (line.trim() === "") {
            endParagraph();
            afterBlankLine = true;
        } else {
            // A line with only <br> is the plugin's blank line inside a card: an empty line here, so that joining
            // the lines with <br> leaves one blank line
            paragraph.push(line.trim().toLowerCase() === "<br>" ? "" : line);
        }
    }
    endParagraph();
    return blocks.join("");
}
