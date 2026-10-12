import type { INoteFile } from "src/data/data-structures/file/vault-note";
import type { StudioSettings } from "src/data/settings-model";

/** The folder part of a vault path as deck names: `a/b/c.md` gives `[a, b]`, a file in the vault root gives `[]`. */
function folderNames(filePath: string): string[] {
    const slash = filePath.lastIndexOf("/");
    return slash < 0 ? [] : filePath.slice(0, slash).split("/");
}

/** A deck's place in the tree: the names from the top down, without the root. */
export class TopicPath {
    /** Keeps the array it is given. */
    constructor(public path: string[]) {
        if (path == null) throw new Error("path is null");
        if (path.some((name) => name.includes("/"))) {
            throw new Error("path entries must not contain '/'");
        }
    }

    get hasPath(): boolean {
        return !this.isEmptyPath;
    }

    get isEmptyPath(): boolean {
        return !this.path.length;
    }

    /** A new, empty path each time, so one caller's `shift` cannot change another's. */
    static get emptyPath(): TopicPath {
        return new TopicPath([]);
    }

    /** Removes and returns the first name. */
    shift(): string {
        if (this.isEmptyPath) throw new Error("can't shift an empty path");
        return this.path.shift();
    }

    clone(): TopicPath {
        return new TopicPath(this.path.slice());
    }

    formatAsTag(): string {
        if (this.isEmptyPath) throw new Error("Empty path");
        return `#${this.path.join("/")}`;
    }

    /** Whether `other` is this path or lies below it. The empty path is only the ancestor of the empty path. */
    isSameOrAncestorOf(other: TopicPath): boolean {
        const mine = this.path;
        if (!mine.length) return !other.path.length;
        return mine.length <= other.path.length && mine.every((name, i) => name === other.path[i]);
    }

    /** `#a/b` as [a, b]. Only the first `#` is dropped and empty parts are skipped; `#/` is the empty path. */
    static getTopicPathFromTag(tag: string): TopicPath {
        if (!tag) throw new Error("Null/empty tag");
        if (!tag.startsWith("#")) throw new Error("Tag must start with #");
        if (tag.length === 1) throw new Error("Invalid tag");
        const names = tag.slice(1).split("/");
        return new TopicPath(names.filter((name) => name !== ""));
    }

    static isValidTag(tag: string): boolean {
        return Boolean(tag) && tag.length > 1 && tag[0] === "#";
    }

    /**
     * The topic path a card's text starts with, or null when it does not start with a tag. A second `#` ends the tag
     * here (`#a#b` is [a]), unlike in `getTopicPathFromTag`.
     */
    static getTopicPathFromCardText(text: string): TopicPath | null {
        const tag = text.trimStart().match(/^#[^\s#]+/)?.[0];
        return tag ? TopicPath.getTopicPathFromTag(tag) : null;
    }

    /**
     * Where a note's cards go: its folder in folders mode, otherwise its tag below the first flashcard tag of the
     * settings that has one (checked in settings order). The result is the note's tag, not the setting's.
     */
    static getTopicPathOfFile(file: INoteFile, settings: StudioSettings): TopicPath {
        if (settings.convertFoldersToDecks) return new TopicPath(folderNames(file.path));

        const noteTags = file.getAllTagsFromCache().filter((tag) => TopicPath.isValidTag(tag));
        const roots = settings.flashcardTags
            .filter((tag) => TopicPath.isValidTag(tag))
            .map((tag) => TopicPath.getTopicPathFromTag(tag));
        for (const root of roots) {
            for (const tag of noteTags) {
                const candidate = TopicPath.getTopicPathFromTag(tag);
                if (root.isSameOrAncestorOf(candidate)) return candidate;
            }
        }
        return TopicPath.emptyPath;
    }

    /** The note's folder as a path in folders mode, otherwise the empty path. */
    static getFolderPathFromFilename(file: { path: string }, settings: StudioSettings): TopicPath {
        const names = settings.convertFoldersToDecks ? folderNames(file.path) : [];
        return new TopicPath(names);
    }
}

/** The decks one question belongs to, and the line of the tags that said so (null when not from a line). */
export class TopicPathList {
    constructor(
        public list: TopicPath[],
        public lineNum: number | null = null,
    ) {
        if (list == null) throw new Error("TopicPathList null");
    }

    get length(): number {
        return this.list.length;
    }

    /** The tags joined with `sep`; an empty path inside throws. */
    format(sep: string): string {
        return this.list.map((topic) => topic.formatAsTag()).join(sep);
    }

    static empty(): TopicPathList {
        return new TopicPathList([]);
    }

    /** The tags joined with `|`: the compact form tests write lists in. */
    formatPsv(): string {
        return this.format("|");
    }

    static fromPsv(psv: string, lineNum: number | null = null): TopicPathList {
        const paths = psv
            .split("|")
            .filter((tag) => tag)
            .map((tag) => TopicPath.getTopicPathFromTag(tag));
        return new TopicPathList(paths, lineNum);
    }
}

/** A tag with the whitespace around it, so a rewritten question keeps its spacing. */
export class TopicPathWithWs {
    constructor(
        public topicPath: TopicPath,
        public preWhitespace: string,
        public postWhitespace: string,
    ) {
        if (topicPath == null || topicPath.isEmptyPath) throw new Error("topicPath null");
    }

    formatWithWs(): string {
        const { preWhitespace, topicPath, postWhitespace } = this;
        return [preWhitespace, topicPath.formatAsTag(), postWhitespace].join("");
    }
}
