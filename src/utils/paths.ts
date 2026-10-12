import { minimatch } from "minimatch";

/**
 * Whether a vault path is covered by a folder setting: the path starts with the text (so `Cooking/Pasta` also covers
 * `Cooking/Pastas/a.md`), or the path matches the text as a glob such as `dir/{a,b}.md`.
 */
export function pathMatchesPattern(path: string, pattern: string): boolean {
    if (path.startsWith(pattern)) return true;
    return minimatch(path, pattern);
}
