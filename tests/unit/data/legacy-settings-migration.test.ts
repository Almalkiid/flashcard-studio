import { importLegacySettings } from "src/data/legacy-settings-migration";
import { cloneDefaultSettings, StudioSettings } from "src/data/settings-model";
import { reapplySettings } from "src/settings/effect-host";
import type FlashcardStudioPlugin from "src/studio-plugin";

jest.mock("src/settings/effect-host", () => ({ reapplySettings: jest.fn() }));

function pluginWith(legacy: unknown, settings: StudioSettings = cloneDefaultSettings()) {
    const order: string[] = [];
    (reapplySettings as jest.Mock).mockImplementation(() => order.push("effects"));
    const plugin = {
        app: {
            vault: {
                configDir: ".obsidian",
                adapter: {
                    exists: () => Promise.resolve(true),
                    read: () => Promise.resolve(JSON.stringify(legacy)),
                },
            },
        },
        dataManager: {
            settingsManager: {
                settings,
                save: () => {
                    order.push("save");
                    return Promise.resolve();
                },
            },
        },
    };
    return { plugin: plugin as unknown as FlashcardStudioPlugin, settings, order };
}

test("imported settings are saved first, then their effects are redone", async () => {
    const { plugin, settings, order } = pluginWith({ settings: { baseEase: 300 } });
    expect(await importLegacySettings(plugin)).toBe(1);
    expect(settings.baseEase).toBe(300);
    expect(order).toEqual(["save", "effects"]);
});

test("a value the settings screen would refuse is not imported", async () => {
    const { plugin, settings } = pluginWith({ settings: { baseEase: 5, startOfDay: "4:00" } });
    expect(await importLegacySettings(plugin)).toBe(1);
    expect(settings.baseEase).toBe(250);
    expect(settings.startOfDay).toBe("04:00:00");
});

test("the imported settings are brought up to date like saved ones: an unusable value takes its default", async () => {
    const { plugin, settings } = pluginWith({ settings: { scheduleDataVaultLocation: "  " } });
    settings.scheduleDataVaultLocation = "keep";
    await importLegacySettings(plugin);
    expect(typeof settings.scheduleDataVaultLocation).toBe("string");
});
