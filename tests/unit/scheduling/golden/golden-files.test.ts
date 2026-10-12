import { GoldenName, loadGolden } from "./load-golden";

const NAMES: GoldenName[] = [
    "comments",
    "display",
    "frontmatter",
    "fsrs",
    "histogram",
    "review-session",
    "sm2-grid",
];

describe("golden files", () => {
    test.each(NAMES)("%s loads with its metadata and known-bug list", (name) => {
        const golden = loadGolden<{ meta: unknown; knownBugs: unknown[] }>(name);
        expect(golden.meta).toBeDefined();
        expect(Array.isArray(golden.knownBugs)).toBe(true);
    });
});
