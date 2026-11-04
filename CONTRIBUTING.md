# Contributing to HopeCorePlayer

Thanks for helping! Bug reports, docs fixes, tests and features are all welcome. Issues and pull requests can be written in **English or Turkish**.

## Before you start

- **Bugs:** open an issue with the [bug report template](https://github.com/umutyaldiz/hopecoreplayer/issues/new?template=bug_report.yml). A minimal `player.options` object, the browser / device and the player version make a fix much faster.
- **Features:** open a [feature request](https://github.com/umutyaldiz/hopecoreplayer/issues/new?template=feature_request.yml) first, so we can agree on the option names and defaults before you write code. New features ship **off by default**.
- **Security issues:** do not open a public issue — see [SECURITY.md](./SECURITY.md).

## Setup

Requirements: Node.js 24, npm.

```bash
git clone https://github.com/umutyaldiz/hopecoreplayer.git
cd hopecoreplayer
npm install
npx playwright install chromium webkit
npm run build:core
npm run dev            # playground on http://localhost:5183
```

The playground (`apps/playground`) loads the **built** core (`packages/core/dist`), so run `npm run build:core` (or `npm run dev --workspace=packages/core` for watch mode) after changing core code.

## Project layout

| Path | What |
|---|---|
| `packages/core` | The `<hope-player>` custom element. Plugins live in `src/plugins/*` and are loaded with dynamic `import()` only when their option is set. |
| `packages/react`, `packages/vue` | Thin wrappers: props → `.options`, `hp:*` events → callbacks / emits. |
| `packages/react-native` | WebView bridge. |
| `apps/playground` | Dev page + Playwright end-to-end tests (`test/*.e2e.mjs`). Test scenarios are selected with query strings, e.g. `?feature=cast`. |
| `examples/*` | StackBlitz / Expo examples using the published packages. |

## Making changes

- **TypeScript, strict.** Run `npm run typecheck` before pushing.
- **Options** are declared in `packages/core/src/types/index.ts` with a doc comment (what it does, the default). Wrappers pick new options up automatically; new **events** need a line in the React and Vue wrappers.
- **UI text** goes through i18n (`packages/core/src/i18n`) — add the key to `types.ts`, `locales/tr.ts` and `locales/en.ts`.
- **Styles** live in `packages/core/src/theme/tailwind.css` and use the `--hp-*` theme tokens, so presets and brand colors keep working.
- **Untrusted data** (API responses, titles, URLs) is rendered with `textContent`, never `innerHTML`; URLs are limited to `http(s)`.
- **Bundle size:** keep plugin code out of the main chunk — import it dynamically from `HopePlayerElement`. `npm run size --workspace=packages/core` (also in CI) fails when the first-load code exceeds its budget.
- **Accessibility:** controls need an accessible name that contains their visible text, a visible `:focus-visible` style and keyboard operation; `npm run test:a11y` scans the player with axe-core.
- **Backward compatibility:** don't rename or remove options or change defaults in a minor release; see the versioning policy in [CHANGELOG.md](./CHANGELOG.md).

## Tests

Every change needs a test. The suite is plain Playwright scripts against the playground:

```bash
npm run dev            # in one terminal
npm test               # in another — the full suite
npm run test:cast      # or a single area (see package.json "scripts")
```

To add a test, add a scenario to `apps/playground/src/main.ts` (a `?feature=...` branch) and a function to the matching `apps/playground/test/*.e2e.mjs` file. External services (IMA, Prebid, GPT, Cast SDK) are mocked in the tests — never depend on the real network.

## Pull requests

- One topic per pull request, with a short description of the problem and the fix.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(cast): …`, `fix(ads): …`, `docs: …`).
- Add a line under **[Unreleased]** in [CHANGELOG.md](./CHANGELOG.md).
- CI (build, typecheck, end-to-end tests) must pass.

By contributing you agree that your contributions are licensed under the [MIT License](./LICENSE) and that you follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
