import type { TFile } from "obsidian";

import type SRPlugin from "src/main";

/**
 * Opens "Generate cards with AI" for a note. `text` is what the note holds, or the selection when `fromSelection` is
 * set; a whole note is sent without its front matter. The dialog is loaded here, when it is used, so none of its code
 * runs while the plugin starts, and nothing is sent anywhere until the person chooses Generate.
 */
export async function openGenerateCards(
    plugin: SRPlugin,
    file: TFile,
    text: string,
    fromSelection: boolean,
): Promise<void> {
    const [{ GenerateCardsModal }, { stripFrontmatter }] = await Promise.all([
        import("src/ai/generate-cards-modal"),
        import("src/ai/card-generation"),
    ]);
    const source = fromSelection ? text : stripFrontmatter(text);
    new GenerateCardsModal(plugin, file, source, fromSelection).open();
}
