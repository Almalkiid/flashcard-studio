import { setIcon } from "obsidian";

/** Deck icons and colours, picked from the deck's name so a deck keeps its look on every screen. */
const DECK_ICONS = [
    "layers",
    "book-open",
    "landmark",
    "briefcase",
    "scale",
    "graduation-cap",
    "library",
];
const DECK_TONES = ["blue", "orange", "purple", "green", "teal", "amber", "red"];

function hashOf(text: string): number {
    let hash = 0;
    for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return hash;
}

/** The deck's colour name (`blue`, `teal`, ...), the tone class `fs-tone-<name>` from studio-tokens.css. */
export function deckToneOf(deckName: string): string {
    return DECK_TONES[hashOf(deckName) % DECK_TONES.length];
}

export function readableDeckName(name: string): string {
    const words = name.replace(/[-_]+/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Adds the deck's icon tile (an `.fs-icon-tile` from studio-tokens.css) to `parent`.
 */
export function createDeckTile(parent: HTMLElement, deckName: string): HTMLElement {
    const hash = hashOf(deckName);
    const tile = parent.createDiv({
        cls: `fs-icon-tile fs-tone-${DECK_TONES[hash % DECK_TONES.length]}`,
    });
    setIcon(tile, DECK_ICONS[(hash >>> 3) % DECK_ICONS.length]);
    return tile;
}
