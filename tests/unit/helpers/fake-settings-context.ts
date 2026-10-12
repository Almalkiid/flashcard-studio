import type { App } from "obsidian";

import { cloneDefaultSettings, StudioSettings } from "src/data/settings-model";
import type { StoredKey } from "src/settings/adapters";
import type { SettingsContext } from "src/settings/context";
import type FlashcardStudioPlugin from "src/studio-plugin";

/**
 * A settings context whose methods are all mocks, for testing group builders and helpers on their own.
 * `overrides` replace any member (for example `env: { isMobile: true }` or a plugin double); `mocks` always holds the
 * default mocks, so after overriding a method, assert on your own replacement.
 */
export function fakeContext(
    settings: StudioSettings = cloneDefaultSettings(),
    overrides: Partial<SettingsContext> = {},
) {
    const mocks = {
        commit: jest.fn<Promise<void>, [StoredKey[]]>(() => Promise.resolve()),
        rebuild: jest.fn<void, []>(),
        refresh: jest.fn<void, []>(),
        watch: jest.fn<() => void, [StoredKey[], () => void]>(() => () => undefined),
        confirm: jest.fn<void, Parameters<SettingsContext["confirm"]>>(),
    };
    const ctx: SettingsContext = {
        settings,
        env: { isMobile: false },
        app: {} as App,
        plugin: {} as FlashcardStudioPlugin,
        ...mocks,
        ...overrides,
    };
    return { ctx, settings: ctx.settings, mocks };
}
