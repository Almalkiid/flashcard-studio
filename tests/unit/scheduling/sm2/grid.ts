import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { DueDateHistogram } from "src/scheduling/due-histogram";
import { ReviewResponse } from "src/scheduling/schedule/review-item";

import { loadGolden } from "../golden/load-golden";

/** The part of golden/sm2-grid.json that every SM-2 test shares: settings variations, histograms and the grid rows. */
export interface Sm2Row {
    id: string;
    config: string;
    histogram: string | null;
    response: ResponseName;
    interval: number;
    ease: number;
    delayDays: number;
    out: { interval: number; ease: number };
}

export type ResponseName = "Easy" | "Good" | "Hard" | "Again" | "Reset";
export interface Outcome {
    text: string;
    interval: number;
    ease: number;
    dueDay: string;
}

export interface Sm2Golden {
    configs: Record<string, Partial<StudioSettings>>;
    histograms: Record<string, Record<string, number>>;
    inventoryCrossChecks: {
        id: string;
        input: {
            response: ResponseName;
            interval: number;
            ease: number;
            delayDays: number;
            config: string;
            histogram: string | null;
        };
        actual: { interval: number; ease: number };
        matchesInventory: boolean;
    }[];
    sm2Step: Sm2Row[];
    knownBugs: { bug: number | null; entries: string[] }[];
}

export const RESPONSE: Record<ResponseName, ReviewResponse> = {
    Easy: ReviewResponse.Easy,
    Good: ReviewResponse.Good,
    Hard: ReviewResponse.Hard,
    Again: ReviewResponse.Again,
    Reset: ReviewResponse.Reset,
};

export const sm2Golden = loadGolden<Sm2Golden & Record<string, unknown>>("sm2-grid");

/** Default settings with one of the golden variations applied (a fresh object every time). */
export function settingsOf(config: string): StudioSettings {
    return { ...DEFAULT_SETTINGS, ...sm2Golden.configs[config] };
}

/** A new histogram holding a golden one (null: the call leaves the histogram out). */
export function histogramOf(name: string | null): DueDateHistogram | undefined {
    if (name === null) return undefined;
    return new DueDateHistogram(sm2Golden.histograms[name]);
}
