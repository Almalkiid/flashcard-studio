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

    // The bug: any tag that merely started with the same text went too, unlike the same tag in the body
    test("keeps a longer tag that only starts the same", () => {
        expect(
            withoutFrontmatterTags(["review", "reviewed", "review-later", "project"], ["#review"]),
        ).toEqual(["reviewed", "review-later", "project"]);
        expect(
            withoutFrontmatterTags(
                ["flashcards", "flashcards-archive", "flashcardsOld", "#flashcards/cia/x"],
                ["#flashcards"],
            ),
        ).toEqual(["flashcards-archive", "flashcardsOld"]);
        expect(withoutFrontmatterTags("#reviewed, review/x", ["#review"])).toEqual(["#reviewed"]);
    });

    test("handles a single string of tags", () => {
        expect(withoutFrontmatterTags("flashcards, audit", ["#flashcards"])).toEqual(["audit"]);
        expect(withoutFrontmatterTags("#review audit", ["#review"])).toEqual(["audit"]);
    });
});
