/**
 * Footnotes in cards (issue #21). A card is drawn from its own lines, while a footnote's definition is usually
 * somewhere else in the note, often at its end. Without the definition Obsidian draws the citation `[^1]` as a plain
 * "1" run into the text. These helpers find the definitions a card cites so they can be drawn with it.
 */

/**
 * The definitions of a note by footnote id, each as it is written in the note: `[^id]: text` and the indented lines
 * under it. Read from the note's text rather than Obsidian's metadata cache, which lags behind for a moment after a
 * review rewrites the note. Lines inside code blocks are not definitions. The first definition of an id counts.
 */
export function footnoteDefinitions(noteText: string): Map<string, string> {
    const definitions = new Map<string, string>();
    const lines = noteText.split(/\r?\n/);
    let fence: string | null = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fenceMark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
        if (fenceMark !== undefined) {
            if (fence === null) fence = fenceMark;
            else if (fenceMark.startsWith(fence)) fence = null;
            continue;
        }
        if (fence !== null) continue;
        const id = /^\[\^([^\]\s]+)\]:/.exec(line)?.[1];
        if (id === undefined) continue;
        let end = i + 1;
        while (end < lines.length && /^(?: {4}|\t)\S/.test(lines[end])) end++;
        if (!definitions.has(id)) definitions.set(id, lines.slice(i, end).join("\n"));
        i = end - 1;
    }
    return definitions;
}

/** `[^id]` that is not a definition (`[^id]:`). An inline footnote, `^[text]`, needs nothing from the note. */
const CITATION = /\[\^([^\]\s]+)\](?!:)/g;

/**
 * `markdown` with the definitions it cites and does not hold added at its end, once each in the order first cited,
 * which makes Obsidian draw the citations as footnotes and list them under the text.
 */
export function withCardFootnotes(
    markdown: string,
    definitions: ReadonlyMap<string, string>,
): string {
    const added: string[] = [];
    const seen = new Set<string>();
    for (const match of markdown.matchAll(CITATION)) {
        const id = match[1];
        const definition = definitions.get(id);
        if (definition === undefined || seen.has(id)) continue;
        seen.add(id);
        const held = new RegExp(`^\\[\\^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]:`, "m");
        if (!held.test(markdown)) added.push(definition);
    }
    return added.length === 0 ? markdown : [markdown, ...added].join("\n\n");
}
