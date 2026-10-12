import type { StudioSettings } from "src/data/settings-model";

export interface INoteEaseList {
    dict: Record<string, number>;
    hasEaseForPath(path: string): boolean;
    getEaseByPath(path: string): number | null;
    setEaseForPath(path: string, ease: number): void;
}

/** Per-load note ease cache used by the SM-2 link graph. */
export class NoteEaseList implements INoteEaseList {
    readonly dict: Record<string, number> = {};

    constructor(_settings: StudioSettings) {}

    hasEaseForPath(path: string): boolean {
        return Object.prototype.hasOwnProperty.call(this.dict, path);
    }

    getEaseByPath(path: string): number | null {
        return this.hasEaseForPath(path) ? Math.round(this.dict[path]) : null;
    }

    setEaseForPath(path: string, ease: number): void {
        this.dict[path] = ease;
    }
}
