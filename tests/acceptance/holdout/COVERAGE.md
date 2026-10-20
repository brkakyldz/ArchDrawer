# Held-out coverage

The suite has 33 scenarios. A requirement id appears in a scenario title only
when the scenario observes it; an id the spec marks *To build* never appears.
Ids are the requirement ids of the product spec.

## Scenarios

| Id | Journey |
|---|---|
| H15 | validate a session file, reopen the same editor and export it |
| H16 | depth warnings permit a drawing but every broken field is reported without repair |
| H17 | a hinted system and nested loop render with matching export geometry and kept positions |
| H18 | explain a component and edit every field and held item without losing its neighbours |
| H19 | select and move connected parts, regroup them and undo a destructive edit |
| H20 | enter and create detail views and retain a hundred undo steps across views |
| H21 | choose kinds and forms at their destination, including a child in a group, and cancel safely |
| H22 | connect two parts, merge the return direction and edit the whole connection |
| H23 | type and resize free text, move a neighbouring part, share the text and undo its deletion |
| H24 | apply and repair an instruction, undo it, cancel and protect a concurrent session edit |
| H25 | a machine without engines saves a literal request for the next session and stops only its own server |
| H26 | save to the repository file, follow an outside edit and refuse a stale editor write with a reload offer |
| H27 | migrate an old drawing, import both versions and forget them without deleting repository files |
| H28 | preview and download an image for every destination in both themes and keep the drawing untouched |
| H29 | use a local drawing while forged writes are refused, and find the plugin manifests and launcher in place |
| H30 | expand a quick ask, pick a test model, follow progress and undo the reported change |
| H31 | retry failed and cancelled changes with the same text, model and selection |
| H32 | move and align just one part and warn once for a move outside selected parts |
| H33 | record exact changes for add, rename, hold, move and remove and reject invalid scopes without edits |
| H34 | fade detail at distance while keeping the open part lit and every shape and export unchanged |
| H35 | reach a detail view from the views menu, the part that holds it, the breadcrumb and a link, without editing the drawing |
| H36 | pin explanations beside the canvas and keep editing controls reachable in a narrow header |
| H38 | warn about text the image shortens and count it in the layout report beside the readability check |
| H39 | share the view as it is, keep keyboard focus inside sharing and call a drawing too wide to read too small in one plain sentence, in the report and the meter alike |
| H40 | rename from the callout, choose pictured forms and follow tool hints without accidental edits |
| H41 | open an example from an empty library and recover a registered file that became invalid |
| H44 | accept lane hints in a session file, place what has no position by its place hint and leave positioned parts where they are |
| H63 | share a full ordinary view for three destinations with a wrapped caption and explicit clipping warning |
| H64 | distinguish readable names from readable detail and report the level the measured sizes give, in the contracted sentence |
| H84 | open a session file without positions: no part overlaps another and no connection runs through a part it does not join or a group name |
| H85 | a sub-line the image shortens is drawn, listed and counted; after the user shortens it nothing is cut |
| H86 | ask for no change on a drawing with fixed positions: nothing moves and the layout report counts what the image draws |
| H87 | the editor and the exported image agree on every part size and connection path, also after the user moves a part |

## Requirement map

| Requirement | Scenarios | Evidence and limit |
|---|---|---|
| START-1 | H29 | The plugin manifests and the `archdrawer` launcher exist and parse. Only static packaging; the plugin's command opening the app is not observable. |
| START-2 | — | To build. |
| START-3 | — | See *Not covered*. |
| START-4 | — | To build. |
| START-5 | H15, H16, H17, H25, H27, H41, H44, H84 | `validate`, `open`, `svg`, `migrate`, `status`, `stop`: exit codes, output lines, same id and URL on reopen, nothing written by `validate`. |
| SCAN-1 – SCAN-4 | — | To build. |
| READ-1 – READ-3 | — | To build. |
| STORY-1 – STORY-5 | — | To build. |
| STORY-6 | — | See *Not covered*. |
| LAYOUT-1 | H15, H17, H24, H28, H32, H34, H44, H63, H84, H86, H87 | Parts are placed once and keep their place, sizes follow the contracted geometry, and editor, preview, download and `archdrawer svg` draw the same numbers (H17, H28, H63, H87). Limit: sizes and path equality are measured at 0.3 drawing px. |
| LAYOUT-2 | H84, H86 | No connection enters a part it does not join or a group's name (H84); a connection that cannot avoid a stored part is listed, not hidden (H86). Limit: one laid-out system and one stored-position fixture. |
| LAYOUT-3 | H28, H38, H39, H63, H64, H85, H86 | The report counts parts, zones, connections, cut text, crossings and connections over parts; its numbers equal an independent measurement of the exported image (H86) and the warning, the picture and the report agree on cut text (H85). Limit: the text-size threshold levels are checked on four constructed cases (H64). |
| LAYOUT-4 | — | To build. |
| LOOK-1 | H20, H36, H41 | Light and dark themes switch, persist and keep the library legible at the contracted contrast. No judgement of style. |
| LOOK-2 | — | To build. |
| LOOK-3 | — | See *Not covered*. |
| FILE-1 | H15, H16, H18, H19, H20, H21, H22, H23, H24, H25, H26, H27, H30, H35, H36, H40, H41 | The drawing is one file; edits are saved into it; an outside edit is followed; reloads show the stored state. |
| FILE-2, FILE-3 | — | To build. |
| EDIT-1 | H18, H19, H20, H21, H22, H23, H30, H31, H32, H36, H40, H85, H87 | Move, rename in place, add by kind and form, connect by dragging, free text, undo and redo across views. |
| EDIT-2 | H18, H22, H34, H36, H40 | The callout shows purpose, connections and files and edits them. |
| EDIT-3 | H26 | A stale save shows the conflict and the reload offer, never `Saved`. Limit: an unwritable folder is exercised only on POSIX. |
| EDIT-4 | H30 | A drag during a run is refused with the contracted toast and moves nothing. |
| AI-1 | H24, H25, H30, H31, H32, H33, H44, H86 | The instruction acts on the view, the selected parts or the whole drawing through a chosen engine and model; failure, cancel, retry, undo and a concurrent session edit. Only the fixture engine runs. |
| AI-2 | — | See *Not covered*. |
| AI-3 – AI-5 | — | To build. |
| NAV-1 | H20, H35 | A part opens its inside, detail views nest, a view is reachable from the menu, the breadcrumb and a link. |
| NAV-2 | — | To build. |
| NAV-3 | — | See *Not covered*. |
| NAV-4 | — | To build. |
| PRES-1 – PRES-3 | — | To build. |
| SHARE-1 | H15, H23, H28, H38, H63, H85, H87 | PNG and SVG at twice the size, copy, light and dark, all four sizes, no product mark, real text, the same image from preview, download, HTTP and the command. |
| SHARE-2 | H39 | The modal keeps focus, closes back to its button, and carries preview, report and meter, and downloads. None of `preset-simple`, `preset-detailed`, `share-part`, `fix-simplify`, `fix-part` is present for any of the four destinations, in the advanced options, or beside a `warn` meter, and the suggestion names neither Simplify nor sharing one part. Limit: the starting toggles per format are pinned in H28 and H63 only through the `show-*` checkboxes. |
| SHARE-3 | H39, H64 | The `readability` line is the contracted one-sentence wording for its level and destination, with no digit: for LinkedIn, README, slide and square on a drawing far too wide to read, with the first suggestion pinned when held items are shown (H39), and for `good`, `ok` and `warn` at README from the level the measured sizes give (H64). The pixel sizes appear only behind `readability-details-toggle`, closed when the dialog opens (H39, H64). Limit: the `ok` sentence is reached only where H64 reaches `ok`; the no-text sentence and the suggestions for LinkedIn and Square formats are not pinned (any contracted suggestion is accepted outside the held-items case). |
| SAFE-1 | H25, H29 | Text typed into an instruction is data, and model names that look like options or shell words are refused. |
| SAFE-2 | — | See *Not covered*. |
| SAFE-3 | H29 | Foreign host and origin, missing or wrong token, loopback only. |
| SAFE-4 | H29 | A whole browser journey makes no request outside the local server. |
| SAFE-5 | — | See *Not covered*. |
| QUAL-1 | — | To build. |
| QUAL-2 | H64, H84, H85 | Readability levels follow the contracted thresholds (H64); no connection over a part (H84); no cut text and an empty crossing and over-part count on a fixed drawing (H85). Limit: nothing here checks a pipeline output of an agent, API or full-stack project. |
| QUAL-3 | — | To build. |

## Not covered

**To build** (nothing to observe yet): START-2, START-4, SCAN-1 to SCAN-4,
READ-1 to READ-3, STORY-1 to STORY-5, LAYOUT-4, LOOK-2, FILE-2, FILE-3, AI-3 to
AI-5, NAV-2, NAV-4, PRES-1 to PRES-3, QUAL-1, QUAL-3.

**Today or changing, but not observable from the contracts** (a contract gap):

- START-3: the contracts name the engine list (`GET /api/engines`, with `detail`
  and `version`) but not what the app says to the user when `claude` or `codex`
  is missing, signed out or too old. The fixture engine is always available.
- SAFE-2: engines are spawned by the product with an argument array and read-only
  tools; the fixture engine replaces that call, so the arguments are not
  observable.
- SAFE-5: the suite runs on one operating system and one Node; no surface
  names the platform differences.
- STORY-6: what the model decides to draw and where it places it has no
  contract surface the fixture engine can exercise.

**To change, left unpinned on purpose** (the old behaviour is not asserted, and
the new behaviour has no contract yet):

- AI-2: the ask box and the AI panel are used as they are today; "one place to
  type instructions" is not asserted.
- NAV-3: search is not exercised; the result list and the centring rule it had
  are the parts the requirement changes.
- LOOK-3: held items are used wherever a panel is, but "optional, one-line
  description by default" is not asserted.

## 2026-10-20: scope trimmed and requirements re-mapped

The suite went from 63 to 33 scenarios.

- **Fine layout geometry retired (H44's post half, H51, H54, H65–H83).** Row and
  column gaps, lane units, badge and label room, group-name entry distances, arc
  cost, caps and clearances, cubic joints and handle lengths, and post-style
  sizes each had their own scenario. They are replaced by four outcome journeys
  (H84–H87) that check what the spec promises: no overlap, no connection through
  a part or a group name, no silently cut text, a truthful layout report and an
  editor that agrees with the exported image. Unit tests own the finer rules.
- **Post and Simplify flows retired (H37, H42, H43, H45, H49, H50, H52, H53, H55,
  H56, H60, H61, H62).** The LinkedIn post flow is rebuilt with the channel model
  and Simplify leaves the product; scenarios for the new flow come with it. The
  parts of H16, H28, H29, H30, H38, H39 and H44 that mixed these flows with
  behaviour that stays were rewritten without them.
- **Search rewritten away (H35).** The old search list and centring are what the
  new search changes; the views menu, breadcrumb and link navigation stay.
- **Old baselines and unused helpers removed.** The title baselines, the earlier
  suite folder, the border-case driver and the versioned helper files went with
  the scenarios they served; the functions still needed live in `helpers.ts` and
  `helpers-svg-parity.ts`.
- **Readability meter relaxed.** The scenarios that read the readability meter
  check its level, which the layout report carries too, and no longer its wording
  or the numbers it prints.
