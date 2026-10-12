import type { TagCache, TFile } from "obsidian";

import type { IVaultNoteFile } from "src/data/data-structures/file/vault-note";
import type { ScheduleState } from "src/scheduling/schedule/schedule-state";
import { TextDirection } from "src/utils/text";

const TAG = /(^|\s)(#[\w\-/]+)/g;

/**
 * A note held in a string. `content` is the text as it stands; `write` and `edit` replace it. The tags are read from
 * the text itself: every `#tag` on a line, and the items of a `tags:` list in the frontmatter (at line -1).
 */
export class UnitTestNoteFile implements IVaultNoteFile {
    schedule: ScheduleState | null = null;

    constructor(
        public content: string,
        public path: string = "",
    ) {}

    get basename(): string {
        return this.path.replace(/^.*\//, "").replace(/\.md$/, "");
    }

    get tfile(): TFile {
        return { path: this.path, basename: this.basename } as never;
    }

    getFrontmatter(): Promise<Map<string, string>> {
        return Promise.resolve(new Map<string, string>());
    }

    getAllTagsFromCache(): string[] {
        return this.getAllTagsFromText().map((entry) => entry.tag);
    }

    getAllTagsFromText(): TagCache[] {
        const found: TagCache[] = [];
        const lines = this.content.split("\n");
        // Frontmatter that is never closed is not frontmatter
        let inFrontmatter = lines[0] === "---" && lines.indexOf("---", 1) > 0;
        let inTagList = false;
        lines.forEach((line, lineNum) => {
            if (inFrontmatter && lineNum > 0) {
                if (line === "---") inFrontmatter = false;
                else if (/^tags:\s*$/.test(line)) inTagList = true;
                else {
                    const item = /^\s+-\s+(\S+)\s*$/.exec(line);
                    if (inTagList && item) found.push(positioned("#" + item[1], -1, -1));
                    else inTagList = false;
                }
            }
            for (const match of line.matchAll(TAG)) {
                const col = (match.index ?? 0) + match[1].length;
                found.push(positioned(match[2], lineNum, col));
            }
        });
        return found;
    }

    getTextDirection(): TextDirection {
        return TextDirection.Unspecified;
    }

    read(): Promise<string> {
        return Promise.resolve(this.content);
    }

    cachedRead(): Promise<string> {
        return Promise.resolve(this.content);
    }

    write(content: string): Promise<void> {
        this.content = content;
        return Promise.resolve();
    }

    async edit(change: (text: string) => string | null): Promise<boolean> {
        const changed = change(this.content);
        if (changed === null) return false;
        await this.write(changed);
        return true;
    }

    getNoteSchedule(): Promise<ScheduleState | null> {
        return Promise.resolve(this.schedule);
    }

    setNoteSchedule(schedule: ScheduleState): Promise<void> {
        this.schedule = schedule;
        return Promise.resolve();
    }

    getQuestionContext(): string[] {
        return [];
    }
}

function positioned(tag: string, line: number, col: number): TagCache {
    const position = { line, col, offset: col };
    return { tag, position: { start: position, end: position } };
}
