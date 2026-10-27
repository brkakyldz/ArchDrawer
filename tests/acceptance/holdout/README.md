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
batches A–H and Z that land with the nine steps of 0.3; and on 2026-10-22 the 0.4
round — shapes by kind (LOOK-2), held items only where needed (LOOK-3), one AI
conversation (AI-2), previewed results (AI-3), suggestions (AI-4) and the second look
(LAYOUT-4) — was written by Claude Sonnet 5.5 (`claude-sonnet-5-5`) as an independent
acceptance author, from ADR 0008 and the contracts alone (no product code was read),
in batches `0-helpers`, A–F and Z for the two lanes that build 0.4 at the same time; and on
2026-10-22 the story-limits round — a story answer's repair turn (STORY-7) and a failed
draw that keeps its read (START-6), H145–H151 — was written by Claude Sonnet 5.5
(`claude-sonnet-5-5`) as an independent acceptance author, from ADRs 0009 and 0010 and the
contracts alone (no product code was read), and revised the same day to add a journey where a
file the kept read cites is deleted before `Try again`; and on 2026-10-22 the same round was
extended by Claude Sonnet 5.5 (`claude-sonnet-5-5`), issue #97, with H154–H157 — another focus or
model reading again, the plural repair line, a stubborn overview that still writes the drawing, and
`Try again` from the home screen after an overview failure — written from the contracts and ADRs
0009 and 0010 alone; and on 2026-10-22 the round of ADR 0011 —
connections pass behind parts as one cubic each (LAYOUT-2 changed), H84 and H86 rewritten, H152 and
H153 added — was written by Claude Sonnet 5.5 (`claude-sonnet-5-5`) as an independent acceptance
author, from ADR 0011 and the contracts alone (no product code was read); and on 2026-10-22 the 0.5
round — the slide image, presenting (PRES-1), the tour (PRES-2) and the slide exports (PRES-3), H158–H166
— was written by Claude Sonnet 5.5 (`claude-sonnet-5-5`) as an independent acceptance author, from ADR 0012
and the contracts alone (no product code was read), in batches `0-helpers`, A–C and Z for the two lanes
that build 0.5 at the same time; and on 2026-10-22 the ADR 0013–0015 round — calm connections and a steady
drag (LOOK-4, EDIT-5, LAYOUT-5, LAYOUT-6), an outline per kind and no rows on the canvas (LOOK-2, LOOK-3), the
drawing file of several choices `archdraw/diagram@4` (FILE-2), sections and flows (SCAN-2, SCAN-3), several choices
drawn in one run (START-7, STORY-1), the whole-system map (STORY-8), a part that opens its inside (NAV-1) and the
views panel (NAV-2), H167–H184 and H190–H208 — was written by three independent authors, Claude Sonnet 5.5
(`claude-sonnet-5-5`), 2026-10-22: one for the drawing area, one for the selections area and one for the index pass
(the readers of `helpers.ts` for `@4`, the files both areas' topics reach, `COVERAGE.md`, `verify.json`, `README.md` and
`author-check.mjs`), each from the spec, ADRs 0013–0015 and the contracts alone, with no product code read; and on 2026-10-27 the ADR
0016–0017 round — jobs side by side in shared engine slots (JOB-1–10), sources: Recent, Found, the system's folder dialog and
links copied into a cache (SRC-1–6), START-4 and START-7 rewritten, and the rebuilt home screen (HOME-1–12), H209–H247 and the
older home-screen files rewritten for it — was written by three independent passes, Claude Sonnet 5.5 (`claude-sonnet-5-5`),
2026-10-27: one for jobs and sources on the server (H194, H195, H209–H228, `helpers-jobs.ts`), one for the home screen (H27, H121–H123,
H148, H149, H156, H157, H191, H192, H196, H229–H247, `helpers-home.ts`) and one for the index pass (H197 as the merged text of
both areas, `playwright.config.ts`, `COVERAGE.md`, `verify.json`, `README.md`, `author-check.mjs`), each from the spec, ADRs
0016–0017 and the contracts alone, with no product code read.

The suite holds 193 Playwright acceptance journeys, written from the product
contracts and never from product code. Each title reads
`H<nn> [REQUIREMENT IDS] journey`; the ids are the requirements of the product
spec that the journey observes.

On 2026-10-27 the suite was reviewed by an independent pass (`REVIEW.md`): H131 and H133 were retired into the scenarios that observe
the same outlines (their unique checks moved), H248, H249, H250, H251, H252, H253, H254 were split out of scenarios that joined independent journeys, 89 existing scenarios were revised
(tags that name the issue whose elements a scenario waits for, `#202` only where a scenario needs the Activity rail or the draw's progress rows, waits
cut to what the fixture engine needs, duplicated halves removed) and `H224` creates the folder it picks. No assertion the contract asks for was weakened. `COVERAGE.md`
(*Review of 2026-10-27*) holds the current requirement and issue maps. The per-test time cap (`test.setTimeout`) of 125 scenarios was lowered to four times the scenario's passing time, at least 60 s and never raised; helper waits for a draw's or a retry's response are bounded at 30 s.

## Contents

- `H15`–`H44`, `H63`, `H64` `*.spec.ts` (29 journeys): the command line, the editor,
  saving and file conflicts, the instruction box and AI panel, views, sharing,
  security and the plugin manifests.
- `H84`–`H87` `*.spec.ts` (4 outcome journeys): what the layout promises — no
  overlapping parts, every connection one cubic that is never bent around anything
  (a line that meets a part passes behind it and the report lists that part), labels on
  their lines, no silently cut text, a layout report that matches the drawn lines, and an
  editor and an exported image that agree on part sizes and connection paths.
- `H152`–`H153` `*.spec.ts` (2 journeys, the ADR 0011 round): a line level with a group's
  name passes behind it, the name cut out of the line in two exported images and the line
  drawn everywhere else; and a straight line hidden behind the part between its ends, which
  an overview draws behind that part and lists, and a LinkedIn post turns out on one side as
  one cubic clear of it.
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
    AI panel.
- `H131`–`H144` `*.spec.ts` (14 journeys, the 0.4 round; the 0.3 files that used the
  ask box, `simplify-overview` or an immediate result changed with it):
  - `H131`–`H133`, shapes: the five shaped kinds in the editor and the exported image
    at the size of a plain part, in light and dark; the picker's buttons and a kind
    changed in the callout; the post style.
  - `H134`, held items: no *No held items* warning, the other depth warnings where
    their rules say.
  - `H135`–`H137`, the one AI conversation: no ask box, a turn per run with its text
    and place, failures, cancels and Try again, and a saved turn with no engine.
  - `H138`–`H140`, previews: held until a choice, edits refused and undo and redo
    disabled meanwhile, Accept and Undo, and the four ways a preview ends. `H97` also
    holds that on a channel with no drawing the AI panel opens but sending, the
    suggestions and the second look are disabled.
  - `H141`–`H142`, suggestions: per channel, routed, disabled during a run, `Simpler`
    from a detail view, and saved as requests with no engine.
  - `H143`–`H144`, the second look: the `revise` run's checks in order and its fixture
    answers, and `ai-look-again` in the editor.
- `H145`–`H151` `*.spec.ts` (7 journeys, the story-limits round; no earlier file changed):
  - `H145`–`H147`, the repair turn of a story answer: an over-long description repaired by
    the engine (post and README story, the `Fixing` line between the two check lines, no
    shortening and no warning), a stubborn engine's text cut to 240 characters with `…` and
    one `Shortened` warning, and a post's connection to `ghost` repaired, or the run failed
    naming the LinkedIn post with the drawing file unchanged.
  - `H148`, a draw from the home screen whose overview needs the repair turn, in the
    overview stage, ending in a written drawing.
  - `H149`–`H151`, what a failed draw keeps: `Try again` from the home screen after a
    channel-stage failure (no new read, the overview reused, the warnings of a draw that never
    failed), and a draw with another channel after an overview-stage failure (the read
    reused, the overview drawn by a call, the next draw after a success reading again), and a
    file the read cites deleted before `Try again` (the kept read checked again, the overview
    drawn by a call, no fact citing the file; another focus reading again).
- `H154`–`H157` `*.spec.ts` (4 journeys, issue #97; no earlier file changed):
  - `H154`, another focus or another model after a failed draw reads again, while the same
    trimmed focus and model with another channel reuses the read; nothing is written.
  - `H155`, two problems in one post answer are one repair turn, announced in the plural, and
    a stubborn engine fails the run once with the file untouched.
  - `H156`, a draw from the home screen whose overview stays over its limit after the repair turn
    is shortened with one warning and still writes and registers the drawing.
  - `H157`, `Try again` from the home screen after the overview call failed: the read stage
    `running` with `Using the facts already read`, then `done`, the overview drawn by a call.
- `H158`–`H166` `*.spec.ts` (9 journeys, the 0.5 round, ADR 0012; no earlier file changed):
  - `H158`–`H161`, presenting (PRES-1): `Present` and `Tour` in the header of the presentation channel only, off
    with a reason, at every width; the layer on the opening slide in the drawing's theme with focus held, full
    screen asked for and never assumed; the keys, a click, the status line, the band and the dimming rules of the slide image,
    the hint; the speaker note, leaving with the focus back and the step shown current, a deaf editor under the
    layer; an outside change to the file while presenting.
  - `H162`–`H163`, the tour (PRES-2): the first step in a window, the panel beside or under the slide, the parts
    of the step in the view's order with their files and cited lines, `No files recorded`, a path copied alone,
    the tour's keys and leaving.
  - `H164`–`H166`, the slide exports (PRES-3): the PDF read as the testing contract says and the zip of PNG slides,
    in the same order; the dialog's theme and toggles; the format changing no size; the slug; no slide download on other
    channels; two-digit numbering; off without a step.
- `helpers.ts`, `helpers-svg-parity.ts`: shared, test-owned helpers (files, the
  command line, the editor, the share dialog, image measurement; for 0.3 also
  project folders in real git repositories, the scan and draw requests, event
  streams and the steps panel). `readDrawing` returns the stored file joined
  into the drawn shape of an overview view (each part with its facts' text, a panel's
  mechanism rows first); `readDocument` returns the stored shape; `workspace` stores
  a drawing authored in the drawn shape as `@3`, `workspaceRaw` stores any document
  exactly as given. Since the ADR 0013–0015 round a stored or served file is `archdraw/diagram@4`:
  `readDocument`, `readDrawing`, `getDocument`, `persisted`, `persistedDoc` and `sessionWrite` return
  the file's first choice in the `@3` shape (`flattenChoice`), whichever format is on disk;
  `readStoredRaw` and `getStoredRaw` return it as it is.
- `helpers-drawing.ts` and `helpers-selections.ts` (the ADR 0013–0015 round, one per area): the
  drawing area's readers of shapes, sizes, drag marks, guides, line paint and exports, and the
  selections area's `@4` builders, the choices on the home screen, the draw of several choices and
  the views panel. Both import `helpers.ts` and change nothing in it.
- `H167`–`H184` `*.spec.ts` (18 journeys, the drawing area of the ADR 0013–0015 round): a drag that
  moves only what it moves, the drop rule, guides, held sides, neutral connections and the trace,
  labels clear of other lines, busy sides and trunks, the hub mark, the group name's halo, the
  layout's crossing order, an outline per kind at its contracted box, no rows on a part, the sub-line
  switch, the content box of a post card, the engine chosen on the empty LinkedIn stage and the open
  mark. Older files rewritten for the same rules: H17–H19, H28, H31, H33, H34, H39, H40, H63, H64,
  H87, H94, H95, H100, H109, H124, H131–H133, H152.
- `H190`–`H208` `*.spec.ts` (19 journeys, the selections area): a scan's sections and flows, the
  home screen's checkboxes, ticking from the keyboard, the refusals of a draw of several choices,
  one run of three choices, a later failure that keeps the finished ones, the failed choice shown
  on the home screen, a cancel in the second choice, a `@3` file opened as one choice and written
  as `@4`, a file of four choices, an edit in one choice, every export naming its choice, the
  whole-system map, a click that goes into a part, the open mark, and the views panel (list,
  keyboard, strip, narrow header, addresses). Older files rewritten for the same rules: H15, H16,
  H27, H35, H88–H90, H96, H106, H107, H110, H117–H123, H148–H151, H156, H157.
- `H209`–`H228` `*.spec.ts` (20 journeys, the ADR 0016–0017 round, jobs and sources on the server; `helpers-jobs.ts`): four
  choices on three slots (three side by side, the fourth waits and says so), one slot and the queue's order, waiting that counts
  toward no limit, a cancel that frees the slots, a choice that fails alone and the file that holds the others, `Try again` into
  the same file or into a new one, view ids that do not depend on the finish order, the time and source of every progress line,
  choices that join a running draw and every refusal of a join, the Activity list and its keeping time and a restart, Recent,
  Found, the test folder dialog, a test link copied, scanned and drawn into its copy, about ninety refused links, links that cannot
  be copied, and a copy deleted only when nothing else is in it. Every one starts a server of its own (`jobServer`) with the
  variables it needs and stops it in a `finally`. `H194` and `H195` (renamed) rewritten for the same rules.
- `H229`–`H247` `*.spec.ts` (19 journeys, the same round, the home screen; `helpers-home.ts`): the three columns and their folds,
  the drawings as cards, the folder combobox and the navigation lists, `Choose folder…` with the test dialog, a pasted link, links that
  cannot be copied, Recent and its forgetting, the choosing step, three choices side by side, one slot, two repositories at once, a
  failed choice and `Try again`, joining a running draw, a reload and a restart in the middle of a draw, a quiet choice, the keyboard,
  Activity across a reload, and a cancel with a slow second choice. Every one starts a server of its own (`homeServer`). Older files
  rewritten for the new screen: H27, H121–H123, H148, H149, H156, H157, H191, H192, H196, and H197 (the merged text of both areas).
- `verify.json`: the selected ids and the pass thresholds (runs 3, perScenario 2,
  overall 0.9).
- `playwright.config.ts`: harness configuration. It assumes the suite sits in
  `tests/acceptance/holdout/` of an installed archdrawer checkout. Since the ADR 0016–0017 round it also points
  `ARCHDRAW_SEARCH_HOME`, `ARCHDRAW_TEST_PICKER` and `ARCHDRAW_TEST_REMOTES` at a temp folder of its own, as the testing contract says
  (an empty search home, no picker file, an empty remotes folder).
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

The 0.4 scenarios are written in batches for two lanes that build at the same time, each on its own
branch, and are merged at the end. All the batches land together, on one branch both lanes start
from; each lane then runs only its own batches until the merge. `0-helpers` (both lanes) adds the helpers and changes
nothing the 0.3 files use. The look lane runs `A-shapes` (LOOK-2) and `B-held` (LOOK-3) and
none of the others; the ai lane runs `C-conversation`, `D-preview`, `E-suggestions` and
`F-second-look`. A lane's batches use nothing the other lane builds, and every file also
passes after the merge. A changed file replaces its 0.3 version in the batch of the lane that
changes its behaviour; `H130` is renamed (its title no longer names the ask box). `Z-index`
is this index.

The story-limits scenarios (`H145`–`H151`) are one batch, `story-limits`, that adds seven files and
changes `COVERAGE.md`, `verify.json` and this file; no helper changed and no existing scenario.
`H154`–`H157` are a second batch, `story-limits-2`, of the same kind: four files and the same three
index files.

The ADR 0011 round is one batch, `edges-behind`, that rewrites `H84` and `H86`, adds `H152` and `H153`,
adds helpers to `helpers-svg-parity.ts` (`isSingleCubic`, `edgeLine`, `routeToBox`, `distanceToBox`,
`sideOf`, `rasterDifferences`; nothing above them changed) and changes `COVERAGE.md`, `verify.json` and
this file. `batches/MANIFEST.md` lists the files and the scenarios left unchanged.

The 0.5 scenarios are written in batches for two lanes that build at the same time, each on its own branch,
merged at the end. All the batches land together, on one branch both lanes start from; each lane then runs only
its own batches until the merge. `0-helpers` (both lanes) appends the 0.5 helpers to `helpers.ts` and changes nothing
above them. The present lane runs `A-present` (PRES-1, H158–H161) and `B-tour` (PRES-2, H162–H163) and has no
`download-slides-*`; the share lane runs `C-slides` (PRES-3, H164–H166) and has no `present`, `present-*` or `tour-*`
test id. A lane's files use nothing the other lane builds, no file counts the buttons of `share-actions`, and every
file also passes after the merge. No earlier scenario changed. `Z-index` is this index, with `author-check.mjs`
checking that no file mixes the two lanes' surfaces.

The ADR 0013–0015 round is three batches that land with the issues of `ISSUES-drawing.md` and
`ISSUES-selections.md`: `D-drawing` (H167–H184 and the older files it rewrote), `S-selections` (H190–H208
and its rewrites) and `Z-index`, the index pass (`helpers.ts`, H108, H114, H115, H131, `COVERAGE.md`,
`verify.json`, `README.md`, `author-check.mjs`). A title of the round reads `H<nn> [IDS #issue …] journey`,
and every scenario from H167 on names at least one issue so that a build step can run its own subset.
`COVERAGE.md` lists what the round could not test.

The ADR 0016–0017 round is three batches that land with issues #195–#202 (`ISSUES-home.md`): `A-jobs-sources` (H209–H228, H194,
H195 and `helpers-jobs.ts`), `B-home` (H229–H247, the older home-screen files and `helpers-home.ts`) and `Z-index`, the index pass
(H197, `playwright.config.ts`, `COVERAGE.md`, `verify.json`, `README.md`, `author-check.mjs`). The renamed H195 replaces the file of
the same id whose old name is deleted. A scenario of the round starts the product itself with the variables it needs (`jobServer`,
`homeServer`); the shared harness server carries none of them except the three test switches that point at empty temp paths.
