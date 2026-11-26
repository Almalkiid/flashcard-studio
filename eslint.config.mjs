import js from "@eslint/js";
import obsidianmd from "eslint-plugin-obsidianmd";
import importSort from "eslint-plugin-simple-import-sort";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

// Messages for the patterns the Obsidian plugin review rejects in shipped code
const domAdvice = "Use alternative DOM manipulation methods instead.";
const shippedCodeSyntax = [
    {
        selector: "CallExpression[callee.property.name=/^insertAdjacent/]",
        message: `insertAdjacent methods are not allowed. ${domAdvice}`,
    },
    {
        selector: 'AssignmentExpression[left.property.name="innerHTML"]',
        message: `innerHTML assignment is not allowed. ${domAdvice}`,
    },
    {
        selector: 'NewExpression[callee.name="Function"]',
        message: "new Function() is a security risk. Use another approach.",
    },
    {
        selector: 'Identifier[name="document"]',
        message: "Use activeDocument instead of document, so pop-out windows work.",
    },
    {
        selector: 'AssignmentExpression[left.object.property.name="style"]',
        message:
            "Do not set element.style directly. Use a CSS class, or setCssProps for values that change at run time.",
    },
];

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    ...obsidianmd.configs.recommended,
    { languageOptions: { parserOptions: { projectService: true } } },
    {
        rules: {
            "obsidianmd/ui/sentence-case": [
                "warn",
                {
                    enforceCamelCaseLower: true,
                    // algorithm names, and "Repetition" from the term spaced repetition
                    ignoreWords: ["FSRS", "FSRS-6", "FSRS-7", "OSR", "SM-2", "Repetition"],
                    // ignoreWords skips the first word of a string, so those need a regex
                    ignoreRegex: ["^FSRS ", "^FSRS-[67]", "^SM-2"],
                },
            ],
        },
    },
    {
        plugins: { "simple-import-sort": importSort, unicorn },
        rules: {
            "linebreak-style": "off",
            quotes: ["warn", "double", "avoid-escape"],
            semi: ["error", "always"],
            camelcase: [
                "error",
                { allow: ["PrevDeckComplete_Sequential", "PrevDeckComplete_Random"] },
            ],
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
            "unicorn/filename-case": ["error", { case: "kebabCase" }],
            "simple-import-sort/imports": [
                "error",
                { groups: [["^"], ["^src"], ["^\\.", "^tests"]] },
            ],
        },
    },
    {
        files: ["src/**"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["./", "../"],
                            message: "Import from src/ with an absolute path, not a relative one.",
                        },
                        {
                            // FSRS-6 stays on ts-fsrs 5.4.2 (issue #27); only the FSRS-7 code may use ts-fsrs 6
                            group: ["ts-fsrs-6", "ts-fsrs-6/*"],
                            message:
                                "ts-fsrs 6 is for FSRS-7 only: import it under src/scheduling/fsrs7/.",
                        },
                    ],
                },
            ],
            "no-restricted-syntax": ["error", ...shippedCodeSyntax],
        },
    },
    {
        files: ["src/scheduling/fsrs7/**"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["./", "../"],
                            message: "Import from src/ with an absolute path, not a relative one.",
                        },
                    ],
                },
            ],
        },
    },
    {
        // WebdriverIO elements are promises at run time, which their types do not show
        files: ["tests/e2e/**"],
        rules: { "@typescript-eslint/await-thenable": "off" },
    },
    {
        // tests are not shipped, so the plugin review rules do not apply to them
        files: ["tests/**"],
        rules: {
            "@typescript-eslint/no-require-imports": "off",
            "no-undef": "off",
            "eslint-comments/require-description": "off",
            "eslint-comments/disable-enable-pair": "off",
            "obsidianmd/rule-custom-message": "off",
            "obsidianmd/no-nodejs-modules": "off",
            "obsidianmd/hardcoded-config-path": "off",
        },
    },
);
