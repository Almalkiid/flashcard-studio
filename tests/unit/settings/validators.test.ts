import {
    clozePatternError,
    decimalRangeError,
    isNegatedFolderPattern,
    listEntryError,
    nonEmptyError,
    normalizeEasyDays,
    normalizeStartOfDay,
    normalizeVaultFolder,
    parseTagList,
    RETENTION_MAX_PERCENT,
    RETENTION_MIN_PERCENT,
    separatorError,
    skippedFolderError,
    startOfDayError,
    stepsError,
    tagListError,
    urlError,
    weightsError,
    wholeNumberError,
} from "src/settings/validators";

describe("wholeNumberError", () => {
    test("accepts whole numbers in range, edges included", () => {
        expect(wholeNumberError(0, 0, 9999)).toBeUndefined();
        expect(wholeNumberError(9999, 0, 9999)).toBeUndefined();
    });
    test("rejects fractions, NaN and out-of-range values", () => {
        expect(wholeNumberError(2.5, 0, 10)).toBe("Use a whole number.");
        expect(wholeNumberError(Number.NaN, 0, 10)).toBe("Use a whole number.");
        expect(wholeNumberError(-1, 0, 10)).toBe("Use a number from 0 to 10.");
        expect(wholeNumberError(11, 0, 10)).toBe("Use a number from 0 to 10.");
    });
});

describe("decimalRangeError", () => {
    test("retention range, in percent", () => {
        expect(decimalRangeError(90, 70, 99)).toBeUndefined();
        expect(decimalRangeError(90.5, 70, 99)).toBeUndefined();
        expect(decimalRangeError(70, 70, 99)).toBeUndefined();
        expect(decimalRangeError(99, 70, 99)).toBeUndefined();
        expect(decimalRangeError(50, 70, 99)).toBe("Use a value from 70 to 99.");
        expect(decimalRangeError(69.9, 70, 99)).toBe("Use a value from 70 to 99.");
        expect(decimalRangeError(99.1, 70, 99)).toBe("Use a value from 70 to 99.");
        expect(decimalRangeError(100, 70, 99)).toBe("Use a value from 70 to 99.");
        expect(decimalRangeError(Number.NaN, 70, 99)).toBe("Use a value from 70 to 99.");
        expect(decimalRangeError(Infinity, 70, 99)).toBe("Use a value from 70 to 99.");
    });
    test("the retention range is 70 to 99 percent", () => {
        expect(RETENTION_MIN_PERCENT).toBe(70);
        expect(RETENTION_MAX_PERCENT).toBe(99);
    });
});

describe("tag lists", () => {
    test("split on any whitespace, drop empties and duplicates", () => {
        expect(parseTagList("  #a\n#b  #a ")).toEqual(["#a", "#b"]);
        expect(parseTagList("   ")).toEqual([]);
    });
    test("every tag starts with # and has a name", () => {
        expect(tagListError("#a #b/c")).toBeUndefined();
        expect(tagListError("")).toBeUndefined();
        expect(tagListError("#a flashcards")).toBe("Tags start with #, such as #flashcards.");
        expect(tagListError("#")).toBe("Tags start with #, such as #flashcards.");
    });
});

describe("separatorError", () => {
    test("empty and clashing separators are rejected", () => {
        expect(separatorError("::", [":::", "?", "??"])).toBeUndefined();
        expect(separatorError("  ", [":::"])).toBe("Can't be empty.");
        expect(separatorError("?", ["::", ":::", "?"])).toBe(
            "Another card type already uses this.",
        );
    });
});

describe("start of day", () => {
    test("HH:MM and HH:MM:SS, 24-hour", () => {
        expect(startOfDayError("04:00")).toBeUndefined();
        expect(startOfDayError("4:00")).toBeUndefined();
        expect(startOfDayError("23:59:59")).toBeUndefined();
        expect(startOfDayError("24:00")).toBe("Use 24-hour time, such as 04:00.");
        expect(startOfDayError("4")).toBe("Use 24-hour time, such as 04:00.");
        expect(startOfDayError("04:60")).toBe("Use 24-hour time, such as 04:00.");
        expect(startOfDayError("4:0:0")).toBe("Use 24-hour time, such as 04:00.");
    });
    test("normalised to HH:MM:SS", () => {
        expect(normalizeStartOfDay("4:00")).toBe("04:00:00");
        expect(normalizeStartOfDay("23:05:09")).toBe("23:05:09");
    });
});

describe("FSRS steps and weights", () => {
    test("steps", () => {
        expect(stepsError("1m 10m")).toBeUndefined();
        expect(stepsError("")).toBeUndefined();
        expect(stepsError("1x")).toBe("Use steps such as 1m 10m 1h 1d.");
    });
    test("weights", () => {
        expect(weightsError("", "10m")).toBeUndefined();
        expect(weightsError("1, 2, 3", "10m")).toMatch(/^These are not FSRS parameters: /);
    });
});

test("easy days are unique, sorted weekdays", () => {
    expect(normalizeEasyDays([6, 1, 1, -1, 7, 2.5])).toEqual([1, 6]);
});

describe("other text checks", () => {
    test("url", () => {
        expect(urlError("")).toBeUndefined();
        expect(urlError("http://localhost:11434/v1")).toBeUndefined();
        expect(urlError("https://x.test")).toBeUndefined();
        expect(urlError("localhost:11434")).toBe("Start with http:// or https://.");
    });
    test("non-empty", () => {
        expect(nonEmptyError("Good")).toBeUndefined();
        expect(nonEmptyError("  ")).toBe("Can't be empty.");
    });
    test("list entries", () => {
        expect(listEntryError("Archive", ["Templates"])).toBeUndefined();
        expect(listEntryError(" ", [])).toBe("Can't be empty.");
        expect(listEntryError("Templates", ["Templates"])).toBe("Already in the list.");
    });
    test("skipped folders refuse a pattern that starts with !", () => {
        const message = "Patterns starting with ! would skip every other folder.";
        expect(skippedFolderError("Archive", ["Templates"])).toBeUndefined();
        expect(skippedFolderError("Archive/**/!draft.md", [])).toBeUndefined();
        expect(skippedFolderError("!Templates", [])).toBe(message);
        expect(skippedFolderError("  !Templates/**  ", [])).toBe(message);
        // The checks for an empty or repeated entry come first
        expect(skippedFolderError(" ", [])).toBe("Can't be empty.");
        expect(skippedFolderError("Templates", ["Templates"])).toBe("Already in the list.");
    });
    test("a folder pattern is negated only by a leading !", () => {
        expect(isNegatedFolderPattern("!Templates")).toBe(true);
        expect(isNegatedFolderPattern("Templates/!keep.md")).toBe(false);
        expect(isNegatedFolderPattern(" !Templates")).toBe(false);
        expect(isNegatedFolderPattern("")).toBe(false);
    });
    test("cloze patterns name the answer", () => {
        expect(clozePatternError("{{[123;;]answer[;;hint]}}", [])).toBeUndefined();
        expect(clozePatternError("{{x}}", [])).toBe(
            "A pattern needs the word answer where the answer goes.",
        );
        expect(clozePatternError("==answer==", ["==answer=="])).toBe("Already in the list.");
    });
    test("vault folder", () => {
        expect(normalizeVaultFolder(" /Logs//2026/ ", "Default")).toBe("Logs/2026");
        expect(normalizeVaultFolder("/", "Default")).toBe("Default");
        expect(normalizeVaultFolder("a\\b", "Default")).toBe("a/b");
    });
});
