// Unit tests run in jsdom with a fixed time zone, so date maths gives the same result everywhere.
process.env.TZ = "UTC";

const helpers = "<rootDir>/tests/unit/helpers";

// Code that needs a running Obsidian (or a real vault) is covered by the end-to-end tests, so it is
// left out of the unit coverage figures.
const needsObsidian = [
    "src/studio-plugin.ts",
    "src/commands/",
    "src/ui/",
    "src/icons/",
    "src/data/data-structures/file/",
    "src/data/data-store/.*/.*file-modifier.ts",
    "src/data/review-log/obsidian-log-adapter.ts",
    "src/data/review-log/device-id.ts",
    "src/import-export/ui/",
    "src/import-export/obsidian-vault-host.ts",
    "src/ai/generate-cards-modal.ts",
    "src/ai/note-picker-modal.ts",
    "src/ai/open-generate-cards.ts",
    "src/exam/exam-render.ts",
    "src/exam/exam-resume.ts",
    "src/exam/exam-results-view.ts",
    "src/exam/exam-run.ts",
    "src/exam/exam-setup-modal.ts",
    "src/exam/exam-store.ts",
    "src/exam/exam-view.ts",
    "src/occlusion/occlusion-editor-modal.ts",
    "src/occlusion/image-suggest-modal.ts",
    "src/occlusion/occlusion-processors.ts",
];

export default {
    preset: "ts-jest",
    testEnvironment: "jsdom",
    verbose: true,
    roots: ["<rootDir>/src/", "<rootDir>/tests/unit/"],
    moduleFileExtensions: ["js", "jsx", "ts", "tsx", "json", "node", "d.ts"],
    setupFilesAfterEnv: ["jest-expect-message"],
    moduleNameMapper: {
        "^obsidian$": "<rootDir>/tests/unit/support/obsidian.js",
        "\\.css$": `${helpers}/style-stub.cjs`,
        // the bundle receives a .wasm import as base64 text, so the tests do too
        "^sql\\.js/dist/sql-wasm-browser\\.wasm$": `${helpers}/embedded-wasm.cjs`,
        "src/(.*)": "<rootDir>/src/$1",
    },
    // ankipack ships ES modules only. The pattern covers pnpm's node_modules/.pnpm/ankipack@x/ layout too.
    transform: { "node_modules/(\\.pnpm/)?ankipack.*/dist/.+\\.js$": "ts-jest" },
    transformIgnorePatterns: ["/node_modules/(?!(\\.pnpm/)?ankipack)"],
    collectCoverage: true,
    coverageProvider: "v8",
    coverageDirectory: "coverage",
    collectCoverageFrom: ["src/**"],
    coveragePathIgnorePatterns: [
        "build/",
        "node_modules/",
        ...needsObsidian,
        "src/wasm-module.d.ts",
        "src/lang/",
    ],
    coverageThreshold: { global: { statements: 92, branches: 88 } },
};
