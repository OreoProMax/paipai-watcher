# Project Guidelines

## Product Goal

- This repository is a userscript project for JD Paipai second-hand listings.
- Core behavior: auto-refresh listing data, detect low-price items by user-defined rules, and notify users through system notifications.
- Prioritize useful alerts over alert volume: reduce false positives and avoid notification spam.
- The target page HTML snapshot for selector and parser validation is `SourcePage.html`.

## Code Style

- Use TypeScript with strict typing and keep code compatible with the existing compiler options in tsconfig files.
- Follow the existing Vue Single File Component pattern with `script setup` and `lang="ts"`.
- Preserve local style conventions per file (for example, quote style differs between `src/*` and config files).
- Avoid introducing unused variables, parameters, or side-effect imports because strict checks are enabled.

## Architecture

- This repository builds a userscript with Vite and vite-plugin-monkey, not a traditional multi-page web app.
- Main build and userscript metadata live in `vite.config.ts` under the monkey plugin options.
- Runtime entry is `src/main.ts`, which mounts Vue by creating and appending a container element to `document.body`.
- UI composition starts at `src/App.vue`; shared base styles are in `src/style.css`.
- External globals for Vue and Element Plus are configured through CDN in `vite.config.ts`.
- Keep feature logic layered where practical:
  - data collection/parsing (extract normalized item data)
  - rule evaluation (price and filter decisions)
  - notification dispatch (user-facing alerts)
  - refresh scheduling and state cache (polling cadence and dedup)
- Keep scraping logic and rule logic decoupled so rule changes do not require selector rewrites.

## Build And Test

- Install dependencies: `npm install` (or `npm ci` in clean CI environments).
- Start development mode: `npm run dev`.
- Validate and build: `npm run build` (runs `vue-tsc -b` before `vite build`).
- Preview built output: `npm run preview`.
- There is currently no dedicated `test` or `lint` script, so `npm run build` is the primary quality gate.

## Conventions

- When changing userscript metadata (name, match, updateURL, downloadURL), keep output filenames and release URLs consistent.
- Keep domain targeting tight and explicit in userscript `match` rules unless a requirement says otherwise.
- Do not assume an `index.html` app root; this project injects a mount node at runtime.
- For target-page parsing:
  - validate selectors against `SourcePage.html`
  - avoid brittle selectors that rely only on transient generated class names
  - prefer stable anchors (URL patterns, semantic text, structured attributes) when available
- For refresh and alerts:
  - make refresh interval configurable and conservative by default
  - deduplicate notifications by stable item identity (for example item id/link) plus cooldown
  - avoid repeated notifications for the same item unless key fields change (for example price drop)
  - handle notification permission denial gracefully without breaking monitoring flow
- Prefer `GM_notification` when available in userscript runtime, with browser Notification fallback if needed.
- For vite-plugin-monkey and GM API behavior details, link to existing project docs instead of duplicating content:
  - `README.md`
  - `DEVELOPER.md`
