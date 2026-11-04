/**
 * Removes tags from a note's frontmatter `tags` value, which may be missing, a single string ("a, b" or "a b")
 * or a list. A tag is removed when it is one of `tagsToDelete` (with or without the leading `#`) or nested under it,
 * so `flashcards/cia` goes with `#flashcards`, but a longer tag that starts the same (`flashcards-extra`) stays, as it
 * does in the body of the note.
 *
 * @returns The remaining tags, or undefined when the note had no tags.
 */
export function withoutFrontmatterTags(
    rawTags: unknown,
    tagsToDelete: string[],
): string[] | undefined {
    if (rawTags === undefined || rawTags === null) return undefined;

    let tags: string[];
    if (Array.isArray(rawTags)) {
        tags = rawTags.filter((tag): tag is string => typeof tag === "string");
    } else if (typeof rawTags === "string") {
        tags = rawTags.split(/[,\s]+/).filter((tag) => tag.length > 0);
    } else {
        return undefined;
    }
    const removed = tagsToDelete.map((tag) => tag.replace(/^#/, ""));
    return tags.filter((tag) => {
        const bare = tag.replace(/^#/, "");
        return !removed.some((name) => bare === name || bare.startsWith(`${name}/`));
    });
}
