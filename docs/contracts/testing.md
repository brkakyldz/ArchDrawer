# Contract — running and testing the product

How to start the product under test, the environment it reads, the
deterministic fixture engine that stands in for Claude Code and Codex, and
how each test suite is run.

Implemented by: `src/server/config.ts` (environment), `src/server/main.ts`,
`scripts/start.mjs`, `src/server/engines/fixture.ts`,
`tests/e2e/playwright.config.ts`,
`tests/acceptance/holdout/playwright.config.ts`, `vitest.config.ts`,
`package.json` scripts.

## Start

```bash
npm ci                                   # or npm install; npx playwright install chromium for browser tests
npm start                                # builds the web client when missing or older than its sources, then serves (foreground)
node bin/archdrawer.mjs open <file> --no-browser   # validate, normalise, start or reuse a detached server, register
```

`npm start` prints `archdrawer listening on http://127.0.0.1:<PORT>` and then
`Data: <dir> · engines: <ids or none>`; from then `GET /api/health` answers 200
and `server.json` exists in the data directory. A port in use prints
`Port <PORT> is in use. Set PORT to another port.` and exits 1. `archdrawer
open` with the same `ARCHDRAW_DATA_DIR` and `PORT` reuses that server.

## Environment

Read by the server and the CLI:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4317` | port on 127.0.0.1 (an invalid value gives the default) |
| `ARCHDRAW_DATA_DIR` | `~/.archdraw` | registry, imports, `server.json`, `server.log`; point it at a fresh temp folder for isolation |
| `ARCHDRAW_ENGINES` | `claude,codex` | comma-separated engine ids, case-insensitive, in preference order; `fixture` adds the test engine; `ARCHDRAW_ENGINES=fixture` offers only it; an empty value offers none; unknown ids are ignored with a warning |
| `ARCHDRAW_FIXTURE_STEP_MS` | `250` | delay between fixture progress messages (`0` or invalid gives the default) |
| `ARCHDRAW_RUN_TIMEOUT_MS` | `1200000` (20 min) | a run's time limit; at least 10000 |
| `ARCHDRAW_NO_OPEN` | unset | any non-empty value: never open a browser |
| `ARCHDRAW_CLAUDE_BIN`, `ARCHDRAW_CODEX_BIN` | unset | path of the `claude` / `codex` executable instead of looking it up on PATH |

Tests write drawing files into their own temp folders (the file's folder, or
its nearest ancestor holding `.git`, is the repository root for the `files`
check) and register them with `POST /api/files` or `archdrawer open
--no-browser`.

## A minimal valid file

```json
{
  "schema": "archdraw/diagram@3",
  "title": "Sample Shop",
  "facts": {
    "components": [
      { "id": "web", "label": "Web app", "kind": "client", "sub": "React", "description": "The shop's pages.", "files": [], "items": [] },
      { "id": "api", "label": "Order API", "kind": "api", "sub": "", "description": "Takes orders.", "files": [], "items": ["Validate order", "Create order"] },
      { "id": "db", "label": "Orders DB", "kind": "data", "sub": "Postgres", "description": "Keeps orders.", "files": [], "items": [] }
    ],
    "relations": [
      { "id": "r1", "from": "web", "to": "api", "label": "POST /orders", "style": "call", "both": true },
      { "id": "r2", "from": "api", "to": "db", "label": "", "style": "call", "both": false }
    ]
  },
  "channels": {
    "overview": {
      "views": [
        {
          "id": "overview",
          "title": "Overview",
          "caption": { "title": "How an order flows through Sample Shop", "lede": "" },
          "nodes": [
            { "id": "web", "facts": ["web"], "form": "card", "icon": null, "parent": null, "detail": null, "place": { "row": 0, "col": 0 } },
            { "id": "api", "facts": ["api"], "form": "panel", "icon": null, "parent": null, "detail": null, "place": { "row": 0, "col": 1 } },
            { "id": "db", "facts": ["db"], "form": "card", "icon": null, "parent": null, "detail": null, "place": { "row": 1, "col": 1 } }
          ],
          "edges": [
            { "from": "web", "to": "api", "relations": ["r1"], "step": 1 },
            { "from": "api", "to": "db", "relations": ["r2"], "step": 2 }
          ]
        }
      ]
    }
  }
}
```

The same drawing as an `archdraw/diagram@2` file (one `views` list at the top
level, each component carrying its content) is still accepted: it is
converted when read and written back as `@3` (drawing contract, *Reading
`archdraw/diagram@2`*).

## The fixture engine

Id `fixture`, label `Fixture (test)`, shown in the editor as
`Test engine (no AI)`; `test: true`, always available, offered only when
`ARCHDRAW_ENGINES` names it, and never chosen by default in place of an
available real engine. It goes through the same run pipeline as the real
engines (draft → answer → repair or story conversion → layout → validation
→ conflict check → atomic save → events); only the CLI call is replaced. Its
models are `fixture-fast` (`Fast (test)`) and `fixture-careful`
(`Careful (test)`); any valid model name is accepted.

**Progress**: `Using model <model>` when the run names a model, then
`Reading the drawing`, `Reading the code`, `Updating the drawing`, each after
`ARCHDRAW_FIXTURE_STEP_MS`, then one more step before it answers. The pipeline
adds its own lines (`Checking the drawing`, `Saved`, …).

**Markers** anywhere in the instruction, case-sensitive, for every kind:

- `[fixture:fail]` — the run fails with `Fixture failure requested`.
- `[fixture:slow]` — first 30 lines `Working 1/30` … `Working 30/30`, one
  every 2 s (for cancel tests).
- `[fixture:invalid]` — refine and simplify: the answer also holds a copy of
  the view's first component (label `Duplicate`) and a connection from it to
  `ghost`; repair renames the copy `<id>-2` and drops the connection, one
  warning each, and the copy, which names the fact its original shows, keeps
  its text as its own and shows no fact (one more warning). Post: the intent
  also has a connection to `ghost`, so the run fails without saving.
- `[fixture:lose]` — simplify: the last overview component and its
  connections are left out of the detail view, so coverage fails naming it
  and nothing is saved.
- `[fixture:long]` — post: the first part's label becomes
  `A deliberately longer request name` (34 chars): kept whole, one target
  warning and an `overLimitText` entry.

### Refine

The first line of the instruction, markers removed, applied to the run's view
(labels match the drawn labels exactly, case-insensitively); the answer is
written back as the drawing contract's *Writing the answer back* says, so
`add` adds a fact, `rename` and `hold` edit the part's fact, and `remove`
deletes facts in the overview and only the part elsewhere:

- `add <Label>` — a new `service` card `<Label>` (a trailing ` component`
  removed), id the label lower-cased with runs of other characters → `-`
  (`added` when empty), `place` null, description `Added by the fixture
  engine.`, and a `call` connection from the view's first component, no label,
  no step.
- `remove <Label>` — removes that component and its connections.
- `rename <Old> to <New>` — relabels it.
- `hold <Item> in <Label>` — appends the item and makes it a panel. A group
  stays a group, so repair then drops its items with one warning.
- `move <A> right of <B>` — `<A>`'s top-left to `(B.x + B.w + 64, B.y)` from
  `<B>`'s current box; `move <A> below <B>` — `(B.x, B.y + B.h + 64)`.
- `align <A> with <B>` — `<A>`'s top level with `<B>`'s; its `x` stays.
- anything else — no change; the run still succeeds.

Every other component answers `at: null`; the run's scope applies as for any
engine (a move outside a `parts` scope is ignored with one warning).

### Simplify

The overview's components and connections move into a new view
`inside-the-system` (title and caption `Inside the system`, all of them laid
out again); the overview is left with one group `System map` (id
`system-map`; both ids get `-2`, `-3` … when taken), kind `service`,
description `The whole system; open it for its parts.`, `detail` the new view,
lane `{"spine": 0}`, no facts (so its label, kind and description are its
own and it has no files), and no connections. No fact changes. Other views, texts and requests are kept. Coverage passes. When the
overview already is a single group with an existing detail view, nothing
changes.

### Post

The same story intent every time, each part's `facts` set to the facts of
the overview's first view's part at the same index when that part shows
exactly one (`[]` otherwise, or when there is none):

```json
{
  "title": "How a request becomes a result",
  "lede": "A request enters the app, is checked, and produces a result.",
  "zones": [{ "id": "runtime", "label": "App runtime" }],
  "parts": [
    { "id": "request", "label": "Request", "sub": "start the work", "kind": "client", "chips": [], "zone": null, "spine": 0, "anchor": null, "side": null, "facts": [] },
    { "id": "intake", "label": "Request intake", "sub": "check the request", "kind": "api", "chips": ["Validate input", "Bind the scope"], "zone": null, "spine": 1, "anchor": null, "side": null, "facts": [] },
    { "id": "loop", "label": "Work loop", "sub": "choose the next action", "kind": "llm", "chips": ["Propose action", "Read tool result"], "zone": "runtime", "spine": 2, "anchor": null, "side": null, "facts": [] },
    { "id": "result", "label": "Result", "sub": "deliver the outcome", "kind": "service", "chips": [], "zone": null, "spine": 3, "anchor": null, "side": null, "facts": [] },
    { "id": "facts", "label": "Stored facts", "sub": "keep the current state", "kind": "data", "chips": [], "zone": "runtime", "spine": null, "anchor": "loop", "side": "below", "facts": [] },
    { "id": "approval", "label": "Approval", "sub": "review the action", "kind": "actor", "chips": [], "zone": null, "spine": null, "anchor": "result", "side": "above", "facts": [] }
  ],
  "edges": [
    { "from": "request", "to": "intake", "label": "", "style": "call", "step": 1 },
    { "from": "intake", "to": "loop", "label": "", "style": "call", "step": 2 },
    { "from": "loop", "to": "result", "label": "", "style": "call", "step": 3 },
    { "from": "loop", "to": "facts", "label": "", "style": "dep", "step": null },
    { "from": "result", "to": "approval", "label": "review", "style": "async", "step": null },
    { "from": "approval", "to": "result", "label": "decision", "style": "call", "step": null }
  ]
}
```

The last two connections become one two-way connection with exactly one
warning. The server, not the fixture, converts, places, measures and saves the
post (drawing contract, Story answers).

### Scan

Markers are read from the folder's last path segment, the same markers as
above: `[fixture:fail]` fails the scan, and `[fixture:slow]` adds the 30 slow
lines. Progress is `Reading the inputs`, then `Writing the card`.

The answer is built from the inputs code gathered:

- **card.**
  - `name`: the folder's last segment, markers removed and trimmed.
  - `sentence`: `A project scanned by the test engine.`
  - `type`: `agent`.
  - `languages`: `["TypeScript"]`.
  - `entryPoints`: the first two entry-point candidates.
- **options**, in this order:
  1. `flow`, `How a request moves through the project` (`Follows one
     request from the entry point to the store.`), with the listing's first
     two files;
  2. `mechanism`, `The agent loop` (`How the agent proposes and runs a
     tool.`), with the listing's third file (else its first);
  3. `overview`, `The whole architecture` (`Every part and how they
     connect.`), with the listing's first file;
  4. `flow`, `A path that is not there` (`Backed by a file that does not
     exist.`), with `fixture/missing-file.ts`.

  Option 4 is always left out, with one warning. A folder with no file leaves
  out all four, so the scan succeeds with no option.

### Draw

A `draw` run makes the three calls of the api contract.

**Markers** come from the folder's last segment and the typed focus:

- `[fixture:fail]` fails the read;
- `[fixture:fail:overview]` fails the overview call, and
  `[fixture:fail:channel]` the channel call, after the earlier calls
  succeeded;
- `[fixture:slow]` slows the read;
- `[fixture:partial]` makes the overview story leave out `store`.

Each call has the fixture's progress lines.

**Read.** Let A be the listing's first file and B its second (else A). The
answer is always the following.

Components:

| id | kind | label | within | evidence |
|---|---|---|---|---|
| `app` | service | `App` | — | A |
| `agent` | llm | `Agent` | — | B, lines `[1, 1]` |
| `model-call` | llm | `Model call` | `agent` | B, `[1, 1]` |
| `tool-proposal` | service | `Tool proposal` | `agent` | B, `[1, 1]` |
| `tool-check` | gate | `Tool check` | `agent` | B, `[1, 1]` |
| `tool-run` | worker | `Tool execution` | `agent` | B, `[1, 1]` |
| `tool-result` | service | `Tool result` | `agent` | B, `[1, 1]` |
| `store` | data | `Store` | — | A |
| `ghost` | external | `Ghost service` | — | `fixture/ghost.ts` |

Every sub-line is `""` and every description is `<label> as the test engine
read it.`

Relations, `call` unless noted:

- `app → agent` (`asks`);
- `model-call → tool-proposal → tool-check → tool-run → tool-result`;
- `tool-result → model-call` (`async`);
- `agent → store` (`keeps state`);
- `app → ghost`.

Their evidence is A for those ending in `app`, `store` or `ghost`, else B.

Limits:

- `turn-limit` on `agent`, `Stops after 12 turns`, B `[1, 1]`;
- `ghost-limit` on `ghost`, `Answers within 2 s`, B `[1, 1]` (its evidence holds; it goes with
  `ghost`).

The evidence check then adds exactly these four warnings:

1. `ghost: dropped the evidence fixture/ghost.ts: not found`
2. `Dropped "ghost": no evidence left`
3. `Dropped "r8": its component "ghost" was dropped`
4. `Dropped "ghost-limit": its component "ghost" was dropped`

A folder with no file fails the read with the drawing contract's
no-fact error.

**Overview story.**

- Title: the card's name. Lede: `Drawn by the test engine.`
- One zone, `runtime` (`Agent runtime`).
- Parts:
  - `app`: spine 0, facts `["app"]`;
  - `agent`: spine 1, in `runtime`, facts `["agent"]`, holding every
    mechanism in the table's order, with limits `["turn-limit"]`;
  - `store`: anchored below `agent`, in `runtime`, facts `["store"]`.
- Connections: `app → agent` (step 1, `asks`) and `agent → store`.
- `[fixture:partial]` leaves `store` out, so code adds it with one warning.

**Channel story.** As for a `story` run (below), on the overview just drawn.

### Story

These are the answers of a `story` run, a `draw` run's channel call, and the
`story` route of a refine (*Routing*).

- **LinkedIn:** the post intent above.
- **README.** Code builds the intent from the overview channel's first view:
  - title: its caption title; lede: `A detailed drawing made by the test
    engine.`; no zones;
  - parts: one per part that is not a group and shows a fact, in view order,
    at most 12. Each keeps its id, drawn label, sub-line and kind, and has no
    chips. Its spine is its index. Its `facts`, `held` and `limits` are the
    part's;
  - edges: the connections between those parts, with their drawn label,
    style and step;
  - steps: `[]`.
- **Presentation:** the README intent, with steps added:
  - one step for each of the first three parts:
    `{ "parts": ["<id>"], "text": "Step <n>: <label>", "note": "The test
    engine explains <label>." }`;
  - a fourth step naming `ghost-part`, which is dropped with one warning.

### Routing

A refine's routing question answers `story` when the instruction holds
`[fixture:story]`, else `facts`.

- **`facts` route:** the *Refine* answer.
- **`story` route on LinkedIn, README or presentation:** the channel's
  *Story* answer.
- **`story` route on the overview:** the *Refine* answer. A content change in
  it (`add`, `remove`, `rename`, `hold`) is then ignored with one warning;
  `move` and `align` apply.

## Test suites

| Command | What it runs |
|---|---|
| `npm run check` | `tsc --noEmit -p tsconfig.json`, then `vitest run` over `src/**/*.test.ts` and `scripts/**/*.test.ts` (node environment, 20 s per test). Offline; no browser, no engine |
| `npx vitest run <path>` | one area while iterating (`src/core`, `src/server`, …) |
| `npm run e2e` | Playwright (`tests/e2e/`, Chromium, one worker). It starts its own `npm start` with `PORT=$E2E_PORT` (default 4398), `ARCHDRAW_DATA_DIR=$E2E_DATA_DIR` (default a new temp folder), `ARCHDRAW_ENGINES=fixture`, `ARCHDRAW_NO_OPEN=1`, `ARCHDRAW_FIXTURE_STEP_MS=60`; viewport 1440 × 900; artifacts in `test-results-e2e/` |
| `npm run holdout` | Playwright over `tests/acceptance/holdout/H*.spec.ts` (Chromium, one worker). It starts its own `npm start` on `$ARCHDRAW_HOLDOUT_PORT` (default a free port) with `ARCHDRAW_DATA_DIR=$ARCHDRAW_HOLDOUT_DATA` (default a new temp folder), `ARCHDRAW_ENGINES=fixture`, `ARCHDRAW_NO_OPEN=1`, `ARCHDRAW_FIXTURE_STEP_MS=100`; viewport 1600 × 1000; results in `test-results/holdout.json` |

Both browser suites need `npx playwright install chromium` once and never
reuse a running server. A browser test may assume a fresh data directory, the
fixture engine only, no browser opening, and `npm ci` done; downloads are read
through Playwright's download API, and the clipboard needs the
`clipboard-read`/`clipboard-write` permissions.

The suite in `tests/acceptance/holdout/` is written from these contracts, not
from the code. A failure there is fixed in the product, never by editing the
suite.

No suite calls a real engine. A run with `ARCHDRAW_ENGINES=claude` or `codex`
against a real repository uses the user's own subscription and is opt-in;
fixture results never count as evidence that a real engine works.
