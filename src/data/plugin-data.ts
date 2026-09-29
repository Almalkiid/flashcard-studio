import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { SRAlgorithmType } from "src/scheduling/algorithms/base/isr-algorithm";
import { ISerializedFSRSScheduleData } from "src/scheduling/algorithms/fsrs/serialized-schedule-data";
import { ISerializedSM2ScheduleData } from "src/scheduling/algorithms/osr/serialized-schedule-data";

export interface ISerializedScheduleEntry {
    algorithm: SRAlgorithmType;
    scheduleData: ISerializedFSRSScheduleData | ISerializedSM2ScheduleData;
}

/**
 * Represents the schedule data stored in the plugin data.
 *
 * @interface ISerializedScheduleData
 */
export interface ISerializedScheduleData {
    version: number;
    noteSchedules: Record<string, ISerializedScheduleEntry | null>;
    cardSchedules: Record<string, (ISerializedScheduleEntry | null)[]>;
}

export interface PluginData {
    settings: SRSettings;
    buryDate: string;
    // hashes of card texts
    // should work as long as user doesn't modify card's text
    // which covers most of the cases
    buryList: string[];
    historyDeck: string | null;
    scheduleData: ISerializedScheduleData;
    // M3a: scheduling
    limitOverride: LimitOverride;
}

/**
 * Custom study's "increase today's limit": extra new cards and reviews allowed on one day. It only counts while
 * `date` (`YYYY-MM-DD`, after the day boundary) is today, so it resets by itself the next day.
 */
export interface LimitOverride {
    date: string;
    extraNew: number;
    extraReviews: number;
}

export const DEFAULT_DATA: PluginData = {
    settings: DEFAULT_SETTINGS,
    buryDate: "",
    buryList: [],
    historyDeck: null,
    scheduleData: {
        version: 1,
        noteSchedules: {},
        cardSchedules: {},
    },
    // M3a: scheduling
    limitOverride: { date: "", extraNew: 0, extraReviews: 0 },
};
