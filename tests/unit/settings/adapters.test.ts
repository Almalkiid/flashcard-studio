import { cloneDefaultSettings } from "src/data/settings-model";
import { readControl, reviewOpensInTab, storedKeysOf, writeControl } from "src/settings/adapters";

const desktop = { isMobile: false };
const phone = { isMobile: true };

describe("platform keys", () => {
    test("open in a tab writes the key for this device", () => {
        const s = cloneDefaultSettings();
        expect(writeControl(s, "openInTab", true, phone)).toEqual(["openViewInNewTabMobile"]);
        expect(s.openViewInNewTabMobile).toBe(true);
        expect(s.openViewInNewTab).toBe(false);
        expect(readControl(s, "openInTab", desktop)).toBe(false);
        expect(readControl(s, "openInTab", phone)).toBe(true);
    });
    test("window size writes the key for this device", () => {
        const s = cloneDefaultSettings();
        writeControl(s, "windowHeight", 80, desktop);
        writeControl(s, "windowWidth", 90, phone);
        expect(s.flashcardHeightPercentage).toBe(80);
        expect(s.flashcardWidthPercentageMobile).toBe(90);
        expect(storedKeysOf("windowHeight")).toEqual([
            "flashcardHeightPercentage",
            "flashcardHeightPercentageMobile",
        ]);
    });
});

describe("whether the review opens in a tab", () => {
    test("this device's tab key decides when the desktop layout does not apply", () => {
        const s = cloneDefaultSettings();
        s.desktopLayout = false;
        expect(reviewOpensInTab(s, desktop)).toBe(false);
        s.openViewInNewTab = true;
        expect(reviewOpensInTab(s, desktop)).toBe(true);
        expect(reviewOpensInTab(s, phone)).toBe(false);
        s.openViewInNewTabMobile = true;
        expect(reviewOpensInTab(s, phone)).toBe(true);
    });
    test("the desktop layout with the Studio look opens a tab on a computer only", () => {
        const s = cloneDefaultSettings();
        s.openViewInNewTab = false;
        s.desktopLayout = true;
        s.reviewLook = "studio";
        expect(reviewOpensInTab(s, desktop)).toBe(true);
        expect(reviewOpensInTab(s, phone)).toBe(false);
        s.reviewLook = "classic";
        expect(reviewOpensInTab(s, desktop)).toBe(false);
        s.reviewLook = "studio";
        s.desktopLayout = false;
        expect(reviewOpensInTab(s, desktop)).toBe(false);
    });
});

describe("percent shown, fraction stored", () => {
    test.each([
        ["maxLinkFactor", 1.0, 100],
        ["lapsesIntervalChange", 0.5, 50],
        ["easyBonus", 1.3, 130],
    ] as const)("%s", (key, stored, shown) => {
        const s = cloneDefaultSettings();
        expect(readControl(s, key, desktop)).toBe(shown);
        writeControl(s, key, 25, desktop);
        expect(s[key]).toBeCloseTo(0.25);
    });
});

describe("desired retention is shown as a percent that may have decimals", () => {
    test.each([
        [0.9, 90],
        [0.85, 85],
        [0.905, 90.5],
        [0.7, 70],
        [0.99, 99],
        [0.5, 50],
        [0.9055, 90.55],
    ])("a stored %s reads %s", (stored, shown) => {
        const s = cloneDefaultSettings();
        s.fsrsDesiredRetention = stored;
        expect(readControl(s, "fsrsDesiredRetention", desktop)).toBe(shown);
        // Reading never changes what is stored
        expect(s.fsrsDesiredRetention).toBe(stored);
    });

    test.each([
        [90, 0.9],
        [85, 0.85],
        [90.5, 0.905],
        [90.55, 0.9055],
        [70, 0.7],
        [99, 0.99],
        [71, 0.71],
    ])("typing %s stores the fraction %s, with no float noise", (typed, stored) => {
        const s = cloneDefaultSettings();
        expect(writeControl(s, "fsrsDesiredRetention", typed, desktop)).toEqual([
            "fsrsDesiredRetention",
        ]);
        expect(s.fsrsDesiredRetention).toBe(stored);
        expect(readControl(s, "fsrsDesiredRetention", desktop)).toBe(typed);
    });

    test("the whole-percent controls still read whole percents", () => {
        const s = cloneDefaultSettings();
        s.easyBonus = 1.305;
        expect(readControl(s, "easyBonus", desktop)).toBe(131);
        s.maxLinkFactor = 0.333;
        expect(readControl(s, "maxLinkFactor", desktop)).toBe(33);
    });
});

describe("lists and normalised text", () => {
    test("tag lists show as text and store arrays without empties", () => {
        const s = cloneDefaultSettings();
        s.flashcardTags = [""];
        expect(readControl(s, "flashcardTags", desktop)).toBe("");
        writeControl(s, "flashcardTags", " #a  #b ", desktop);
        expect(s.flashcardTags).toEqual(["#a", "#b"]);
    });
    test("callout types", () => {
        const s = cloneDefaultSettings();
        expect(readControl(s, "calloutCardTypes", desktop)).toBe("flashcard, question, card");
        writeControl(s, "calloutCardTypes", "[!Quiz], Card card", desktop);
        expect(s.calloutCardTypes).toEqual(["quiz", "card"]);
    });
    test("start of day, steps, weights and folder are stored normalised", () => {
        const s = cloneDefaultSettings();
        writeControl(s, "startOfDay", "4:00", desktop);
        expect(s.startOfDay).toBe("04:00:00");
        writeControl(s, "fsrsLearningSteps", " 1m,  10m ", desktop);
        expect(s.fsrsLearningSteps).toBe("1m 10m");
        writeControl(s, "fsrsWeights", "  ", desktop);
        expect(s.fsrsWeights).toBe("");
        writeControl(s, "reviewLogFolder", "/", desktop);
        expect(s.reviewLogFolder).toBe("Flashcard Studio/Review log");
        writeControl(s, "aiModel", "  gpt-x ", desktop);
        expect(s.aiModel).toBe("gpt-x");
    });
    test("an ordinary key passes straight through", () => {
        const s = cloneDefaultSettings();
        expect(writeControl(s, "burySiblingCards", true, desktop)).toEqual(["burySiblingCards"]);
        expect(s.burySiblingCards).toBe(true);
        expect(storedKeysOf("burySiblingCards")).toEqual(["burySiblingCards"]);
    });
});
