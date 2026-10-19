# Independent holdout coverage

Authored from `spec.md` and all four files in `contracts/`, without access to
product code. Each H-file contains one independent journey, owns its source or
diagram data, and contains both observable success assertions and assertions
against unwanted effects. Only contract API endpoints, UI elements, fixture
markers, and downloaded artifacts drive the product. Filesystem operations
prepare/read the test's own source repositories; they do not inspect product
implementation or persistence internals.

The configuration starts the real product with `npm start`, a fresh data
directory, the fixture engine, and an offline GitHub directory. The directory
environment values are inherited across Playwright workers so their bare
repositories are served by the same instance. Tests require the product's
existing Playwright/Chromium installation and `git`; no package installation
or product-source imports are part of this suite.

Scenario references identify concrete exercised behavior, not blanket proof of
every clause. **Partial** rows have remaining contract or harness limitations
listed below. ENG-4 has no executable proof with the allowed fixture engine.

| Requirement | Scenario IDs | Observable evidence |
| --- | --- | --- |
| SRC-1 | H01, H04 | Absolute folders work; missing paths and files return 400 before creating a diagram; an empty repository still generates. |
| SRC-2 | H02 | Bare, HTTPS `.git`, and SSH GitHub forms clone an actual offline bare repo; branch/tag sources and file links work; a subsequent branch update changes validated files. Partial: shallow/cache internals. |
| SRC-3 | H01, H02 | Unsupported hosts/forms, illegal segments, shell metacharacters, invalid git refs, and excessive ref length are rejected; unsupported errors name local/GitHub forms; cloning failure is a failed run rather than a rejected POST. Partial: invocation internals. |
| ENG-1 | H03 | Engine endpoint metadata and the available configured fixture choice are present. Partial: real CLI detection and versions. |
| ENG-2 | H01, H03, H11 | Unknown engines fail; per-run engine/model/instruction are submitted; last fixture engine and free-text model survive Home reload; refine uses fixture. Partial: switching between real engines/default-model forwarding. |
| ENG-3 | H03 | All original source-file bytes remain unchanged after generation. Partial: fixture does not prove real-engine tool/sandbox restrictions. |
| ENG-4 | — | Contract gap: fixture exposes no real headless CLI invocation, schema arguments, API-key access or subscription billing evidence. |
| ENG-5 | H03, H06, H11, H14 | Running state, disabled generate, live progress, ordered replay, terminal events, failure recovery, authorised cancel, and rejected unauthorised cancel. Partial: elapsed timer and real process-tree termination. |
| ENG-6 | H04, H05 | Missing file paths are removed with five warnings; duplicate `api` becomes `api-2`; dangling ghost edge is dropped with warnings; repaired content persists. Partial: other draft-repair/failure branches. |
| ENG-7 | H03, H05, H06 | Only configured fixture is offered; deterministic content, ordered progress, invalid/fail/slow markers work through the real pipeline. Partial: fixture hiding when disabled. |
| GEN-1 | H01, H03 | All five presets replace text with distinct nonempty instructions; custom edits are submitted; empty instruction rejected. |
| GEN-2 | H01, H02, H03, H05, H06 | Generation navigates to editor; fixture title/subtitle, nodes, zones, finite distinct positions and expected edges are visible/stored. |
| GEN-3 | H11 | Add Cache, rename Web app, remove Order service; same diagram id; kept nodes retain coordinates, inspector edits and files; removed incident edges vanish. |
| GEN-4 | H02, H03, H04 | Local relative file listed; GitHub links use run commit/ref; missing files disappear from inspector with warnings. |
| DM-1 | H03, H05, H07, H12, H13 | Versioned JSON, all element collections, global id uniqueness, one-level nested group import/export, invalid schema rejection and JSON round-trip. |
| DM-2 | H03, H04, H07, H12 | All seven kinds rendered via `data-kind` and added via inspector; label/tech/description edits and file validation; bad kind/long label rejected. Partial: colour encoding. |
| DM-3 | H03, H05, H08, H09, H11, H12, H13 | Endpoint integrity, fixture labels/steps/styles, call handle connection, all style edits, numbered edge visibility, dangling import rejection and Mermaid styles. |
| EDT-1 | H08, H09 | Select and drag nodes/groups/notes, shift-select nodes, delete selected nodes/groups/notes/edge, keep unrelated objects, restore deletions. Partial: box select and dragging edges. |
| EDT-2 | H07, H10, H11 | Inline node/title/subtitle/group/note rename; Escape cancels; inspector label/kind/tech/description changes; reload retains edits. Partial: inline edge label and inspector editing of remaining fields. |
| EDT-3 | H07, H08, H09 | Toolbar node/group/note additions; every kind selected; source-to-target handle drag creates a call edge; inspector edits edge label/style/step. |
| EDT-4 | H08 | Drag a node into and out of a group; stored membership changes. Partial: group resize. |
| EDT-5 | H08, H09, H10 | Toolbar undo/redo restores deletions and layout; 100 separate label edits undo and redo via platform keyboard shortcuts, preserving the prior tech edit. |
| EDT-6 | H09 | Layout changes positions, preserves content, and is reversible. |
| EDT-7 | H09, H13 | Theme changes editor attribute and SVG theme; step badge disappears without removing the stored number; theme/visibility persist. |
| PER-1 | H01, H02, H05, H06, H07, H08, H09, H10, H11, H12, H14 | Real autosave/API polling/reload; newest-first API and UI library order; rename/open/duplicate; confirm dismissal preserves, confirm acceptance deletes; failures and forbidden writes create no partial/extra diagrams. Partial: disk pathname, exact autosave deadline, UI metadata format. |
| PER-2 | H12, H13 | Valid import opens editor under a fresh id; malformed/schema/dangling/duplicate/overlong/bad-kind imports rejected; downloaded JSON equals stored document and reimports without changing original. |
| EXP-1 | H13 | Valid standalone SVG namespace/dimensions/viewBox/theme; exactly one tagged group per node/edge/group; node labels and title in real text; HTTP/UI structure agrees. Partial: exact geometry/colour equivalence. |
| EXP-2 | H13 | Default scale 2; PNG at 1, 2, 3 has signature and IHDR, decodes in Chromium, and IHDR dimensions equal SVG dimensions × scale within one pixel. Partial: renderer/pixel equivalence. |
| EXP-3 | H13 | Mermaid first line, node declarations, nested-group subgraphs/end, all three edge arrows and retained labels. |
| EXP-4 | H13 | SVG excludes scripts/foreignObject, selection/handle elements and known editor-only test ids; Mermaid excludes test ids; downloads have contracted filenames. Partial: PNG chrome/pixel equivalence. |
| EXP-5 | H13 | Untokened SVG/Mermaid HTTP exports have correct content types and match UI export structure/text; theme override does not mutate original. |
| PLT-1 | H14, webServer config | `npm start` health readiness and semver; server reached through 127.0.0.1 with chosen port. Partial: clean install, URL stdout, OS/Node-version matrix. |
| PLT-2 | H14 | Node HTTP controls exact Host; valid 127.0.0.1/localhost allowed; invalid Host/Origin/missing/wrong token rejected for all mutation endpoints; no document side effects; valid token + own Origin permits change/cancel. Partial: bind address and token rotation. |
| PLT-3 | H03, H02 | Browser makes no external HTTP requests during local generation; GitHub sources use offline git. Partial: whole-process network/telemetry/account audit. |

## Contract gaps and limits

- **SRC-2:** HTTP documents and file warnings show fresh GitHub content, but
  cannot distinguish a reused shallow cache from a fresh full clone. Product
  disk inspection and process tracing are outside the requested driving
  surfaces. A clone/cache diagnostic endpoint or explicit process evidence
  would be needed for those clauses.
- **SRC-3:** rejection tests do not prove that every accepted input avoids a
  shell. No argument/invocation audit is exposed. H01 checks the spec's
  accepted-form explanation without requiring exact prose. The spec requires
  git-valid refs; H01 includes regex-valid but git-invalid
  `.hidden`, doubled-slash and trailing-dot examples to exercise that clause.
- **ENG-1, ENG-2, ENG-3, ENG-4:** fixture-only configuration cannot prove
  real Claude/Codex availability/version detection, unavailable-engine UI,
  real-engine switching, default model omission, read-only CLI flags/tools,
  headless/schema invocation, API-key nonaccess or billing. Real CLI stand-ins
  or a documented invocation audit are not offered by these contracts.
- **ENG-5:** there is no elapsed-timer test id or textual timer format. A
  terminal cancelled fixture run proves cancellation state, not termination
  of a real engine and its descendants.
- **ENG-6:** markers cannot produce a zero-valid-node draft, missing groups,
  invalid/deep parents, escaping file paths or excessive draft text. Those
  repair/failure cases need additional fixture markers. Document import
  rejection is intentionally distinct from repair of an engine draft.
- **ENG-7:** the mandated single fixture-enabled server cannot also prove
  fixture invisibility in normal configuration without a second server mode.
- **DM-2, EXP-1:** `data-kind` proves semantic kinds, but UI contracts define
  no colour-bearing primitive or geometry attributes to compare to SVG.
  Stored coordinates are checked on edits/refine/layout/round-trip; exact
  rendered editor-to-export geometry and colours are not pixel-verified.
- **EDT-1, EDT-4:** canvas/group/node ids support pointer dragging and
  shift-click. Box-selection start/activation, edge movement semantics and
  group resize handles/gestures are not specified. The edge model has no
  movable waypoint field. These operations cannot be targeted robustly from
  the named surface without inventing an interaction.
- **EDT-2:** no inline edge-label input is named. Inspector inputs exist only
  for label/kind/tech/description; files are a list and group/coordinates have
  no inspector editing control. In-place edge renaming and editing every
  node field are consequently not fully testable.
- **PER-1:** configured real data storage is exercised through reload/API,
  not inspected for the literal `<id>.json` pathname. Polling waits for
  persisted values and `Saved`, with bounded retries rather than a strict
  wall-clock assertion of the one-second debounce. Library source/date
  strings have no named elements or contracted display format; API metadata
  and visible item titles/order are checked.
- **EXP-2, EXP-4:** PNG validity and scale dimensions are checked directly,
  but no stable pixel baseline/font contract is provided for verifying that
  PNG uses exactly the SVG renderer or contains no rasterised editor chrome.
- **PLT-1, PLT-2, PLT-3:** one already-installed Chromium run cannot prove
  clean install, stdout text, all three operating systems/minimum Node,
  rejection on non-loopback interfaces, token randomness across process
  restarts, or absence of all server-side network/telemetry/account activity.
  These need a platform/process/network harness beyond the exposed endpoints.

## Execution evidence

The holdout files are designed to be copied flat into
`tests/acceptance/holdout/`. Run from product root:

```text
npx playwright test -c tests/acceptance/holdout
```

`verify.json` requests three runs, at least two passes per scenario and 90%
overall, with report `test-results/holdout.json`. No product tests were run in
this specification-only directory; successful runtime acceptance must come
from that report, not from this coverage mapping.

Authoring checks: Node 24.18.0 parsed all 16 TypeScript files; a local
assert-based manifest check matched all 14 titles/IDs, all 34 specification
coverage rows and the exact verification manifest. Playwright and TypeScript
compiler packages are absent here, so this is syntax/consistency evidence,
not a semantic type check or product execution result.
