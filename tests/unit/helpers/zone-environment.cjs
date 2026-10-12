// A jsdom test environment that runs a test file in another time zone, for the few tests that need daylight saving.
// jest.config.js forces TZ=UTC for every other test, and a test file cannot change the zone itself (its process.env
// is a copy). An environment is built in the worker process, so setting TZ here is seen by Date and moment. Jest reuses
// the worker for other test files, so teardown (and a failed start) puts the old zone back.
//
// Use it with this docblock at the top of the test file:
//   @jest-environment ./tests/unit/helpers/zone-environment.cjs
//   @jest-environment-options {"tz": "America/New_York"}
const { TestEnvironment } = require("jest-environment-jsdom");

class ZoneEnvironment extends TestEnvironment {
    /** @param {ConstructorParameters<typeof TestEnvironment>} args */
    constructor(...args) {
        const [config, ...rest] = args;
        const { tz, ...options } = config.projectConfig.testEnvironmentOptions;
        if (typeof tz !== "string") {
            throw new Error(
                'zone-environment needs a zone: @jest-environment-options {"tz": "Zone/Name"}',
            );
        }
        new Intl.DateTimeFormat("en", { timeZone: tz }); // throws RangeError for a zone that does not exist

        const before = process.env.TZ;
        process.env.TZ = tz;
        try {
            super(
                {
                    ...config,
                    projectConfig: { ...config.projectConfig, testEnvironmentOptions: options },
                },
                ...rest,
            );
        } catch (error) {
            restoreZone(before);
            throw error;
        }
        this.zoneBefore = before;
    }

    async teardown() {
        try {
            await super.teardown();
        } finally {
            restoreZone(this.zoneBefore);
        }
    }
}

/** @param {string | undefined} before */
function restoreZone(before) {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
}

module.exports = ZoneEnvironment;
