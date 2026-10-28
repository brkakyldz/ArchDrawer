# Independent held-out suite

Author history: the suite was first written by Codex as an independent acceptance author, then revised in separate contexts and
extended round by round by Claude Sonnet 5.5 (`claude-sonnet-5-5`) as an independent acceptance author, from the spec, the contracts
and the ADRs of each round alone (0.2 to 0.5, the ADR 0013–0015 and ADR 0016–0017 rounds), until it held 193 scenarios.

On 2026-10-28 the suite was rewritten to at most 40 journeys by Claude Opus 5.5 (`claude-opus-5-5`) as an independent acceptance author
in a fresh context, from the spec, the contracts and the ADRs alone; no product code was read.

It now holds 36 journeys, `H01` to `H36`. What each covers is in `COVERAGE.md`; what became of each earlier scenario, and the rules
left to unit tests, is in `RETIRED.md`.

## Rules the suite keeps

- **Journeys, not rules.** Each scenario is a user journey that composes at least two requirements, drives the product only through
  the surfaces the contracts name (HTTP endpoints, UI test ids, files, the command), and asserts what a user would observe and at
  least one thing that must not have happened. A list of rules is checked by one representative case; the rest is unit-test work.
- **Assert outcomes.** Identifiers, the safety refusals and the editor/export equality exactly; every other text by its presence, its
  place and at most a regular expression on key words; sizes and colours by the relation the contract states (inside, not
  overlapping, the same in the editor and the export), with a tolerance for measured text and geometry.
- **No clocks.** No sleeps or fixed waits and no elapsed-time assertions: every wait is an auto-retrying assertion or `expect.poll`
  on a state a contract names. A deadline is set through `ARCHDRAW_RUN_TIMEOUT_MS` or `ARCHDRAW_JOB_KEEP_MS` and the outcome asserted.
- **Platforms.** Paths are compared resolved (real path, separators, case where the disk ignores it). Fixture markers reach a
  draw through a typed choice's text or a test link's repository name, so no scenario needs a folder name Windows cannot hold.
- **Isolation.** Every spec file starts its own product (`server.ts`): `npm start` from the repository root with a free `PORT`, a fresh
  `ARCHDRAW_DATA_DIR`, the fixture engine only, no browser opening, and the test folder dialog and test links pointed at a temp
  folder of its own; it waits for the start-up line and `GET /api/health`, and stops the server and its process tree at the end.
  The config builds the web client once (`globalSetup`), runs four workers, `fullyParallel: false`, `retries: 0`, and writes
  `test-results/holdout.json`. No file depends on another's state or order.
- **Titles.** `H<n> [<requirement IDs>] <journey>`; eight journeys carry `@smoke` (H01, the first run from a folder to a shared
  image, is one).
- **Ownership.** Whoever changes the product does not edit this folder. A scenario that is wrong is reported in an issue.

## Files

| File | What it is |
|---|---|
| `H*.spec.ts` | the 36 journeys |
| `server.ts` | `startProduct` / `useProduct`: one product per spec file |
| `helpers.ts` | test-owned helpers: repositories and test links, drawing documents, the API, event streams, the command, the home screen, the editor, and the geometry read from the editor and from an exported image |
| `playwright.config.ts`, `global-setup.ts` | the Playwright configuration and the one build of the web client |
| `verify.json` | how the held-out verification runs the suite |
| `COVERAGE.md`, `RETIRED.md` | requirement coverage, contract gaps, the fate of every earlier scenario, and the unit-test work |
