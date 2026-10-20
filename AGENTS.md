# Working on Archdrawer

Guide for contributors and coding agents. Archdrawer is a local web app that
reads a repository with the user's own Claude Code or Codex CLI and draws its
architecture as an editable drawing, ready for a LinkedIn image, a README or a
presentation. It never calls a model API or reads an API key itself.

## Read first

1. This file.
2. `docs/spec.md` — what the product must do, with a status per requirement.
3. The ADRs in `docs/decisions/` that touch your change.
4. The contract in `docs/contracts/` for the interface you change.
5. The GitHub issue you are working on.

## Where things live

| Concern | Location |
|---|---|
| Requirements | `docs/spec.md` |
| Decisions | `docs/decisions/` — a choice that is expensive to reverse gets an ADR; a contradicted ADR is marked `superseded by NNNN` |
| Interfaces | `docs/contracts/` |
| Work items | GitHub issues |
| Shared model, layout, geometry, exporters | `src/core/` — pure: no Node or DOM APIs |
| Server: API, runs, engines, store | `src/server/` |
| Web client | `src/web/` |
| Command line | `src/cli/`, `bin/` |
| Plugin and skill | `.claude-plugin/`, `.codex-plugin/`, `skills/archdrawer/` |
| Generated font metrics | `src/core/metrics.generated.ts` — written by `scripts/font-metrics.py` only |
| Unit tests | next to the code, `*.test.ts` |
| Browser tests | `tests/e2e/` |
| Acceptance scenarios | `tests/acceptance/holdout/` — written independently of the code (below) |

## Commands

| What | Command |
|---|---|
| Install | `npm ci`, then `npx playwright install chromium` for browser tests |
| Run the app | `npm start` (environment in `docs/contracts/testing.md`) |
| Types and unit tests | `npm run check` |
| One area | `npx vitest run src/core` (or a path) |
| Browser tests | `npm run e2e` |
| Acceptance scenarios | `npm run holdout` |
| Core smoke | `npm run smoke:core` |

## Environment

Node 20.19 or newer, npm. Windows, macOS and Linux. Optional: `claude` and/or
`codex` on PATH, signed in. No secrets exist in this project; never read or
copy a user's CLI credentials.

## Invariants

1. Nothing the user types reaches a shell. Engine CLIs are spawned with
   argument arrays and the prompt goes through stdin. Two user inputs reach an
   engine's arguments: the model name, refused when it starts with `-` or
   holds anything but letters, digits and `._:/@[]-`, and the repository
   folder of an opened drawing file, passed as the working directory and as
   the value of Codex's `-C`.
2. Engines only read: Claude with read/search tools only and
   `--permission-mode dontAsk`; Codex with `--sandbox read-only`. Never
   `--bare` (it breaks subscription sign-in), never a write-capable tool.
3. The server binds 127.0.0.1, checks `Host`, requires its per-process token
   on every mutating `/api/` call and rejects foreign `Origin`s.
4. `src/core` is pure, so the browser and the server run identical
   validation, geometry and exports.
5. A part's size is a function of its content (`measureNode`); CSS never
   decides it. Editor and SVG export draw from the same numbers.
6. Every repair that changes what the engine said adds exactly one warning.
   Normalisation that changes nothing it said stays silent: whitespace, path
   form, a path listed twice, the internal id of a post part
   (`docs/contracts/diagram.md`).
7. The fixture engine goes through the same pipeline as the real ones; only
   the agent call is replaced. It is offered only when `ARCHDRAW_ENGINES`
   names it.

### Failures that do not announce themselves

- **Editor/export drift** — the canvas and the SVG disagree on a part's size
  or a line's path. Check: change a label's length, compare the `node-<id>`
  box with the `data-node-id` rect in the SVG.
- **Fixture-only green** — a test passes through the fixture engine while the
  Claude/Codex adapter is broken. The fake-CLI adapter tests guard it; a
  real-engine path is never reported working from fixture evidence.
- **Success without a drawing** — a run ends `succeeded` but no document was
  written. `succeeded` must imply a `diagramId` and a readable file.
- **Shell injection through an input** — a model name like `x; rm -rf ~` or
  `--dangerously-skip-permissions`, or a drawing path with shell characters,
  reaching an engine CLI as anything other than a single argument.
- **Orphaned engine processes** — cancel marks the run cancelled but the CLI
  keeps running (on Windows a `.cmd` shim kill stops only the shell). The
  cancel test checks the child exits.
- **Autosave race** — a later edit overwritten by an earlier in-flight save.
  Two quick edits then a reload must show the second.
- **Stale token after a restart** — every save fails quietly. A failed save
  must show in `save-status`, never `Saved`.

## Tests

Each behaviour is tested once, at the lowest layer that can observe it: pure
logic in vitest, user journeys in the acceptance scenarios. `tests/e2e/` holds
only what the acceptance scenarios do not observe — a faked server response, a
keyboard path, a stricter check, or a platform they skip; each e2e file's
header names the scenarios it defers to.

The acceptance scenarios in `tests/acceptance/holdout/` are written by an
author who sees the spec and the contracts but not the code. Whoever changes
the code does not edit them. If one is wrong, report it in an issue.

## Before you commit

Review your diff for drift from the contracts and ADRs, the invariants above,
failure paths, missing tests and claims the tests do not support. Run
`npm run check`; run `npm run e2e` when the web client changed. Commit only the
paths your change wrote.
