import { pathMatchesPattern } from "src/utils/paths";

describe("pathMatchesPattern", () => {
    describe("a path that starts with the pattern", () => {
        test.each([
            ["Cooking/Pasta/a.md", "Cooking/Pasta"],
            ["Cooking/Pasta/a.md", "Cooking/Pasta/"],
            // A plain prefix, not folder aware
            ["Cooking/Pastas/a.md", "Cooking/Pasta"],
            ["a.md", "a.md"],
        ])("%s matches %s", (path, pattern) => {
            expect(pathMatchesPattern(path, pattern)).toBe(true);
        });

        test("an empty pattern is an empty prefix, so it matches every path", () => {
            expect(pathMatchesPattern("dir/a.md", "")).toBe(true);
            expect(pathMatchesPattern("", "")).toBe(true);
        });

        test("case counts", () => {
            expect(pathMatchesPattern("Dir/a.md", "dir")).toBe(false);
        });
    });

    describe("a path that matches the pattern as a glob", () => {
        test.each([
            ["Cooking/Italian/Sauces/Ragu.md", "Cooking/*/Sauces/*"],
            ["dir/a.md", "**/*.md"],
            ["dir/sub/a.md", "**/*.md"],
            ["dir/a.md", "dir/{a,b}.md"],
            ["dir/b.md", "dir/{a,b}.md"],
            ["dir/a.md", "dir/?.md"],
            ["dir/a.md", "dir/[ab].md"],
            // A leading ! negates the glob: the path matches when the rest of the pattern does not
            ["other/a.md", "!dir/**"],
        ])("%s matches %s", (path, pattern) => {
            expect(pathMatchesPattern(path, pattern)).toBe(true);
        });

        test.each([
            // No basename matching: a star does not cross a folder
            ["dir/a.md", "*.md"],
            ["dir/sub/a.md", "dir/*.md"],
            // Dot files and folders are not matched by wildcards
            [".hidden/a.md", "**/*.md"],
            ["dir/.a.md", "dir/*.md"],
            // Case sensitive
            ["Dir/a.md", "dir/**"],
            ["dir/c.md", "dir/{a,b}.md"],
            // A leading ! negates the glob: the path does not match when the rest of the pattern does
            ["dir/a.md", "!dir/**"],
            // A leading # makes the glob a comment, which matches nothing
            ["dir/a.md", "#comment"],
            ["other/a.md", "dir"],
        ])("%s does not match %s", (path, pattern) => {
            expect(pathMatchesPattern(path, pattern)).toBe(false);
        });
    });
});
