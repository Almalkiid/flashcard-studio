import type { IVaultNoteLinkFinder } from "src/scheduling/sm2/note-graph";

/** Links given as data: for each note, the notes it links to and how many times. */
export class ScriptedLinks implements IVaultNoteLinkFinder {
    constructor(private readonly links: Record<string, Record<string, number>>) {}

    getResolvedTargetLinksForNotePath(sourcePath: string): Record<string, number> {
        return this.links[sourcePath];
    }
}
