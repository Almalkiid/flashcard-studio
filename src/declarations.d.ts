declare module "pagerank.js" {
    export function reset(): void;
    export function link(source: string, target: string, weight: number): void;
    export function rank(
        alpha: number,
        epsilon: number,
        callback: (node: string, rank: number) => void,
    ): void;
}

declare module "preact/src/jsx" {
    export namespace JSXInternal {
        type HTMLAttributes<_T> = Record<string, unknown>;
        type SignalLike<T> = { value: T };
    }
}

declare module "*.css" {
    const content: string;
    export default content;
}

// M4: Anki import and export
// Bundled by the embed-wasm esbuild plugin: the file's bytes, deflate-compressed and base64 encoded.
declare module "*.wasm" {
    const deflatedBase64: string;
    export default deflatedBase64;
}
