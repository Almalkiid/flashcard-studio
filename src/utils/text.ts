const LINE_BREAK = /\r\n|\r|\n/;

/** The reading direction of a note's text. */
export enum TextDirection {
    Unspecified,
    Ltr,
    Rtl,
}

/** The text with every character that means something in a regular expression escaped, to match it as written. */
export function escapeRegex(text: string): string {
    return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

/** Splits text into lines at CRLF, CR or LF; always returns at least one line. */
export function splitTextIntoLineArray(text: string): string[] {
    // Most notes have only LF endings, and splitting on a plain string is much faster than on a pattern
    return text.includes("\r") ? text.split(LINE_BREAK) : text.split("\n");
}

/** Splits a string into its leading whitespace and the rest; falsy input gives two empty strings. */
export function stringTrimStart(str: string): [string, string] {
    if (!str) return ["", ""];
    const rest = str.trimStart();
    return [str.slice(0, str.length - rest.length), rest];
}

/**
 * Splits a note into its frontmatter and a copy of the note in which each frontmatter line is blank, so the
 * body keeps its line numbers. Line endings become LF. The frontmatter is "" when the note has none.
 */
export function splitNoteIntoFrontmatterAndContent(str: string): [string, string] {
    const text = str.includes("\r") ? str.replace(/\r\n?/g, "\n") : str;
    if (!text.startsWith("---\n")) return ["", text];

    // The closing fence is the first later line that is exactly "---"
    for (let at = text.indexOf("\n---", 3); at !== -1; at = text.indexOf("\n---", at + 1)) {
        const end = at + 4;
        if (end === text.length || text[end] === "\n") {
            const frontmatter = text.slice(0, end);
            return [frontmatter, frontmatter.replace(/[^\n]/g, "") + text.slice(end)];
        }
    }
    return ["", text];
}

/** Index of the first line that equals `searchString` once the line is trimmed, or -1. */
export function findLineIndexOfSearchStringIgnoringWs(
    lines: string[],
    searchString: string,
): number {
    return lines.findIndex((line) => line.trim() === searchString);
}

/** Turns a comma separated frontmatter tag string into tags that each start with "#". */
export function parseObsidianFrontmatterTag(tagStr: string | null): string[] {
    if (tagStr === null) return [];
    return String(tagStr)
        .split(",")
        .filter((tag) => tag !== "")
        .map((tag) => (tag.startsWith("#") ? tag : "#" + tag));
}

/** Finds a block of text in a note, tolerating differences in padding and line endings. */
export class MultiLineTextFinder {
    /**
     * Replaces the first verbatim occurrence of `searchText`; failing that, the first run of lines that equal
     * the search lines when trimmed (the result then has LF endings). Null when the text is not found.
     */
    static findAndReplace(
        sourceText: string,
        searchText: string,
        replacementText: string,
    ): string | null {
        const at = sourceText.indexOf(searchText);
        if (at !== -1) {
            return (
                sourceText.slice(0, at) + replacementText + sourceText.slice(at + searchText.length)
            );
        }

        const sourceLines = splitTextIntoLineArray(sourceText);
        const searchLines = splitTextIntoLineArray(searchText);
        const index = MultiLineTextFinder.find(sourceLines, searchLines);
        if (index === null) return null;

        return sourceLines
            .slice(0, index)
            .concat(
                splitTextIntoLineArray(replacementText),
                sourceLines.slice(index + searchLines.length),
            )
            .join("\n");
    }

    /** Index of the first run of source lines that equals the search lines when trimmed, or null. */
    static find(sourceLines: string[], searchLines: string[]): number | null {
        if (searchLines.length === 0) return null;

        const wanted = searchLines.map((line) => line.trim());
        const lastStart = sourceLines.length - wanted.length;
        for (let start = 0; start <= lastStart; start++) {
            let offset = 0;
            while (
                offset < wanted.length &&
                sourceLines[start + offset].trim() === wanted[offset]
            ) {
                offset++;
            }
            if (offset === wanted.length) return start;
        }
        return null;
    }
}
