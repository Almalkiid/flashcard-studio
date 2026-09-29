/* eslint-disable getter-return */

module.exports = {
    // Obsidian ships moment to plugins; the real package stands in for it in tests.
    moment: require("moment"),
    PluginSettingTab: jest.fn().mockImplementation(),
    Platform: {
        get isMobile() {
            jest.fn(() => false);
        },
    },

    Notice: jest.fn().mockImplementation(),
};
