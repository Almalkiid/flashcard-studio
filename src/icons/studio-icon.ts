import { addIcon } from "obsidian";

/** The id of the plugin's icon: a card with a spark. Use it wherever Obsidian asks for an icon name. */
export const STUDIO_ICON = "studio-card-spark";

// Drawn in Obsidian's own style (round line ends, no fill, colour from the theme) in the 100 x 100 box that addIcon
// expects. The stroke of 8.3 is Lucide's 2 out of 24.
const STUDIO_ICON_SVG =
    '<g fill="none" stroke="currentColor" stroke-width="8.3" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="18" y="10" width="64" height="80" rx="10"/>' +
    '<path d="M50 34C50 44 56 50 66 50C56 50 50 56 50 66C50 56 44 50 34 50C44 50 50 44 50 34Z"/>' +
    "</g>";

/** Makes `STUDIO_ICON` known to Obsidian. */
export function registerStudioIcon(): void {
    addIcon(STUDIO_ICON, STUDIO_ICON_SVG);
}
