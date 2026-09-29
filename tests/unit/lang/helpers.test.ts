import { t } from "src/lang/helpers";
import en from "src/lang/locale/en";
import { LocaleManagerInstance } from "src/lang/locale-manager";

// #1644: the plugin failed to load when Obsidian's language had no translation (e.g. Swedish), because t() read
// the missing translation map before falling back to English.
describe("t() with a language that has no translation", () => {
    const manager = LocaleManagerInstance.getInstance();
    let previous: string;

    beforeEach(() => {
        previous = manager.currentLocale;
        manager.currentLocale = "sv";
    });

    afterEach(() => {
        manager.currentLocale = previous;
    });

    test("falls back to English instead of throwing", () => {
        expect(t("DECKS")).toBe(en.DECKS);
    });

    test("fills parameters in the English text", () => {
        expect(t("NEXT_REVIEW_IN", { interval: "3d" })).toBe("next in 3d");
    });
});
