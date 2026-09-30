import process from "process";
process.env.TZ = "UTC";

/** @type {import('@ts-jest/dist/types').InitialOptionsTsJest} */
export default {
    verbose: true,
    preset: "ts-jest",
    testEnvironment: "jsdom",
    setupFilesAfterEnv: ["jest-expect-message"],
    moduleNameMapper: {
        // Jest would load a .wasm import as an ES module; the bundle gets it as base64 text (see embedded-wasm.cjs)
        "^sql\\.js/dist/sql-wasm-browser\\.wasm$": "<rootDir>/tests/unit/helpers/embedded-wasm.cjs",
        "src/(.*)": "<rootDir>/src/$1",
    },
    moduleFileExtensions: ["js", "jsx", "ts", "tsx", "json", "node", "d.ts"],
    // ankipack (Anki import and export) is published as ES modules only, so Jest has to compile it. The pattern
    // also has to match pnpm's node_modules/.pnpm/ankipack@x/node_modules/ankipack layout.
    transform: { "node_modules/(\\.pnpm/)?ankipack.*/dist/.+\\.js$": "ts-jest" },
    transformIgnorePatterns: ["/node_modules/(?!(\\.pnpm/)?ankipack)"],
    roots: ["<rootDir>/src/", "<rootDir>/tests/unit/"],
    collectCoverageFrom: ["src/**"],
    coveragePathIgnorePatterns: [
        // node modules & build output
        "build/",
        "node_modules/",

        // GUI & Obsidian coupled code
        "src/data/core.ts",
        "src/data/data-structures/file/",
        "src/ui/",
        "src/icons/",
        "src/main.ts",
        "src/lang/locale-manager.ts",
        "src/command-manager.ts",
        "src/scheduling/reminder-manager.ts",
        "src/data/data-manager.ts",
        "src/data/debug-logger.ts",
        "src/data/plugin-data-manager.ts",
        "src/data/settings-manager.ts",
        "src/data/data-store/.*/.*-file-modifier.ts",
        "src/data/data-store/.*/.*file-modifier.ts",
        "src/note/next-note-review-handler.ts",
        "src/data/plugin-data.ts",
        "src/data/review-log/obsidian-log-adapter.ts",
        "src/data/review-log/device-id.ts",
        "src/utils/renderers.ts",
        "src/scheduling/algorithms/osr/obsidian-vault-notelink-info-finder.ts",
        "src/scheduling/algorithms/osr/serialized-schedule-data.ts",
        "src/scheduling/algorithms/fsrs/serialized-schedule-data.ts",
        "src/data/data-store/base/idata-store-algorithm.ts",

        // M4: Anki import and export. The dialogs and the vault adapter need a running Obsidian, the end-to-end tests
        // cover them
        "src/import-export/ui/",
        "src/import-export/obsidian-vault-host.ts",

        // Image occlusion: the editor, the picker and the wiring need a running Obsidian, the end-to-end tests cover
        // them. The geometry, the model and the block format are unit tested.
        "src/occlusion/occlusion-editor-modal.ts",
        "src/occlusion/image-suggest-modal.ts",
        "src/occlusion/occlusion-processors.ts",

        // debugging utils
        "src/utils/debug.ts",

        // don't include in results
        "src/declarations.d.ts",
        "src/lang/",
    ],
    coverageDirectory: "coverage",
    collectCoverage: true,
    coverageProvider: "v8",
    coverageThreshold: {
        global: {
            // TODO: Bring coverage back up to 98%+
            // TODO: Figure out why coverage on the GitHub runner
            // is lower than the local coverage
            statements: 92,
            branches: 88,
        },
    },
};
