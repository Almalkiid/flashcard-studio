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
                    ignoreWords: ["FSRS", "OSR", "SM-2", "Repetition"],
                    // ignoreWords skips the first word of a string, so those need a regex
                    ignoreRegex: ["^FSRS ", "^SM-2"],
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
                    ],
                },
            ],
            "no-restricted-syntax": ["error", ...shippedCodeSyntax],
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
