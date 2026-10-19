# Independent held-out suite

Author history: the suite was first written by Codex as an independent
acceptance author, later revised by Claude in separate contexts, and on
2026-10-19 revised by Claude Sonnet 5.5 (`claude-sonnet-5-5`).

2026-10-19, Claude Sonnet 5.5: removal of six scenarios, H46, H47, H48, H57,
H58 and H59. The owner decided a new product scope that drops the Simplify flow
(the "Simplify it" suggestion, `kind: "simplify"` runs, their coverage check
DEP-6 and the simplify prompt) and the overview-as-map targets (DEP-4: an
overview of 4-6 top-level zones and at most 15 connections, and the warning or
suggestion when it misses them). Those six scenarios existed only for those two
rules. The selection goes from 69 to 63 scenarios; no scenario was added and no
assertion of a remaining scenario changed. Scenarios that mix simplification
with something still in scope (H43, H49, H56, H60, H30 and others) are kept as
they were.

## Contents

- `H15`-`H83` `*.spec.ts` (63 scenarios, without the six above): Playwright
  acceptance journeys written from the product contracts, never from product code.
- `helpers*.ts`, `border-cases.ts`: shared test-owned helpers.
- `verify.json`: the selected ids and the pass thresholds (runs 3, perScenario 2,
  overall 0.9).
- `playwright.config.ts`: harness configuration. It assumes the suite sits in
  `tests/acceptance/holdout/` of an installed archdrawer checkout.
- `COVERAGE.md`: the scenario list, the requirement-to-scenario map, and the
  limits of what is covered.
- `author-check.mjs`: independent checks of the helpers and scenario callbacks.
- `review-baseline.json`, `review-v11-baseline.json`: title baselines read by
  `author-check.mjs`.
- `retired-v1/`: the retired first suite, kept unchanged.

## How to run

Author check (no product, browser or installed dependency needed):

```sh
node --disable-warning=ExperimentalWarning suite/author-check.mjs
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
