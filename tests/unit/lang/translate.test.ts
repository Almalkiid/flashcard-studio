import en from "src/lang/en-strings";
import { currentLocale, fillParameters, pickLocale, setLocale, t } from "src/lang/translate";

describe("fillParameters", () => {
    test("fills each parameter in one pass", () => {
        expect(fillParameters("${a} and ${b}", { a: "x", b: 2 })).toBe("x and 2");
    });

    test.each(["$&", "$$", "$`", "$'", "$1"])("inserts the value %s as it is", (value) => {
        expect(fillParameters("deck ${name} ready", { name: value })).toBe(`deck ${value} ready`);
    });

    test("fills every occurrence of a name", () => {
        expect(fillParameters("${a}-${a}", { a: "x" })).toBe("x-x");
    });

    test("a value that looks like a name is not filled in again", () => {
        expect(fillParameters("${a} ${b}", { a: "${b}", b: "late" })).toBe("${b} late");
    });

    test("a name with no parameter stays as written", () => {
        expect(fillParameters("${a} ${missing}", { a: "x" })).toBe("x ${missing}");
    });

    test("a parameter that is not in the text is ignored", () => {
        expect(fillParameters("plain", { a: "x" })).toBe("plain");
    });

    test("inherited object keys are not parameters", () => {
        expect(fillParameters("${toString}", {})).toBe("${toString}");
    });
});

describe("pickLocale", () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
        warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    });
    afterEach(() => {
        warn.mockRestore();
        setLocale("en");
    });

    test("finds English by its code, its regional form and its capitals", () => {
        expect(pickLocale("en")).toBe("en");
        expect(pickLocale("en-GB")).toBe("en");
        expect(pickLocale("EN")).toBe("en");
        expect(warn).not.toHaveBeenCalled();
    });

    // The plugin failed to load when Obsidian's language had no table (e.g. Swedish)
    test("falls back to English for a language without a table, with one warning", () => {
        expect(pickLocale("sv")).toBe("en");
        expect(pickLocale("sv")).toBe("en");
        expect(warn).toHaveBeenCalledTimes(1);
    });

    test("t() reads English after switching to an unknown language", () => {
        setLocale("sv");
        expect(currentLocale()).toBe("en");
        expect(t("DECKS")).toBe(en.DECKS);
        expect(t("NEXT_REVIEW_IN", { interval: "3d" })).toBe("next in 3d");
    });
});
