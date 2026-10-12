// The library is a dev dependency: only the page rank test imports it, to compare the note graph's ranks with it
declare module "pagerank.js" {
    export function reset(): void;
    export function link(source: string, target: string, weight: number): void;
    export function rank(
        alpha: number,
        epsilon: number,
        callback: (node: string, rank: number) => void,
    ): void;
}
