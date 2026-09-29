/**
 * Removes tags from a note's frontmatter `tags` value, which may be missing, a single string ("a, b" or "a b")
 * or a list. A tag is removed when it starts with one of `tagsToDelete` (with or without the leading `#`), so
 * nested tags like `flashcards/cia` go with `#flashcards`.
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
    const prefixes = tagsToDelete.map((tag) => tag.replace(/^#/, ""));
    return tags.filter(
        (tag) => !prefixes.some((prefix) => tag.replace(/^#/, "").startsWith(prefix)),
    );
}
