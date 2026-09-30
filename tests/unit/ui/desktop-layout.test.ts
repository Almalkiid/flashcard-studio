import { cloneDefaultSettings, DEFAULT_SETTINGS } from "src/data/settings";
import {
    DESKTOP_MIN_WIDTH,
    useDesktopLayout,
} from "src/ui/obsidian-ui-components/content-container/desktop/desktop-shell";

describe("useDesktopLayout", () => {
    test("desktop at or above the minimum width", () => {
        expect(useDesktopLayout(false, DESKTOP_MIN_WIDTH)).toBe(true);
        expect(useDesktopLayout(false, 1440)).toBe(true);
    });

    test("narrow desktop panes and phones keep the phone layout", () => {
        expect(useDesktopLayout(false, DESKTOP_MIN_WIDTH - 1)).toBe(false);
        expect(useDesktopLayout(true, 2000)).toBe(false);
    });
});

describe("open in a tab", () => {
    test("is on by default, so a new install on desktop gets the desktop interface", () => {
        expect(DEFAULT_SETTINGS.openViewInNewTab).toBe(true);
    });

    test("an install that saved a choice keeps it, as settings load over the defaults", () => {
        const saved = { openViewInNewTab: false };
        expect(Object.assign(cloneDefaultSettings(), saved).openViewInNewTab).toBe(false);
    });

    test("the phone keeps opening in a modal unless asked", () => {
        expect(DEFAULT_SETTINGS.openViewInNewTabMobile).toBe(false);
    });
});
