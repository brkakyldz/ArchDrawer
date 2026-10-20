# Contract — the local HTTP API

The server behind the editor and the CLI. It serves the web client, stores
and watches drawings, exports images, and runs instructions through the
user's own Claude Code or Codex CLI. It listens on
`http://127.0.0.1:<PORT>` (default 4317), started by `npm start` or detached
by `archdrawer open`. Bodies are JSON, UTF-8. Errors are
`{"error": "<message>"}` with a 4xx/5xx status; a validation error adds
`"errors": ["<path>: <message>", …]`.

Implemented by: `src/server/app.ts` (routes), `src/server/main.ts`
(listener), `src/server/store.ts`, `src/server/files.ts`,
`src/server/runs.ts`, `src/server/engines/*`, `src/core/report.ts`,
`src/core/diff.ts`, `src/core/export/share.ts`, `src/core/export/mermaid.ts`.

## Security envelope

- Binds `127.0.0.1` only.
- A request whose `Host` is not `127.0.0.1:<PORT>` or `localhost:<PORT>` gets
  403 `Forbidden host`; an `Origin` other than `http://` plus one of those
  gets 403 `Forbidden origin`. Checked before anything else.
- The token is random per process. `GET /` and every non-API path return the
  web client's `index.html` with `<meta name="archdraw-token" content="<token>">`
  (files under the build folder are served as files).
- Every `POST`, `PUT`, `PATCH` and `DELETE` under `/api/` needs the header
  `X-Archdraw-Token: <token>`; otherwise 403 `Missing or wrong token` and no
  side effect. `GET` needs no token.
- Request bodies over 8 MB: 413 `Request body too large`. Unknown `/api/`
  paths: 404 `Not found`. Responses carry `X-Content-Type-Options: nosniff`
  and `Referrer-Policy: no-referrer`.

## Endpoints

| Method & path | Success | Errors |
|---|---|---|
| `GET /api/health` | 200 `{"ok": true, "app": "archdrawer", "version", "build"}`; `build` is a hash of the code this process runs (the web page embeds the build it was made from) | — |
| `GET /api/engines` | 200 `{"engines": [{"id", "label", "available", "version", "detail", "test", "models"}]}` in `ARCHDRAW_ENGINES` order; detection is cached for 60 s | — |
| `GET /api/diagrams` | 200 `{"diagrams": [{"id", "title", "path", "updatedAt"}]}`, newest `updatedAt` first; `path` is the file of a registered drawing, `null` for an imported one | — |
| `POST /api/files` `{"path"}` | 200 `{"id", "url"}`: validates (a path missing from the repository is no error, drawing contract rule 14), normalises, writes back and registers the file; the same path (case-insensitive on Windows) gets the same id; the file's own `id` is kept unless another drawing has it | 400 `Give the absolute path of a drawing file` / `The path must be absolute` / `Not found: <path>` / `The file is not a valid drawing` + `errors` |
| `POST /api/diagrams` (a document, `@3`, `@2` or `@1`) | 201 `{"id"}`: imported into the data directory under a new id, an older format converted (drawing contract); files are not checked | 400 `Invalid diagram` + `errors` |
| `POST /api/example` | 201 `{"id"}`: imports the bundled `examples/shop.archdraw.json` (title `Sample Shop`) | 500 |
| `GET /api/diagrams/:id` | 200 the document, re-read from disk (an `@2` file is converted and written back as `@3` first) | 404 `Diagram not found`; 400 `The file <name> is not a valid drawing` + `errors` |
| `PUT /api/diagrams/:id` | 200 `{"ok": true, "updatedAt"}`; atomic write | see *Saving* |
| `DELETE /api/diagrams/:id` | 204: forgets a registered file (it stays on disk) or deletes an imported document | 404 |
| `GET /api/diagrams/:id/events` | 200 `text/event-stream`: `event: changed`, `data: {"updatedAt"}` when the stored document changes other than through `PUT` (a session or the CLI edited the file, a request was saved, a run saved its result); a `: ping` comment every 20 s | 404 |
| `GET /api/diagrams/:id/export.svg?channel=&view=&format=&theme=&parts=` | 200 `image/svg+xml`: the share image (ui contract) of a channel view with title, held items, steps, labels, colour key and texts on and description off; `channel` defaults to `overview`, `view` to the channel's first, `format` to `linkedin`, `theme` to the document's (an unknown theme falls back to it); `parts` (comma-separated ids) draws only those components, everything inside the groups among them, and the connections between them | 404; 400 `Unknown channel "<c>"; use one of overview, linkedin, readme, presentation`, `The channel "<c>" has no drawing`, `Unknown view "<v>"`, `Unknown format "<f>"; use one of linkedin, readme, slide, square, feed`, `Unknown component "<id>" in the view "<v>"` |
| `GET /api/diagrams/:id/export.mmd?channel=&view=` | 200 `text/plain`: a Mermaid `flowchart LR` of the channel view (groups as subgraphs); defaults as for `export.svg` | 404; 400 unknown or empty channel, unknown view |
| `POST /api/diagrams/:id/requests` `{"channel", "view", "text"}` | 201 `{"id"}` (`q<n>`): appends to `requests`; `channel` defaults to `overview` | 400 `The instruction is empty` / `The instruction is too long (4000 characters at most)` / unknown channel / unknown view; 404; 409 `The drawing could not be saved` |
| `POST /api/diagrams/:id/check-files` `{"files": [path, …]}` | 200 `{"missing": [path, …]}`: the given repository-relative paths that do not exist under the drawing's repository root (*Runs*), symlinks resolved; none when that folder is not on this machine | 400 `files must be at most 20 repository-relative paths`; 404 |
| `POST /api/runs` | 202 `{"runId"}` | see *Runs* |
| `GET /api/runs/:runId` | 200 the run record | 404 `Run not found` |
| `GET /api/runs/:runId/events` | 200 event stream: past events replayed, then `progress` `{"message"}` …, then exactly one `done` `{"status", "diagramId", "error", "changes", "channel", "view", "layoutReport"}` | 404 |
| `POST /api/runs/:runId/cancel` | 200 `{"ok": true}` | 404 |
| `POST /api/shutdown` | 200 `{"ok": true}`; then the server cancels running runs, removes `server.json` if it is still its own, and exits | — |

### Saving (`PUT /api/diagrams/:id`)

The body is a whole stored document: valid by the drawing contract, with an
`id` equal to the URL's, a position on every component and an id on every
connection. A path that does not exist in the repository is saved (drawing
contract rule 14); `check-files` names it. A registered file's `source` is
set to its repository root, whatever the body says.

- Header `If-Unmodified-Since-Version: <updatedAt the edit was based on>`
  (optional). When given and the stored `updatedAt` differs, or the stored
  file is unreadable or invalid: 409
  `{"error": "The drawing changed since you opened it", "updatedAt"}`
  (`updatedAt` null for an unreadable file). Nothing is written.
- 400 `The document id does not match the URL`, or
  `Invalid diagram — <first violation>` + `errors`; 404 unknown id.
- The server sets `updatedAt` to a new, strictly increasing timestamp.

### Outside changes

Registered files are polled every 400 ms. A file whose text differs from what
the server last wrote or read is re-validated (an `@2` file converted) and
normalised; the facts it changed mark `outdated` in every channel whose views
the write did not change (drawing contract, *Edits: facts or channel*); its `updatedAt`
moves (unless the writer set a new valid one) and `changed` fires.

## Runs

`POST /api/runs` body:

```jsonc
{ "diagramId": "d_…", "channel": "overview",   // optional, default overview
  "view": "overview",                // a view of that channel; post: optional
  "instruction": "Add a cache",      // required for refine; optional otherwise
  "engine": "claude",                // engine id, or null for the default
  "model": null,                     // model id, or null for the engine's default
  "scope": { "kind": "view" },       // refine: all (default, the whole channel) | view | parts; others: absent or view
  "kind": "refine",                  // refine (default) | post | simplify
  "format": "readme",                // the report's format
  "revise": false,                   // optional boolean
  "readCode": true }                 // post only, optional: false designs it from the facts alone
```

Checked in this order, all 400 before any engine starts:
`Unknown run kind <k>: use refine, post or simplify`;
`Invalid format <f>; use one of …` (post: `feed` or `linkedin`; others any
share format); `revise must be true or false`; `revise: true` →
`Layout revision is not enabled`; `readCode must be true or false`;
`readCode` on a run other than a post → `readCode is for a post`; a non-string instruction for post or
simplify → `instruction must be a string`; a scope other than `{"kind":
"view"}` for post (`A post designs one view: give no scope or {"kind":
"view"}`) or simplify; an empty refine instruction →
`Say what to change: the instruction is empty`; over 4000 chars →
`The instruction is too long (4000 characters at most)`; a non-string model
or engine; a model (trimmed, at most 100 chars) that starts with `-` or
contains anything outside `A–Z a–z 0–9 . _ : / @ [ ] -` →
`Invalid model name "<m>"`; then 404 for the diagram; `Unknown view "<v>"`;
`Unknown channel "<c>"; use one of overview, linkedin, readme, presentation`;
a refine on a channel with no view → `The channel "<c>" has no drawing`;
post on a channel other than `linkedin` (absent means `linkedin` for post) →
`A post is drawn in the linkedin channel`; simplify on a channel other than
the overview or a view other than its first →
`Only the overview is simplified: give the view "<first>"`; an invalid scope
(`Invalid scope: …`, `Invalid scope kind …`,
`A parts scope needs the ids of the selected components`,
`The component "<id>" is not in this view`); `Unknown engine "<e>"`;
`<label> is not available: <detail>`;
`No engine is available: install and log in to Claude Code or Codex`.
409 `An instruction is already running on this drawing`.

**Default engine** (`engine: null`): the document's `engine` if available and
not the test engine; else the first available engine that is not the test
engine; else the test engine when available. The run stores the engine and
model it used in the document's `engine`.

**Kinds.**

| Kind | Engine answers | What may change | Report format |
|---|---|---|---|
| `refine` | the draft of the run's channel (drawing contract, Engine answers) | by `scope`: `all` the whole channel; `view` only that view; `parts` only the named components of that view (and what they hold), connections touching them, and new components — everything else stays, one warning per ignored change. The answer is written back through the facts/channel split (drawing contract), so a fact it changes shows in every channel and marks `outdated` where the rules say | `format`, default `readme` |
| `simplify` | the overview channel's draft; the instruction is `Simplify the overview: keep every component in a detail view or a merged part`, plus whatever the caller adds after it | the overview channel's views reached from its first, appearance only; coverage enforced (every fact still drawn) | default `readme` |
| `post` | a story intent; the brief carries the facts and the overview's first view, and the optional instruction is added to it. With `readCode: false` (drawing or redrawing the channel, STORY-1) it asks the engine to read no file, and Claude Code runs with no tools | only the LinkedIn channel's view (created or replaced, its `outdated` emptied); the facts and other channels stay | `feed` (1080 × 1350, default) or `linkedin` (1620 × 1080) |

**Lifecycle.** `status` is `running`, `succeeded`, `failed` or `cancelled`.
A run reads the drawing's repository root, the one its files are checked
against: a registered file's (drawing contract rule 14), else the document's
`source` folder (none: `This drawing has no repository folder to read`). Before saving it checks
the stored `updatedAt` is still the one it started from; otherwise it fails
with `The drawing changed while the instruction ran.` (post:
`… while the post was designed.`) and the outside edit stays. A failed,
cancelled, invalid or coverage-losing result writes nothing. `succeeded`
means the file was rewritten with a valid document; `diagramId`, the final
`channel` and `view` (for a post, `linkedin` and its view), `changes` and
`layoutReport` are then set. Runs time out after `ARCHDRAW_RUN_TIMEOUT_MS` (`Timed out after <n> min
— try a narrower instruction`); cancel and timeout kill the engine's whole
process tree. A finished run is forgotten after one hour.

**Run record** (`GET /api/runs/:runId`):
`{"id", "kind", "channel", "view", "status", "progress": [string], "diagramId", "error",
"engine", "model", "changes", "layoutReport"}`; `changes` and `layoutReport`
are null until success.

**Progress.** Engine lines (`Starting Claude Code`, `Reading <path>`,
`Searching for “…”`, `Writing the diagram`, …), then `Checking the drawing`
(post: `Checking the post`), then `Saved` or `Saved with <n> warning(s)`.

### Change summary

`{"added", "removed", "changed", "moved", "edgesAdded", "edgesRemoved",
"edgesChanged"}`, id lists, computed over the channel views the run could change
(refine `view`/`parts`: that view; post: the LinkedIn view; otherwise every
view of the run's channel). A
component is `changed` when any field but its position differs and `moved`
when its position differs (never a group). One that moved to another view is
`moved`, not added and removed, and the connections that went with it are not
counted. Connections match by their ends (either direction when two-way) and
are `changed` when label, style, two-way flag, step or direction differs.

### Layout report

Computed by `src/core/report.ts` from the saved channel view as the share
image draws it, with the format's starting switches (ui contract):

```jsonc
{ "channel": "linkedin", "view": "linkedin", "format": "feed",
  "crossings": 0,
  "edgesOverParts": [{ "edge": "e1", "node": "db" }],
  "cutText": [{ "id": "api", "field": "sub", "text": "full text" }],
  "overLimitText": [{ "id": "api", "field": "label", "text": "full text", "limit": 28 }],
  "smallestText": { "inPlace": 8.2, "opened": 16.1, "level": "good", "names": { "inPlace": 10.3, "opened": 20.2 } },
  "counts": { "parts": 8, "zones": 2, "connections": 10 },
  "targets": { "parts": 12, "zones": { "min": 0, "max": 4 }, "connections": 14 },
  "longestConnection": 0.42 }
```

- `crossings`: pairs of connections without a shared end whose curves cross,
  once per pair.
- `edgesOverParts`: a curve entering a non-group component other than its
  ends.
- `cutText`: component labels, sub-lines and items drawn shorter than they
  are, and labels left out for lack of room (only when labels are shown).
- `overLimitText` (LinkedIn channel only): text over the post targets (title in words,
  lede 140, label and sub-line 28, items 22, side labels in words); a label on
  a numbered connection is listed with `limit: 0`.
- `smallestText`: the readability numbers (ui contract); an empty view gives
  zeros and `warn`.
- `counts`: non-group components, top-level groups, drawn connections.
  `targets`: the LinkedIn view `{"parts": 12, "zones": {"min": 0, "max": 4},
  "connections": 14}`; the overview channel's first view `{"parts": null,
  "zones": {"min": 4, "max": 6}, "connections": 15}`; any other view all null. Targets are advice.
- `longestConnection`: the longest curve ÷ the diagonal of the components'
  bounding box; 0 without connections.

## Engines

| id | label | available when |
|---|---|---|
| `claude` | Claude Code | `claude` is on PATH (or `ARCHDRAW_CLAUDE_BIN`), `claude -p --help` lists `--json-schema`, and it can skip the repository's own settings and MCP servers |
| `codex` | Codex | `codex` is on PATH (or `ARCHDRAW_CODEX_BIN`) and `codex exec --help` lists `--output-schema` |
| `fixture` | Fixture (test) | listed in `ARCHDRAW_ENGINES` (testing contract) |

`models`: Claude Code offers the aliases its `--model` help names; Codex the
visible entries of `codex debug models` by priority; either may be empty.

Engines are spawned without a shell, with an argument array, the prompt on
stdin and the repository as working directory, read-only: Claude Code with
`-p --output-format stream-json --json-schema <schema> --tools Read,Grep,Glob
--allowedTools Read,Grep,Glob --permission-mode dontAsk` plus whichever of
`--no-session-persistence --strict-mcp-config --safe-mode --restricted
--setting-sources user` it supports, never `--bare` (a post with `readCode:
false`: `--tools ""` and no `--allowedTools`, so it answers from the prompt
alone); Codex, which has no tool-free mode, always with `exec --json
--sandbox read-only --skip-git-repo-check --output-schema <abs path> -o <abs
path> -C <repo> [--ephemeral] -`. A model goes as `--model` / `-m`. The
engine's environment is the server's minus `CLAUDECODE`, `CLAUDE_CODE_*` and,
when those were set, `ANTHROPIC_BASE_URL`. The server never reads an API key.

## Files on disk

- `<ARCHDRAW_DATA_DIR>/files.json`: registered files, `[{"id", "path"}]`.
- `<ARCHDRAW_DATA_DIR>/diagrams/<id>.json`: imported documents.
- `<ARCHDRAW_DATA_DIR>/server.json` and `server.log` (cli contract).
- Every write goes to a temporary file and is renamed into place.
