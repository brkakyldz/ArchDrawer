# Independent held-out suite

Author history: the suite was first written by Codex as an independent acceptance
author, then revised by Claude in separate contexts, and on 2026-10-20 trimmed and
re-mapped to the current requirements by Claude Sonnet 5.5 (`claude-sonnet-5-5`).

The suite holds 33 Playwright acceptance journeys, written from the product
contracts and never from product code. Each title reads
`H<nn> [REQUIREMENT IDS] journey`; the ids are the requirements of the product
spec that the journey observes.

## Contents

- `H15`–`H44`, `H63`, `H64` `*.spec.ts` (29 journeys): the command line, the editor,
  saving and file conflicts, the instruction box and AI panel, views, sharing,
  security and the plugin manifests.
- `H84`–`H87` `*.spec.ts` (4 outcome journeys): what the layout promises — no
  overlapping parts, no connection through a part or a group name, no silently cut
  text, a layout report that matches the drawn lines, and an editor and an
  exported image that agree on part sizes and connection paths.
- `helpers.ts`, `helpers-svg-parity.ts`: shared, test-owned helpers (files, the
  command line, the editor, the share dialog, image measurement).
- `verify.json`: the selected ids and the pass thresholds (runs 3, perScenario 2,
  overall 0.9).
- `playwright.config.ts`: harness configuration. It assumes the suite sits in
  `tests/acceptance/holdout/` of an installed archdrawer checkout.
- `COVERAGE.md`: the scenario list, the requirement-to-scenario map and what is
  not covered.
- `author-check.mjs`: checks of the suite itself.

## How to run

Author check (no product, browser or installed dependency needed), from this folder:

```sh
node --disable-warning=ExperimentalWarning author-check.mjs
```

Acceptance run, from the product checkout once the suite is installed under
`tests/acceptance/holdout/`:

```sh
npx playwright test -c tests/acceptance/holdout
```

The JSON report is `test-results/holdout.json`; the harness uses one worker and
zero retries. Each scenario makes its own temporary drawing folders and runs
alone and in any order. No real engine is ever called and no product response is
mocked.
