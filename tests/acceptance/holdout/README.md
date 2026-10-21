# Independent held-out suite

Author history: the suite was first written by Codex as an independent acceptance
author, then revised by Claude in separate contexts, and on 2026-10-20 trimmed and
re-mapped to the current requirements by Claude Sonnet 5.5 (`claude-sonnet-5-5`);
on 2026-10-20 H35 was rewritten for NAV-3 by Claude Sonnet 5.5 (`claude-sonnet-5-5`);
on 2026-10-21 the 0.2 round — the `archdraw/diagram@3` file (FILE-2, FILE-3), the
channel tabs (NAV-2), drawing a channel from the facts (STORY-1), and the channel
in runs and sharing (AI-1, SHARE-2) — was written by Claude Sonnet 5.5
(`claude-sonnet-5-5`), from the contracts and ADRs 0003 and 0006 alone, in
batches that land with the build steps they need.

The suite holds 51 Playwright acceptance journeys, written from the product
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
- `H88`–`H105` `*.spec.ts` (18 journeys, the 0.2 round): the `@3` file (reading `@2`
  and `@1`, `migrate`, every validation rule, `--channel` and `?channel=`,
  requests with a channel), edits split between the facts and a channel and the
  `outdated` marks, the channel tabs and their stages and addresses, the LinkedIn
  channel (prepared without an engine, designed with one, edited, shared), drawing
  and redrawing a channel, and runs that name their channel.
- `helpers.ts`, `helpers-svg-parity.ts`: shared, test-owned helpers (files, the
  command line, the editor, the share dialog, image measurement). `readDrawing`
  returns the stored `@3` file joined into the drawn shape of an overview view
  (each part with its facts' text); `readDocument` returns the stored shape;
  `workspace` stores a drawing authored in the drawn shape as `@3`, `workspaceRaw`
  stores any document exactly as given.
- `verify.json`: the selected ids and the pass thresholds (runs 3, perScenario 2,
  overall 0.9).
- `playwright.config.ts`: harness configuration. It assumes the suite sits in
  `tests/acceptance/holdout/` of an installed archdrawer checkout.
- `COVERAGE.md`: the scenario list with the batch each lands in, the
  requirement-to-scenario map, what is not covered and the contract gaps found.
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

## Landing in batches

The 0.2 scenarios are delivered in batches, each with the pull request that makes
it pass (`A` the file format, `B` edits split between facts and channel, `C` the
channel tabs, `D` the LinkedIn channel, `E` drawing and redrawing, `F` runs on
channels, `Z` this index). A batch holds the complete final content of every file
it adds or changes; no batch after `A` changes a helper. `COVERAGE.md` says which
scenario lands in which batch.
