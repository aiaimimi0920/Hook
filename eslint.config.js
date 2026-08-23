// Flat ESLint config (ESLint 9). Scoped to the SolidJS + TS frontend under
// src/. Intentionally pragmatic: this codebase was written without a linter, so
// the rules here focus on catching real bugs (no-unused-vars as warnings,
// solid-specific reactivity foot-guns) rather than enforcing a style rewrite.
// `npm run lint` is a blocking gate: it runs with `--max-warnings 0` in
// `verify:local` and in the build-hook-exe workflow, so a new warning fails CI.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import solid from "eslint-plugin-solid";

export default tseslint.config(
    {
        ignores: [
            "node_modules/**",
            ".output/**",
            "dist/**",
            ".vinxi/**",
            ".runtime/**",
            "src-tauri/**",
            "__tests__/**",
            "*.config.js",
            "*.config.ts",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ["src/**/*.{ts,tsx}"],
        ...solid.configs["flat/typescript"],
    },
    {
        files: ["src/**/*.{ts,tsx}"],
        rules: {
            // Pragmatic: warn, don't error, on the common cleanup targets so the
            // lint pass is informative without blocking work on a large legacy
            // surface. Tighten to "error" once the counts are burned down.
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-non-null-assertion": "off",
            "no-empty": ["warn", { allowEmptyCatch: true }],
            // Legacy-surface rules demoted to warnings so the first lint pass is
            // uniformly informative and non-blocking. Tighten back to "error" as
            // these are burned down.
            "prefer-const": "warn",
            "no-case-declarations": "warn",
            "no-unused-expressions": "warn",
            "@typescript-eslint/no-unused-expressions": "warn",
            "@typescript-eslint/no-empty-object-type": "warn",
        },
    },
);
