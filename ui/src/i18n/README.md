# UI localization

Paperclip uses two complementary localization paths:

1. New and frequently edited UI should use keyed `i18next` messages from
   `locales/en.json` and `locales/zh-CN.json`.
2. Existing literal-heavy screens are covered by `LegacyLiteralLocalizer` and
   the source-to-Chinese catalog in `legacy-zh-CN.json`. This keeps the whole UI
   localized while those screens migrate incrementally to keyed messages.

The legacy localizer only replaces exact phrases discovered in source. It also
supports numbered `{{value1}}` templates for dynamic labels. It deliberately
skips Markdown, code, editable content, and elements marked `data-i18n-skip` so
user-authored text is never translated.

## Updating copy

Run `node scripts/audit-ui-i18n.mjs` from the repository root to locate source
literals (add `--json` for machine-readable output). Add normal product copy to the
keyed locale files when practical. Otherwise add the English source phrase and
its Chinese translation to `legacy-zh-CN.json`. Put deliberate terminology
corrections in `legacy-zh-CN.overrides.json`; overrides win over generated or
bulk-imported legacy entries.

The build transform (`ui/vite-static-i18n.ts`) only wraps JSX text, the
translatable JSX attributes, literals rendered directly in JSX expressions, and
user-feedback calls. It never rewrites object properties or parameter defaults
(for example `{ label: "Recent Runs" }` passed to a tab bar), because those
values are often compared in code or sent to the API. Translate such labels
where they are defined or rendered with `t()` or `translateUiLiteral()`.

Before committing, run from the repository root:

```sh
node scripts/audit-ui-i18n.mjs --check
pnpm --filter @paperclipai/ui typecheck
pnpm --filter @paperclipai/ui build
```

`--check` scans production TypeScript/TSX files, fails on uncovered phrases that
the build transform or an explicit `translateUiLiteral()` call renders, and
verifies that dynamic placeholders are preserved exactly.
