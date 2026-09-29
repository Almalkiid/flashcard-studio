import eslint from "@eslint/js";
import obsidianmd from "eslint-plugin-obsidianmd";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    ...obsidianmd.configs.recommended,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
            },
        },
    },
    {
        rules: {
            "obsidianmd/ui/sentence-case": [
                "warn",
                {
                    enforceCamelCaseLower: true,
                    // FSRS and OSR are scheduling algorithm acronyms; "Repetition" is part of the plugin name
                    ignoreWords: ["FSRS", "OSR", "Repetition"],
                    // ignoreWords does not apply to the first word of a string
                    ignoreRegex: ["^FSRS "],
                },
            ],
        },
    },
    {
        plugins: {
            "simple-import-sort": simpleImportSort,
            unicorn: eslintPluginUnicorn,
        },
        rules: {
            "linebreak-style": 0,
            quotes: ["warn", "double", "avoid-escape"],
            semi: ["error", "always"],
            camelcase: [
                "error",
                { allow: ["PrevDeckComplete_Sequential", "PrevDeckComplete_Random"] },
            ],
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                },
            ],
            "unicorn/filename-case": [
                "error",
                {
                    case: "kebabCase",
                },
            ],
            "simple-import-sort/imports": [
                "error",
                {
                    groups: [["^"], ["^src"], ["^\\.", "^tests"]],
                },
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
                            message: "Relative imports are not allowed in src/.",
                        },
                    ],
                },
            ],
            "no-restricted-syntax": [
                "error",
                {
                    selector: "CallExpression[callee.property.name=/^insertAdjacent/]",
                    message:
                        "insertAdjacent methods are not allowed. Use alternative DOM manipulation methods instead.",
                },
                {
                    selector: 'AssignmentExpression[left.property.name="innerHTML"]',
                    message:
                        "innerHTML assignment is not allowed. Use alternative DOM manipulation methods instead.",
                },
                {
                    selector: 'NewExpression[callee.name="Function"]',
                    message:
                        "new Function() is not allowed due to security risks. Use alternative approaches instead.",
                },
                {
                    selector: 'Identifier[name="document"]',
                    message: "Use activeDocument instead of document.",
                },
                {
                    selector: 'AssignmentExpression[left.object.property.name="style"]',
                    message:
                        "Avoid setting styles directly via element.style. Use CSS classes for better theming and maintainability. Use the setCssProps function if the CSS properties need to change dynamically.",
                },
            ],
        },
    },
    {
        files: ["tests/**"],
        rules: {
            "@typescript-eslint/no-require-imports": "off",
            // Tests are not shipped with the plugin (the community directory scan ignores them)
            "no-undef": "off",
            "eslint-comments/require-description": "off",
            "eslint-comments/disable-enable-pair": "off",
            "obsidianmd/rule-custom-message": "off",
            "obsidianmd/no-nodejs-modules": "off",
            "obsidianmd/hardcoded-config-path": "off",
        },
    },
);
