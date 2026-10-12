import type { MetadataCache } from "obsidian";

import type { INoteEaseList } from "src/note-review/note-ease-list";

/** Where the graph asks which notes a note links to; tests give it links as data. */
export interface IVaultNoteLinkFinder {
    /** The notes (or other files) a note links to and how many links lead to each; unknown notes may give nothing. */
    getResolvedTargetLinksForNotePath(sourcePath: string): Record<string, number>;
}

/** The finder over Obsidian's own record of the links that lead somewhere. */
export class ObsidianVaultNoteLinkInfoFinder implements IVaultNoteLinkFinder {
    constructor(private readonly metadataCache: MetadataCache) {}

    getResolvedTargetLinksForNotePath(path: string): Record<string, number> {
        return this.metadataCache.resolvedLinks[path];
    }
}

export interface LinkStat {
    sourcePath: string;
    linkCount: number;
}

/** What a note's neighbours add up to: their eases weighted by page rank and link count. */
export interface NoteLinkStat {
    linkTotal: number;
    linkPGTotal: number;
    totalLinkCount: number;
}

/** Damping factor and stopping distance of the page rank. */
const DAMPING = 0.85;
const TOLERANCE = 0.000001;

/** Page ranks are scaled up so they read as whole numbers in logs; the scale cancels in every ease formula. */
const RANK_SCALE = 10000;

/**
 * The links between the notes of a vault, built once per scan with `processLinks` for every note and then ranked with
 * `generatePageRanks`. Every graph holds its own edges, so two graphs never disturb each other.
 */
export class NoteLinkGraph {
    /** For each file, the notes that link to it (images and other files get an empty list). */
    incomingLinks: Record<string, LinkStat[]> = {};
    /** For each note that has a link to or from another note, its rank. Higher means more important. */
    pageranks: Record<string, number> = {};

    constructor(private readonly vaultNoteLinkInfoFinder: IVaultNoteLinkFinder) {}

    /** Reads the links of one note into the graph. Only links to markdown notes can carry rank. */
    processLinks(path: string): void {
        this.incomingLinks[path] ??= [];
        const links = this.vaultNoteLinkInfoFinder.getResolvedTargetLinksForNotePath(path) ?? {};
        for (const [target, linkCount] of Object.entries(links)) {
            this.incomingLinks[target] ??= [];
            if (target.toLowerCase().endsWith(".md")) {
                this.incomingLinks[target].push({ sourcePath: path, linkCount });
            }
        }
    }

    /**
     * Adds up the neighbours of a note that have an ease in the list: the notes that link to it and the files it links
     * to. A neighbour without an ease (an image, a note never reviewed) counts for nothing.
     */
    calcNoteLinkStat(notePath: string, noteEaseList: INoteEaseList): NoteLinkStat {
        const stat: NoteLinkStat = { linkTotal: 0, linkPGTotal: 0, totalLinkCount: 0 };
        const add = (path: string, linkCount: number): void => {
            const ease = noteEaseList.getEaseByPath(path);
            if (!ease) return;
            stat.linkTotal += linkCount * this.pageranks[path] * ease;
            stat.linkPGTotal += this.pageranks[path] * linkCount;
            stat.totalLinkCount += linkCount;
        };

        for (const { sourcePath, linkCount } of this.incomingLinks[notePath] ?? []) {
            add(sourcePath, linkCount);
        }
        const outgoing = this.vaultNoteLinkInfoFinder.getResolvedTargetLinksForNotePath(notePath);
        for (const [target, linkCount] of Object.entries(outgoing ?? {})) add(target, linkCount);
        return stat;
    }

    /**
     * Weighted PageRank over the links to markdown notes, the weight of an edge being its link count. A note that
     * links to nothing spreads its rank over all notes. Repeats until the ranks move by less than a millionth in total.
     */
    generatePageRanks(): void {
        const names: string[] = [];
        const indexOf = new Map<string, number>();
        const indexFor = (path: string): number => {
            let index = indexOf.get(path);
            if (index === undefined) {
                index = names.length;
                indexOf.set(path, index);
                names.push(path);
            }
            return index;
        };

        const from: number[] = [];
        const to: number[] = [];
        const weight: number[] = [];
        for (const [target, links] of Object.entries(this.incomingLinks)) {
            for (const { sourcePath, linkCount } of links) {
                from.push(indexFor(sourcePath));
                to.push(indexFor(target));
                weight.push(linkCount);
            }
        }

        const count = names.length;
        this.pageranks = {};
        if (count === 0) return;

        // Each edge passes on its share of the source's rank
        const outbound = new Float64Array(count);
        weight.forEach((linkCount, edge) => (outbound[from[edge]] += linkCount));
        const share = weight.map((linkCount, edge) =>
            outbound[from[edge]] > 0 ? linkCount / outbound[from[edge]] : 0,
        );

        let rank = new Float64Array(count).fill(1 / count);
        let next = new Float64Array(count);
        for (let change = 1; change > TOLERANCE;) {
            let leak = 0;
            for (let node = 0; node < count; node++) if (outbound[node] === 0) leak += rank[node];
            next.fill((1 - DAMPING) / count + (DAMPING * leak) / count);
            for (let edge = 0; edge < share.length; edge++) {
                next[to[edge]] += DAMPING * rank[from[edge]] * share[edge];
            }
            change = 0;
            for (let node = 0; node < count; node++) change += Math.abs(next[node] - rank[node]);
            [rank, next] = [next, rank];
        }

        names.forEach((name, node) => (this.pageranks[name] = rank[node] * RANK_SCALE));
    }
}
