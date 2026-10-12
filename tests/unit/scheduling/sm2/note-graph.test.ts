import type { MetadataCache } from "obsidian";
import * as pagerank from "pagerank.js";

import { DEFAULT_SETTINGS } from "src/data/settings-model";
import { NoteEaseList } from "src/note-review/note-ease-list";
import { NoteLinkGraph, ObsidianVaultNoteLinkInfoFinder } from "src/scheduling/sm2/note-graph";

import { ids, mismatches } from "../schedule/golden-views";
import { sm2Golden } from "./grid";
import { ScriptedLinks } from "./scripted-links";

type Links = Record<string, Record<string, number>>;
type Stat = { linkTotal: number; linkPGTotal: number; totalLinkCount: number };

interface GraphRow {
    id: string;
    links: Links;
    eases: Record<string, number>;
    incomingLinks: Record<string, { sourcePath: string; linkCount: number }[]>;
    pageranks: Record<string, number>;
    linkStats: Record<string, Stat>;
}
const rows = (sm2Golden as unknown as { noteGraphs: GraphRow[] }).noteGraphs;

/** A graph built the way a scan builds it: every note's links (a note may have none), then the page ranks. */
function build(links: Links, notes: string[] = Object.keys(links)): NoteLinkGraph {
    const graph = new NoteLinkGraph(new ScriptedLinks(links));
    for (const path of notes) graph.processLinks(path);
    graph.generatePageRanks();
    return graph;
}

/** True when the two numbers agree to 1e-9 of the larger, the tolerance the golden README gives for raw doubles. */
const close = (a: number, b: number): boolean =>
    Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

function ranksClose(actual: Record<string, number>, expected: Record<string, number>): boolean {
    const names = Object.keys(expected);
    return (
        names.length === Object.keys(actual).length &&
        names.every((name) => name in actual && close(actual[name], expected[name]))
    );
}

describe("NoteLinkGraph against the 11 golden graphs", () => {
    test("incoming links, page ranks and the link totals of every note", () => {
        const bad = mismatches(rows, (row) => {
            const graph = build(row.links, Object.keys(row.linkStats));
            const easeList = new NoteEaseList(DEFAULT_SETTINGS);
            for (const [path, ease] of Object.entries(row.eases))
                easeList.setEaseForPath(path, ease);
            const statsClose = Object.entries(row.linkStats).every(([path, expected]) => {
                const stat = graph.calcNoteLinkStat(path, easeList);
                return (
                    close(stat.linkTotal, expected.linkTotal) &&
                    close(stat.linkPGTotal, expected.linkPGTotal) &&
                    stat.totalLinkCount === expected.totalLinkCount
                );
            });
            return {
                expected: [row.incomingLinks, true, true],
                actual: [
                    graph.incomingLinks,
                    ranksClose(graph.pageranks, row.pageranks),
                    statsClose,
                ],
            };
        });
        expect(rows).toHaveLength(11);
        expect(bad.slice(0, 2)).toEqual([]);
        expect(ids(bad)).toEqual([]);
    });
});

describe("NoteLinkGraph rules", () => {
    test("only links to markdown notes carry rank; an image gets an empty entry and no edge", () => {
        const graph = build({ "A.md": { "B.md": 1, "pic.png": 3 }, "B.md": {} });
        expect(graph.incomingLinks["pic.png"]).toEqual([]);
        expect(Object.keys(graph.pageranks).sort()).toEqual(["A.md", "B.md"]);
    });

    test("the markdown test ignores the case of the extension", () => {
        const graph = build({ "A.md": { "B.MD": 2 } });
        expect(graph.incomingLinks["B.MD"]).toEqual([{ sourcePath: "A.md", linkCount: 2 }]);
    });

    test("a note whose links are unknown has no links", () => {
        const graph = new NoteLinkGraph({ getResolvedTargetLinksForNotePath: () => undefined });
        graph.processLinks("A.md");
        graph.generatePageRanks();
        expect(graph.incomingLinks).toEqual({ "A.md": [] });
        expect(graph.pageranks).toEqual({});
    });

    test("the ranks of one graph sum to 10,000 (the rank is scaled by 10,000)", () => {
        const graph = build(rows.find((row) => row.id === "graph/g-hub").links);
        const total = Object.values(graph.pageranks).reduce((sum, rank) => sum + rank, 0);
        expect(total).toBeCloseTo(10_000, 3);
    });

    test("the links to an unknown note count for nothing", () => {
        const graph = build({ "A.md": {} });
        const stat = graph.calcNoteLinkStat("Z.md", new NoteEaseList(DEFAULT_SETTINGS));
        expect(stat).toEqual({ linkTotal: 0, linkPGTotal: 0, totalLinkCount: 0 });
    });

    test("two graphs do not clash: each keeps its own edges and ranks, even when built in turn", () => {
        const first: Links = { "A.md": { "B.md": 1 }, "B.md": { "A.md": 1 } };
        const second: Links = {
            "X.md": { "Y.md": 5, "Z.md": 1 },
            "Y.md": {},
            "Z.md": { "X.md": 2 },
        };
        const alone = { first: build(first).pageranks, second: build(second).pageranks };

        // Interleave: both graphs are fed before either computes its ranks
        const a = new NoteLinkGraph(new ScriptedLinks(first));
        const b = new NoteLinkGraph(new ScriptedLinks(second));
        a.processLinks("A.md");
        b.processLinks("X.md");
        a.processLinks("B.md");
        b.processLinks("Y.md");
        b.processLinks("Z.md");
        b.generatePageRanks();
        a.generatePageRanks();

        expect(ranksClose(a.pageranks, alone.first)).toBe(true);
        expect(ranksClose(b.pageranks, alone.second)).toBe(true);
        expect(Object.keys(a.pageranks).sort()).toEqual(["A.md", "B.md"]);
        expect(Object.keys(b.pageranks).sort()).toEqual(["X.md", "Y.md", "Z.md"]);
    });

    test("ranks can be computed again after more notes are processed", () => {
        const links: Links = { "A.md": { "B.md": 1 }, "B.md": {}, "C.md": { "A.md": 1 } };
        const graph = new NoteLinkGraph(new ScriptedLinks(links));
        graph.processLinks("A.md");
        graph.generatePageRanks();
        expect(Object.keys(graph.pageranks).sort()).toEqual(["A.md", "B.md"]);
        graph.processLinks("C.md");
        graph.generatePageRanks();
        expect(Object.keys(graph.pageranks).sort()).toEqual(["A.md", "B.md", "C.md"]);
    });
});

describe("page ranks against the pagerank.js library (the previous implementation), on random graphs", () => {
    /** A small seeded generator, so a failing graph can be rebuilt. */
    function random(seed: number): () => number {
        let state = seed;
        return () => {
            state = (state + 0x6d2b79f5) | 0;
            let t = Math.imul(state ^ (state >>> 15), 1 | state);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function randomLinks(seed: number): Links {
        const next = random(seed);
        const size = 2 + Math.floor(next() * 40);
        const names = Array.from({ length: size }, (_, index) => `n${index}.md`);
        const links: Links = {};
        for (const name of names) {
            links[name] = {};
            // Some notes link to nothing, some to themselves, weights are link counts (rarely 0)
            const count = next() < 0.25 ? 0 : Math.floor(next() * 6);
            for (let edge = 0; edge < count; edge++) {
                const target = names[Math.floor(next() * size)];
                links[name][target] = next() < 0.03 ? 0 : 1 + Math.floor(next() * 4);
            }
        }
        return links;
    }

    test("200 graphs agree to 1e-9", () => {
        const bad: number[] = [];
        for (let seed = 1; seed <= 200; seed++) {
            const links = randomLinks(seed);
            const graph = build(links);

            pagerank.reset();
            for (const [source, targets] of Object.entries(links)) {
                for (const [target, weight] of Object.entries(targets)) {
                    pagerank.link(source, target, weight);
                }
            }
            const expected: Record<string, number> = {};
            pagerank.rank(0.85, 0.000001, (node, rank) => (expected[node] = rank * 10000));
            pagerank.reset();

            if (!ranksClose(graph.pageranks, expected)) bad.push(seed);
        }
        expect(bad).toEqual([]);
    });
});

describe("the link finder over Obsidian's cache", () => {
    test("returns the resolved links of the note, and nothing for a note the cache does not know", () => {
        const cache = { resolvedLinks: { "A.md": { "B.md": 2 } } } as unknown as MetadataCache;
        const finder = new ObsidianVaultNoteLinkInfoFinder(cache);
        expect(finder.getResolvedTargetLinksForNotePath("A.md")).toEqual({ "B.md": 2 });
        expect(finder.getResolvedTargetLinksForNotePath("C.md")).toBeUndefined();
    });
});
