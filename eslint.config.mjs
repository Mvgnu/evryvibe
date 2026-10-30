import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: { "@typescript-eslint/no-explicit-any": "error" } },
  {
    // maplibre-gl 5.24.0 (pinned by itstiles.com) has GHSA-jrc7-96c5-q579: its
    // attribution sanitizer can be bypassed. Attribution strings must stay
    // first-party constants, and map popups are React, never raw HTML.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='setHTML']",
          message:
            "Popup.setHTML inserts unsanitized HTML. Render map overlays with React.",
        },
        {
          selector: "Property[key.name='customAttribution']",
          message:
            "Map attribution HTML is only safe as a first-party constant on a source (GHSA-jrc7-96c5-q579).",
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "next-env.d.ts",
    "test-results/**",
    "playwright-report/**",
    ".local/**",
  ]),
]);
