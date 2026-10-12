const REDUCED_FADE_CLASS = "fs-reduced-bottom-fade-mask";

/**
 * Undoes what a Studio tab changes on a phone or tablet: the mobile navigation bar goes back to Obsidian's own
 * positioning, and the bottom fade goes back to its normal height. Safe to call when nothing was changed.
 */
export function restoreMobileChrome(): void {
    // An empty value takes the inline override away, so Obsidian's own positioning applies again
    activeDocument.querySelector<HTMLElement>(".mobile-navbar")?.setCssProps({ position: "" });
    activeDocument.body.removeClass(REDUCED_FADE_CLASS);
}

/**
 * Makes room at the bottom of a phone for a full-screen tab: the navigation bar scrolls with the page instead of
 * floating, and the floating navigation's fade over the content gets shorter. `restoreMobileChrome` undoes it.
 */
export function reduceMobileChrome(): void {
    const { body } = activeDocument;
    if (body.hasClass("is-mobile")) {
        activeDocument
            .querySelector<HTMLElement>(".mobile-navbar")
            ?.setCssProps({ position: "relative" });
    }
    if (body.hasClass("is-phone") && body.hasClass("is-floating-nav")) {
        body.addClass(REDUCED_FADE_CLASS);
    }
}
