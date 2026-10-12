import { cyrb53 } from "src/utils/hash";

// cyrb53 output is persisted (textHash in the buried-cards list, card ids written into notes and Anki
// exports), so these vectors must never change.
describe("cyrb53", () => {
    test.each([
        ["", 0, "bdcb81aee8d83"],
        ["a", 0, "1c2ba782c97901"],
        ["hello", 0, "106f3a63cd7226"],
        ["hello", 1, "1897bfcd0b3443"],
        ["hello", 2, "b4f13a1bb1a72"],
        ["hello", 123, "6677dacb8051"],
        ["", 987, "aba1aab9aab71"],
        ["!@#$%^&*()", 0, "d86f2f9eb5a3a"],
        ["!@#$%^&*()", 555, "1484280e499f6c"],
    ])("hashes %j with seed %d to %s", (text, seed, expected) => {
        expect(cyrb53(text, seed)).toBe(expected);
    });

    test("the seed defaults to 0", () => {
        expect(cyrb53("hello")).toBe(cyrb53("hello", 0));
    });

    test("accented, Arabic and emoji text hash by UTF-16 code unit", () => {
        expect(cyrb53("héllo")).toBe("1d9387e2618c5c");
        expect(cyrb53("مرحبا")).toBe("11e73796674125");
        expect(cyrb53("😀")).toBe("10ca036ef9b4ae");
    });

    test("a lone surrogate is hashed as itself", () => {
        expect(cyrb53("\ud83d")).toBe("19505fd8ab22d6");
    });

    test("a long input hashes the same way", () => {
        expect(cyrb53("x".repeat(1000))).toBe("1a7942aee5273b");
    });

    test("the result is lowercase hexadecimal without zero padding", () => {
        expect(cyrb53("hello", 2)).toMatch(/^[0-9a-f]+$/);
        expect(cyrb53("hello", 2)).toHaveLength(13);
        expect(cyrb53("a")).toHaveLength(14);
    });

    test("a missing string throws", () => {
        expect(() => cyrb53(undefined as unknown as string)).toThrow(TypeError);
    });
});
