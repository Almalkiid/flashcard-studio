import {
    DESKTOP_MIN_WIDTH,
    layoutToShow,
    useDesktopLayout,
} from "src/ui/obsidian-ui-components/content-container/desktop/desktop-shell";

describe("useDesktopLayout", () => {
    test("desktop at or above the minimum width", () => {
        expect(useDesktopLayout(false, DESKTOP_MIN_WIDTH)).toBe(true);
        expect(useDesktopLayout(false, 1440)).toBe(true);
    });

    test("narrow desktop panes and phones keep the phone layout", () => {
        expect(useDesktopLayout(true, 2000)).toBe(false);
        expect(useDesktopLayout(false, DESKTOP_MIN_WIDTH - 1)).toBe(false);
    });
});

describe("layoutToShow", () => {
    const wide = { isMobile: false, classic: false, paneWidth: 1400, inSession: false };
    const narrow = { ...wide, paneWidth: 700 };

    test("follows the width of the pane", () => {
        expect(layoutToShow(false, wide)).toBe(true);
        expect(layoutToShow(true, narrow)).toBe(false);
        expect(layoutToShow(true, wide)).toBe(true);
        expect(layoutToShow(false, narrow)).toBe(false);
    });

    test("a pane that is not shown says nothing about its width, so what is on screen stays", () => {
        // A tab in the background is display: none and measures 0
        expect(layoutToShow(true, { ...wide, paneWidth: 0 })).toBe(true);
        expect(layoutToShow(false, { ...wide, paneWidth: 0 })).toBe(false);
    });

    test("a session in progress keeps its layout, whatever the pane does", () => {
        expect(layoutToShow(true, { ...narrow, inSession: true })).toBe(true);
        expect(layoutToShow(false, { ...wide, inSession: true })).toBe(false);
    });

    test("the phone and the Classic look never get the desktop layout", () => {
        expect(layoutToShow(false, { ...wide, isMobile: true })).toBe(false);
        expect(layoutToShow(false, { ...wide, classic: true })).toBe(false);
    });
});
