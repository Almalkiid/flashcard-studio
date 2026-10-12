/**
 * A stand-in for Obsidian's `htmlToMarkdown`, which needs the app. It handles the tags the tests use and behaves like
 * the real one where it matters to the code under test: `<br>` is a line break, `<p>` is a paragraph with blank lines
 * around it, and a number and a dot at the start of a line are escaped so they do not start a list.
 *
 * The real converter is exercised by the end-to-end tests.
 */
export function simpleHtmlToMarkdown(html: string): string {
    const text = html
        .replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, "**$2**")
        .replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, "*$2*")
        .replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/?p>/gi, "\n\n")
        .replace(/<li>([\s\S]*?)<\/li>/gi, "- $1\n")
        .replace(/<\/?ul>/gi, "\n")
        .replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, "![]($1)")
        .replace(/<(?!\/?u>)[^>]+>/gi, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, "\u00a0")
        .replace(/&amp;/g, "&");
    return text
        .split("\n")
        .map((line) => line.replace(/^(\d+)\./, "$1\\."))
        .join("\n")
        .trim();
}
