import { DataManager } from "src/data/data-hub";
import { BuriedCards } from "src/data/data-structures/card/buried-cards";
import { DEFAULT_SETTINGS } from "src/data/settings-model";
import { DEFAULT_DATA, PluginData } from "src/data/stored-data";
import { globalDateProvider, setupStaticDateProvider } from "src/utils/clock";
import { moment } from "src/utils/moment-en";

// Buried siblings come back once the study day turns, also while the app stays open: every sync (each queue load
// starts with one) clears the buried-cards list on a new study day, before the deck hierarchies are filtered with it.

// The sync times itself with Obsidian's moment
(window as unknown as { moment: typeof moment }).moment = moment;

function clockAt(at: string): void {
    setupStaticDateProvider("2023-09-06");
    Object.defineProperty(globalDateProvider, "now", {
        get: () => moment(at, "YYYY-MM-DD HH:mm"),
        configurable: true,
    });
    globalDateProvider.setDayBoundary({ hour: 4, minute: 0, second: 0 });
}

function managerWithBuriedSiblings(): { manager: DataManager; list: BuriedCards } {
    const data: PluginData = { ...DEFAULT_DATA, buryDate: "2023-09-06", buryList: ["abc"] };
    const list = new BuriedCards(null, DEFAULT_SETTINGS, data.buryList);
    const plugin = { getObsidianRtlSetting: () => 0 };
    const manager = new DataManager(
        plugin as never,
        { pluginData: data } as never,
        { settings: DEFAULT_SETTINGS } as never,
    );
    manager.vaultIndex = { buriedCards: list } as never;
    return { manager, list };
}

test("a session open across 04:00 gets the buried siblings back at the next queue load", async () => {
    const { manager, list } = managerWithBuriedSiblings();
    const filteredWith: number[] = [];
    jest.spyOn(manager, "loadVault").mockImplementation(async () => {
        filteredWith.push(list.list.length);
    });

    clockAt("2023-09-07 03:59");
    await manager.sync();
    expect(list.list).toEqual(["abc"]);

    clockAt("2023-09-07 04:01");
    await manager.sync();
    expect(list.list).toEqual([]);
    // Cleared before the trees are built, so the rebuilt queue already has the siblings
    expect(filteredWith).toEqual([1, 0]);
});
