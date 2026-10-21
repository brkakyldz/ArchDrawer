# Independent held-out suite

Author history: the suite was first written by Codex as an independent acceptance
author, then revised by Claude in separate contexts, and on 2026-10-20 trimmed and
re-mapped to the current requirements by Claude Sonnet 5.5 (`claude-sonnet-5-5`);
on 2026-10-20 H35 was rewritten for NAV-3 by Claude Sonnet 5.5 (`claude-sonnet-5-5`);
on 2026-10-21 the 0.2 round — the `archdraw/diagram@3` file (FILE-2, FILE-3), the
channel tabs (NAV-2), drawing a channel from the facts (STORY-1), and the channel
in runs and sharing (AI-1, SHARE-2) — was written by Claude Sonnet 5.5
(`claude-sonnet-5-5`), from the contracts and ADRs 0003 and 0006 alone, in
batches that land with the build steps they need; and on 2026-10-21 the 0.3 round —
the folder start (START-4), the scan (SCAN-1–4), the deep read and its evidence
(READ-1–3), the README and presentation channels (STORY-1–6), and the routed
instruction (AI-5) — was written by Claude Sonnet 5.5 (`claude-sonnet-5-5`) as an
independent acceptance author, from the contracts and ADRs 0002, 0006 and 0007
alone (the existing suite was copied in unchanged, and no product code was read), in
batches A–H and Z that land with the nine steps of 0.3.

The suite holds 76 Playwright acceptance journeys, written from the product
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
- `H106`–`H130` `*.spec.ts` (25 journeys, the 0.3 round):
  - `H106`–`H109`, the file format: mechanisms, limits, evidence, held rows, one
    README and one presentation view with steps (valid, opened, saved), every new
    validity rule refused with its path, older files gaining nothing, and the README
    and presentation images drawing held and limit rows.
  - `H110`–`H113`, the scan: the card and focus options of a folder, the cache per
    commit and `refresh`, folders outside git, every folder sentence, a failed or
    cancelled scan, and the 409.
  - `H114`–`H116`, the briefs: tuning numbers and count targets for LinkedIn only,
    a large overview with no suggestion and Simplify still working, and a story run
    on LinkedIn.
  - `H117`–`H120`, the draw run: facts with evidence for each channel, the next free
    file name (up to 99), a subfolder and a folder outside git, failure (also a file
    that cannot be written), cancel and a left-out fact, and the order of the request
    checks, the scan's folder included.
  - `H121`–`H123`, the home screen's start flow: folder to editor, wrong folders,
    cached scans, a typed focus and the keyboard, a failed draw and no engine.
  - `H124`–`H125`, the README channel in the editor: drawn, redrawn, kept, prepared
    without an engine, edited.
  - `H126`–`H128`, the presentation: drawn from a story, steps lit and dimmed,
    edited, a part deleted, and the simple version's steps.
  - `H129`–`H130`, routing: facts or story, in the run record, the events and the
    AI panel and ask box.
- `helpers.ts`, `helpers-svg-parity.ts`: shared, test-owned helpers (files, the
  command line, the editor, the share dialog, image measurement; for 0.3 also
  project folders in real git repositories, the scan and draw requests, event
  streams and the steps panel). `readDrawing` returns the stored `@3` file joined
  into the drawn shape of an overview view (each part with its facts' text, a panel's
  mechanism rows first); `readDocument` returns the stored shape; `workspace` stores
  a drawing authored in the drawn shape as `@3`, `workspaceRaw` stores any document
  exactly as given.
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
zero retries. Each scenario makes its own temporary drawing folders and git
repositories (`git` must be on `PATH`) and runs alone and in any order. No real
engine is ever called and no product response is mocked.

A fixture marker in a folder name (`[fixture:slow]`, `[fixture:fail]`) cannot be a
Windows folder name, so on Windows the two scan scenarios that need one (H113, H120)
skip that part and keep the rest; a draw's markers travel in the typed focus and run
everywhere.

## Landing in batches

The 0.2 scenarios were delivered in batches `A`–`F` and `Z`. The 0.3 scenarios are
delivered in batches, each with the pull request that makes it pass, in this order:
`A` the file format (#46, with every helper change), `B` the scan (#47), `D` the
briefs (#49), `C` the draw run (#48), `E` the start flow (#51), `F` the README channel
(#52), `G` the presentation (#53), `H` routing (#54) and `Z` this index. A batch holds
the complete final content of every file it adds or changes; no batch after `A`
changes a helper. `COVERAGE.md` says which scenario lands in which batch, and
`batches/MANIFEST.md` lists the files of each.
