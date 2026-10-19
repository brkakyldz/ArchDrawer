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
  "schema": "archdraw/diagram@2",
  "title": "Sample Shop",
  "views": [
    {
      "id": "overview",
      "title": "Overview",
      "caption": { "title": "How an order flows through Sample Shop", "lede": "" },
      "nodes": [
        { "id": "web", "label": "Web app", "kind": "client", "form": "card", "icon": null, "sub": "React", "items": [], "description": "The shop's pages.", "files": [], "parent": null, "detail": null, "place": { "row": 0, "col": 0 } },
        { "id": "api", "label": "Order API", "kind": "api", "form": "panel", "icon": null, "sub": "", "items": ["Validate order", "Create order"], "description": "Takes orders.", "files": [], "parent": null, "detail": null, "place": { "row": 0, "col": 1 } },
        { "id": "db", "label": "Orders DB", "kind": "data", "form": "card", "icon": null, "sub": "Postgres", "items": [], "description": "Keeps orders.", "files": [], "parent": null, "detail": null, "place": { "row": 1, "col": 1 } }
      ],
      "edges": [
        { "from": "web", "to": "api", "label": "POST /orders", "style": "call", "both": true, "step": 1 },
        { "from": "api", "to": "db", "label": "", "style": "call", "both": false, "step": 2 }
      ],
      "texts": []
    }
  ]
}
```

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
  warning each. Post: the intent also has a connection to `ghost`, so the run
  fails without saving.
- `[fixture:lose]` — simplify: the last overview component and its
  connections are left out of the detail view, so coverage fails naming it
  and nothing is saved.
- `[fixture:long]` — post: the first part's label becomes
  `A deliberately longer request name` (34 chars): kept whole, one target
  warning and an `overLimitText` entry.

### Refine

The first line of the instruction, markers removed, applied to the run's view
(labels match exactly, case-insensitively):

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
lane `{"spine": 0}`, the union of the moved components' files, and no
connections. Other views, texts and requests are kept. Coverage passes; the
one-zone overview then misses its targets (a warning, not a failure). When the
overview already is a single group with an existing detail view, nothing
changes.

### Post

The same story intent every time, each part's `from` set to the source view's
component at the same index (`[]` when there is none):

```json
{
  "title": "How a request becomes a result",
  "lede": "A request enters the app, is checked, and produces a result.",
  "zones": [{ "id": "runtime", "label": "App runtime" }],
  "parts": [
    { "id": "request", "label": "Request", "sub": "start the work", "kind": "client", "chips": [], "zone": null, "spine": 0, "anchor": null, "side": null, "from": [] },
    { "id": "intake", "label": "Request intake", "sub": "check the request", "kind": "api", "chips": ["Validate input", "Bind the scope"], "zone": null, "spine": 1, "anchor": null, "side": null, "from": [] },
    { "id": "loop", "label": "Work loop", "sub": "choose the next action", "kind": "llm", "chips": ["Propose action", "Read tool result"], "zone": "runtime", "spine": 2, "anchor": null, "side": null, "from": [] },
    { "id": "result", "label": "Result", "sub": "deliver the outcome", "kind": "service", "chips": [], "zone": null, "spine": 3, "anchor": null, "side": null, "from": [] },
    { "id": "facts", "label": "Stored facts", "sub": "keep the current state", "kind": "data", "chips": [], "zone": "runtime", "spine": null, "anchor": "loop", "side": "below", "from": [] },
    { "id": "approval", "label": "Approval", "sub": "review the action", "kind": "actor", "chips": [], "zone": null, "spine": null, "anchor": "result", "side": "above", "from": [] }
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
post (drawing contract, Post answers).

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
