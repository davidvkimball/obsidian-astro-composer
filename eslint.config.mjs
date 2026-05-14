// eslint.config.mjs
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
  {
    ignores: ["main.js", "node_modules/**", "dist/**", "*.js", "scripts/**", ".ref/**"]
  },
  // obsidianmd recommended rules require type info, so only apply to TS files
  ...obsidianmd.configs.recommended.map((config) => ({
    ...config,
    files: config.files ?? ["**/*.ts"],
  })),
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { 
        project: "./tsconfig.json",
        sourceType: "module"
      },
      globals: {
        ...globals.browser,
        DomElementInfo: "readonly",
        SvgElementInfo: "readonly",
        activeDocument: "readonly",
        activeWindow: "readonly",
        ajax: "readonly",
        ajaxPromise: "readonly",
        createDiv: "readonly",
        createEl: "readonly",
        createFragment: "readonly",
        createSpan: "readonly",
        createSvg: "readonly",
        fish: "readonly",
        fishAll: "readonly",
        isBoolean: "readonly",
        nextFrame: "readonly",
        ready: "readonly",
        sleep: "readonly"
      }
    },
    // Custom rule overrides
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-empty-function": "off",
      "no-prototype-builtins": "off",
      "@typescript-eslint/no-misused-promises": ["error",{"checksVoidReturn":{"attributes":false,"properties":false,"returns":false,"variables":false}}],
      // Disable sample code rules for template repository
      // These are intentional placeholder names and sample code that users should customize
      "obsidianmd/sample-names": "off",
      "obsidianmd/no-sample-code": "off",
      // Console rules: Match Obsidian bot requirements (only warn/error/debug allowed)
      "no-console": ["error", { "allow": ["warn", "error", "debug"] }],
      // Require await in async functions (matches Obsidian bot)
      "@typescript-eslint/require-await": "error",
      // Allow project-specific acronyms, third-party brand names, and option
      // labels that legitimately appear with title-case in UI text.
      "obsidianmd/ui/sentence-case": ["error", {
        acronyms: ["MDX", "URL", "ID", "JSON", "CSS"],
        brands: ["Obsidian", "Astro", "PowerShell", "iTerm", "Markdown", "Alacritty", "Git"],
        // Date format tokens (YYYY-MM-DD, HH:MM) plus dropdown labels that
        // legitimately keep title-case in their UI context.
        ignoreRegex: ["\\b(YYYY|MM|DD|HH|MMMM)\\b", "'[A-Z][a-z]+'"],
      }],
      // Allow the small set of Node.js modules required for the terminal-launch
      // feature, which is guarded by Platform.isDesktop/isWin/isMacOS/isLinux at
      // runtime. Mobile builds skip the code paths that touch these modules.
      // Configuring the rule with allow is preferred over per-line disables,
      // which the scorecard does not permit.
      "import/no-nodejs-modules": ["error", {
        allow: ["os", "child_process", "fs", "path"],
      }],
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly"
      }
    }
  },
]);
