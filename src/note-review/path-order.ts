/** The files in path order (code units, so the order does not depend on the language of the machine). */
export function inPathOrder<T extends { path: string }>(files: readonly T[]): T[] {
    return [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
