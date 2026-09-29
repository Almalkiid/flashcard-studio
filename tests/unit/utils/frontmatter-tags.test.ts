import { withoutFrontmatterTags } from "src/utils/frontmatter-tags";

describe("withoutFrontmatterTags", () => {
    test("a note without tags stays without tags instead of throwing", () => {
        expect(withoutFrontmatterTags(undefined, ["#flashcards"])).toBeUndefined();
        expect(withoutFrontmatterTags(null, ["#flashcards"])).toBeUndefined();
    });

    test("removes matching tags and nested tags from a list", () => {
        expect(
            withoutFrontmatterTags(["flashcards", "flashcards/cia", "audit"], ["#flashcards"]),
        ).toEqual(["audit"]);
    });

    test("handles a single string of tags", () => {
        expect(withoutFrontmatterTags("flashcards, audit", ["#flashcards"])).toEqual(["audit"]);
        expect(withoutFrontmatterTags("#review audit", ["#review"])).toEqual(["audit"]);
    });
});
