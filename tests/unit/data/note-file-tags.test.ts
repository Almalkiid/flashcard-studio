import { CachedMetadata, MetadataCache } from "obsidian";

import { VaultTFile } from "src/data/data-structures/file/vault-note";

// Only the metadata cache matters to reading tags
class TestFile extends VaultTFile {
    constructor(cache: Partial<CachedMetadata> | null) {
        const metadataCache = { getFileCache: () => cache } as unknown as MetadataCache;
        super(undefined, metadataCache, undefined, undefined);
    }
}

function frontmatterTags(frontmatter: Record<string, unknown> | undefined): string[] {
    const cache = frontmatter === undefined ? {} : { frontmatter };
    return new TestFile(cache as Partial<CachedMetadata>)
        .getAllTagsFromText()
        .map((entry) => entry.tag);
}

describe("tags read from the frontmatter", () => {
    test("a note with frontmatter but no tags field has no tags", () => {
        expect(frontmatterTags({ title: "Audit" })).toEqual([]);
    });

    test("an empty tags field (null) gives no tags", () => {
        expect(frontmatterTags({ tags: null })).toEqual([]);
    });

    test("an empty list or empty text gives no tags", () => {
        expect(frontmatterTags({ tags: [] })).toEqual([]);
        expect(frontmatterTags({ tags: "" })).toEqual([]);
    });

    test("a list of tags gives one entry per tag, each starting with #", () => {
        expect(frontmatterTags({ tags: ["flashcards", "#audit/cia"] })).toEqual([
            "#flashcards",
            "#audit/cia",
        ]);
    });

    test("a single tag written as text gives one entry", () => {
        expect(frontmatterTags({ tags: "flashcards" })).toEqual(["#flashcards"]);
    });

    test("tags found in the frontmatter carry the pseudo position that marks them as such", () => {
        const [entry] = new TestFile({
            frontmatter: { tags: ["a"] },
        }).getAllTagsFromText();
        expect(entry.position.start).toEqual({ line: -1, col: -1, offset: -1 });
        expect(entry.position.end).toEqual({ line: -1, col: -1, offset: -1 });
    });

    test("a note without frontmatter, or without any cache, has no tags", () => {
        expect(frontmatterTags(undefined)).toEqual([]);
        expect(new TestFile(null).getAllTagsFromText()).toEqual([]);
    });

    test("tags in the text are kept next to the ones in the frontmatter", () => {
        const body = {
            position: {
                start: { line: 3, col: 0, offset: 20 },
                end: { line: 3, col: 6, offset: 26 },
            },
            tag: "#body",
        };
        const file = new TestFile({
            tags: [body],
            frontmatter: { tags: ["front"] },
        });
        expect(file.getAllTagsFromText().map((entry) => entry.tag)).toEqual(["#body", "#front"]);
    });
});
