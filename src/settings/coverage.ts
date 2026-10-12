/**
 * The stored settings that have no control on screen, each with the reason. The coverage test checks that every
 * other stored key has one, and that nothing listed here is also on screen.
 */
export const NOT_ON_SCREEN: Record<string, string> = {
    randomizeCardOrder: "Legacy, converted to the order keys on load.",
    editLaterTag: "Legacy, cleared on load.",
    disableFileMenuReviewOptions: "Legacy, cleared on load.",
    showRibbonIcon: "Legacy, nothing reads it.",
    dataStore: "Only one storage type exists.",
    scheduleDataVaultLocation: "For a storage type that does not exist.",
    preferredLocale: "English only ships; kept so older data loads unchanged.",
    convertHighlightsToClozes: "Mirrors the cloze pattern list; the list is edited instead.",
    convertBoldTextToClozes: "Same.",
    convertCurlyBracketsToClozes: "Same.",
};
