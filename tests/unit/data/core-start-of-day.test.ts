import { DEFAULT_SETTINGS, StudioSettings } from "src/data/settings-model";
import { globalDateProvider, setupStaticDateProvider20230906 } from "src/utils/clock";

import { UnitTestVaultIndex } from "../support/vault-index";

// UnitTestVaultIndex builds an VaultIndex and then runs initUnitTestCore, so both places that read the setting run here.
function boundaryAfterStarting(startOfDay: unknown) {
    setupStaticDateProvider20230906();
    const settings = { ...DEFAULT_SETTINGS, startOfDay } as unknown as StudioSettings;
    new UnitTestVaultIndex(settings);
    return globalDateProvider.getDayBoundary();
}

describe("VaultIndex reads the start of the day from the settings", () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
        warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        warn.mockRestore();
        setupStaticDateProvider20230906();
    });

    test.each([
        ["04:00:00", { hour: 4, minute: 0, second: 0 }],
        ["00:00:00", { hour: 0, minute: 0, second: 0 }],
        ["23:59:59", { hour: 23, minute: 59, second: 59 }],
        // text older versions saved
        ["4:0:0", { hour: 4, minute: 0, second: 0 }],
        ["04:0:0", { hour: 4, minute: 0, second: 0 }],
        ["4:30:5", { hour: 4, minute: 30, second: 5 }],
    ])("%j sets the day boundary", (text, expected) => {
        expect(boundaryAfterStarting(text)).toEqual(expected);
        expect(warn).not.toHaveBeenCalled();
    });

    test.each(["", "garbage", "24:00:00", "0x10:00:00", "4.5:00:00"])(
        "%j warns and leaves the boundary unset",
        (text) => {
            expect(boundaryAfterStarting(text)).toBeNull();
            expect(warn).toHaveBeenCalled();
        },
    );

    test.each([null, undefined, 4, {}])(
        "a setting that is not text (%p) warns and leaves the boundary unset instead of throwing",
        (value) => {
            expect(boundaryAfterStarting(value)).toBeNull();
            expect(warn).toHaveBeenCalledTimes(2); // the constructor and initUnitTestCore
        },
    );
});
