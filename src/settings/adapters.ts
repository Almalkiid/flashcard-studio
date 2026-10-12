import { normalizeCalloutTypes } from "src/data/data-structures/card/questions/callout-card";
import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import {
    formatFsrsSteps,
    formatFsrsWeights,
    parseFsrsSteps,
    parseFsrsWeights,
} from "src/scheduling/fsrs/fsrs-settings";
import { normalizeStartOfDay, normalizeVaultFolder, parseTagList } from "src/settings/validators";
import { desktopTabWanted } from "src/ui/obsidian-ui-components/content-container/desktop/desktop-shell";

export type StoredKey = keyof StudioSettings;

export interface SettingsEnv {
    /** A phone or tablet, or Obsidian emulating one. */
    isMobile: boolean;
}

interface Adapter {
    /** Every stored key this control can write, on any device. */
    covers: StoredKey[];
    read(settings: StudioSettings, env: SettingsEnv): unknown;
    /** Stores the value and returns the stored keys it wrote. */
    write(settings: StudioSettings, value: unknown, env: SettingsEnv): StoredKey[];
}

type Bag = Record<string, unknown>;
const bag = (settings: StudioSettings) => settings as unknown as Bag;

function set(settings: StudioSettings, key: StoredKey, value: unknown): StoredKey[] {
    bag(settings)[key] = value;
    return [key];
}

/** One control that writes the computer's key on a computer and the phone's key on a phone. */
function perDevice(desktop: StoredKey, mobile: StoredKey): Adapter {
    const pick = (env: SettingsEnv) => (env.isMobile ? mobile : desktop);
    return {
        covers: [desktop, mobile],
        read: (s, env) => bag(s)[pick(env)],
        write: (s, value, env) => set(s, pick(env), value),
    };
}

/** Shown as a percent with up to `decimals` digits after the point (none by default), stored as a fraction. */
function percent(key: StoredKey, decimals = 0): Adapter {
    const scale = 10 ** decimals;
    return {
        covers: [key],
        read: (s) => Math.round((bag(s)[key] as number) * 100 * scale) / scale,
        // Rounded so that a percent such as 90.55 is stored as 0.9055, not as the nearest binary fraction to it
        write: (s, value) => set(s, key, Number(((value as number) / 100).toFixed(decimals + 2))),
    };
}

function tagList(key: StoredKey): Adapter {
    return {
        covers: [key],
        read: (s) => (bag(s)[key] as string[]).filter((tag) => tag.length > 0).join(" "),
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- String() is the correct way to convert unknown to string
        write: (s, value) => set(s, key, parseTagList(String(value))),
    };
}

function text(key: StoredKey, normalize: (value: string) => string): Adapter {
    return {
        covers: [key],
        read: (s) => bag(s)[key],
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- String() is the correct way to convert unknown to string
        write: (s, value) => set(s, key, normalize(String(value))),
    };
}

const ADAPTERS: Record<string, Adapter> = {
    openInTab: perDevice("openViewInNewTab", "openViewInNewTabMobile"),
    windowHeight: perDevice("flashcardHeightPercentage", "flashcardHeightPercentageMobile"),
    windowWidth: perDevice("flashcardWidthPercentage", "flashcardWidthPercentageMobile"),
    fsrsDesiredRetention: percent("fsrsDesiredRetention", 2),
    maxLinkFactor: percent("maxLinkFactor"),
    lapsesIntervalChange: percent("lapsesIntervalChange"),
    easyBonus: percent("easyBonus"),
    flashcardTags: tagList("flashcardTags"),
    flashcardTagsToIgnore: tagList("flashcardTagsToIgnore"),
    tagsToReview: tagList("tagsToReview"),
    noteTagsToIgnore: tagList("noteTagsToIgnore"),
    calloutCardTypes: {
        covers: ["calloutCardTypes"],
        read: (s) => s.calloutCardTypes.join(", "),
        write: (s, value) =>
            // eslint-disable-next-line @typescript-eslint/no-base-to-string -- String() is the correct way to convert unknown to string
            set(s, "calloutCardTypes", normalizeCalloutTypes(String(value).split(/[\s,]+/))),
    },
    startOfDay: text("startOfDay", normalizeStartOfDay),
    fsrsLearningSteps: text("fsrsLearningSteps", (v) => formatFsrsSteps(parseFsrsSteps(v) ?? [])),
    fsrsRelearningSteps: text("fsrsRelearningSteps", (v) =>
        formatFsrsSteps(parseFsrsSteps(v) ?? []),
    ),
    fsrsWeights: {
        covers: ["fsrsWeights"],
        read: (s) => s.fsrsWeights,
        write: (s, value) => {
            const steps = (parseFsrsSteps(s.fsrsRelearningSteps) ?? []).length;
            // eslint-disable-next-line @typescript-eslint/no-base-to-string -- String() is the correct way to convert unknown to string
            const { weights } = parseFsrsWeights(String(value), steps);
            return set(s, "fsrsWeights", weights === null ? "" : formatFsrsWeights(weights));
        },
    },
    reviewLogFolder: text("reviewLogFolder", (v) =>
        normalizeVaultFolder(v, DEFAULT_SETTINGS.reviewLogFolder),
    ),
    aiModel: text("aiModel", (v) => v.trim()),
    aiBaseUrl: text("aiBaseUrl", (v) => v.trim()),
    learnerName: text("learnerName", (v) => v.trim()),
};

export function readControl(settings: StudioSettings, key: string, env: SettingsEnv): unknown {
    const adapter = ADAPTERS[key];
    return adapter === undefined ? bag(settings)[key] : adapter.read(settings, env);
}

export function writeControl(
    settings: StudioSettings,
    key: string,
    value: unknown,
    env: SettingsEnv,
): StoredKey[] {
    const adapter = ADAPTERS[key];
    return adapter === undefined
        ? set(settings, key as StoredKey, value)
        : adapter.write(settings, value, env);
}

/**
 * Whether the review opens in a tab: this device's tab key is on, or the desktop layout opens it as a full tab.
 * The one place that says so; call it where the settings are as they are then, never with values captured earlier.
 */
export function reviewOpensInTab(settings: StudioSettings, env: SettingsEnv): boolean {
    return (
        readControl(settings, "openInTab", env) === true || desktopTabWanted(settings, env.isMobile)
    );
}

export function storedKeysOf(key: string): StoredKey[] {
    return ADAPTERS[key]?.covers ?? [key as StoredKey];
}
