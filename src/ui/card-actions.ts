/**
 * Card actions offered by the review screen's menu, keyboard and answer toast.
 */
export interface CardActions {
    undo: () => Promise<void>;
    canUndo: () => boolean;
    suspend: () => Promise<void>;
    bury: () => Promise<void>;
    setFlag: (flag: number) => Promise<void>;
    currentFlag: () => number;
}

/** Number of Anki flag colours. */
export const FLAG_COUNT = 7;
