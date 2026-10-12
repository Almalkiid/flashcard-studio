import { BuriedCards } from "src/data/data-structures/card/buried-cards";
import { DEFAULT_SETTINGS } from "src/data/settings-model";
import { DEFAULT_DATA, PluginData } from "src/data/stored-data";
import { globalDateProvider, setupStaticDateProvider } from "src/utils/clock";
import { moment } from "src/utils/moment-en";

// P3-R6 (D2 #17): buried siblings stay hidden for the rest of the study day, so the list is cleared when the study day
// changes, not at midnight before a later day boundary.

function clockAt(at: string, startsAt4: boolean): void {
    setupStaticDateProvider("2023-09-06");
    Object.defineProperty(globalDateProvider, "now", {
        get: () => moment(at, "YYYY-MM-DD HH:mm"),
        configurable: true,
    });
    globalDateProvider.setDayBoundary(startsAt4 ? { hour: 4, minute: 0, second: 0 } : null);
}

function buriedOn(day: string): { list: BuriedCards; data: PluginData } {
    const data: PluginData = { ...DEFAULT_DATA, buryDate: day, buryList: ["abc"] };
    return { list: new BuriedCards(null, DEFAULT_SETTINGS, data.buryList), data };
}

test("at 01:00 with a day that starts at 04:00 it is still yesterday, so the list stays", async () => {
    clockAt("2023-09-07 01:00", true);
    const { list, data } = buriedOn("2023-09-06");
    await list.clearIfNewDay(data);
    expect(list.list).toEqual(["abc"]);
    expect(data.buryDate).toBe("2023-09-06");
});

test("once the study day turns the list is cleared and the day remembered", async () => {
    clockAt("2023-09-07 04:00", true);
    const { list, data } = buriedOn("2023-09-06");
    await list.clearIfNewDay(data);
    expect(list.list).toEqual([]);
    expect(data.buryDate).toBe("2023-09-07");
});

test("with a midnight boundary the list is cleared on the next date", async () => {
    clockAt("2023-09-07 00:00", false);
    const { list, data } = buriedOn("2023-09-06");
    await list.clearIfNewDay(data);
    expect(list.list).toEqual([]);
});
