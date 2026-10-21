# Held-out coverage

The suite has 51 scenarios. A requirement id appears in a scenario title only
when the scenario observes it; an id the spec marks *To build* appears only
once a step has built something to observe (this round: FILE-2, FILE-3, NAV-2
and STORY-1). Ids are the requirement ids of the product spec.

Since 0.2 the suite lands in batches, each with the step that makes it pass
(`batches/MANIFEST.md` lists the files). The *Lands in* column says which:

| Batch | Lands with | Scenarios |
|---|---|---|
| A | #26 + #27, the `@3` file | `helpers.ts`, H15, H16, H17, H24, H25, H26, H27, H29, H44, H64 (migrated), H88–H91 (new) |
| B | A + #28, edits split between facts and channel | H92–H95 |
| C | A + #29, channel tabs | H96–H98 |
| D | A + B + C + #30, the LinkedIn channel | H99–H101 |
| E | D + #31, draw and redraw | H102, H103 |
| F | A + #32, runs on channels | H104, H105 |
| — | already in the suite and unchanged | the other 23 scenarios |

## Scenarios

| Id | Lands in | Journey |
|---|---|---|
| H15 | A (migrated) | validate a session file, reopen the same editor and export it; the file is `@3` with the defaults per channel |
| H16 | A (migrated) | depth warnings permit a drawing but every broken field is reported, at its `@3` path, without repair |
| H17 | A (migrated) | a hinted system and nested loop render with matching export geometry and kept positions |
| H18 | — | explain a component and edit every field and held item without losing its neighbours |
| H19 | — | select and move connected parts, regroup them and undo a destructive edit |
| H20 | — | enter and create detail views and retain a hundred undo steps across views |
| H21 | — | choose kinds and forms at their destination, including a child in a group, and cancel safely |
| H22 | — | connect two parts, merge the return direction and edit the whole connection |
| H23 | — | type and resize free text, move a neighbouring part, share the text and undo its deletion |
| H24 | A (migrated) | apply and repair an instruction, undo it, cancel and protect a concurrent session edit |
| H25 | A (migrated) | a machine without engines saves a literal request, with its channel and view, for the next session and stops only its own server |
| H26 | A (migrated) | save to the repository file, follow an outside edit and refuse a stale editor write with a reload offer |
| H27 | A (migrated) | migrate an old drawing to `@3`, import both versions and forget them without deleting repository files |
| H28 | — | preview and download an image for every destination in both themes and keep the drawing untouched |
| H29 | A (migrated) | use a local drawing while forged writes are refused, and find the plugin manifests and launcher in place |
| H30 | — | expand a quick ask, pick a test model, follow progress and undo the reported change |
| H31 | — | retry failed and cancelled changes with the same text, model and selection |
| H32 | — | move and align just one part and warn once for a move outside selected parts |
| H33 | — | record exact changes for add, rename, hold, move and remove and reject invalid scopes without edits |
| H34 | — | fade detail at distance while keeping the open part lit and every shape and export unchanged |
| H35 | — | reach a detail view from the views menu, the part that holds it, the breadcrumb and a link; search lights matches and dims the rest, steps with Enter, lists other views, ends with Escape, and never edits the file |
| H36 | — | pin explanations beside the canvas and keep editing controls reachable in a narrow header |
| H38 | — | warn about text the image shortens and count it in the layout report beside the readability check |
| H39 | — | share the view as it is, keep keyboard focus inside sharing and call a drawing too wide to read too small in one plain sentence |
| H40 | — | rename from the callout, choose pictured forms and follow tool hints without accidental edits |
| H41 | — | open an example from an empty library and recover a registered file that became invalid |
| H44 | A (migrated) | accept lane hints in a session file, place what has no position by its place hint and leave positioned parts where they are |
| H63 | — | share a full ordinary view for three destinations with a wrapped caption and explicit clipping warning |
| H64 | A (migrated) | distinguish readable names from readable detail and report the level the measured sizes give |
| H84 | — | open a session file without positions: no overlap, no connection through a part or a group name |
| H85 | — | a sub-line the image shortens is drawn, listed and counted; after the user shortens it nothing is cut |
| H86 | — | ask for no change on a drawing with fixed positions: nothing moves and the layout report counts what the image draws |
| H87 | — | the editor and the exported image agree on every part size and connection path, also after the user moves a part |
| H88 | A | an `@2` file with a detail view and a LinkedIn post opens through the command and the editor and is read back as `@3`: facts, overview views, the LinkedIn view, the conversion warning, every id kept |
| H89 | A | `archdrawer migrate` takes an `@1` and an `@2` file to `@3`, leaves an `@3` file alone, refuses what is not a drawing, and an imported `@2` document is stored as `@3` |
| H90 | A | `validate` refuses each broken `@3` rule with its path and message, lists every violation with the count, writes nothing, and a missing repository path only warns on `open` |
| H91 | A | `svg --channel`, `export.svg?channel=`, `export.mmd?channel=` and a request with a channel: defaults, the named channel's own view, every refusal |
| H92 | B | a rename in the overview shows through the fact in a LinkedIn part with no mark, and marks the LinkedIn channel where a part keeps its own name |
| H93 | B | adding and deleting a part and a connection in the overview change the facts; LinkedIn is marked and keeps its drawing, apart from the part whose only fact is gone |
| H94 | B | moving, a form and the steps switch mark nothing; content edits mark; undo, redo and a reload keep the marks with the edits |
| H95 | B | a session that edits the facts in the file marks the channel it did not redraw, by the same rules, and the editor follows |
| H96 | C | four tabs in order, the current one, the marks with their counts, Keep as it is emptying a mark as one undoable edit |
| H97 | C | README, presentation and an undrawn LinkedIn channel show their stage with tools and Share disabled; switching tabs edits nothing |
| H98 | C | the address names channel and view and survives a reload, an old `?view=` link opens the channel holding it, and the tabs live in the narrow header menu |
| H99 | D | with no engine the LinkedIn tab prepares the simple version from the overview as one undoable edit, pointing at the same facts |
| H100 | D | Design the post draws the LinkedIn channel from the facts with the fixture engine; Share packages it for the LinkedIn feed |
| H101 | D | a rename in the LinkedIn channel is its own name and leaves the overview alone, a description corrects the fact, deleting a part keeps the fact |
| H102 | E | an empty LinkedIn channel is drawn with Draw it, switching channel starts no run, one undo step takes the drawing away |
| H103 | E | Redraw it draws an outdated LinkedIn channel again from the facts, empties its marks and is one undo step |
| H104 | F | a fixture refine in the overview corrects the facts, reaches a LinkedIn part through the fact and marks only the part that keeps its own name |
| H105 | F | a refine on the LinkedIn channel with a scope changes only that channel; simplify rearranges the overview without losing a fact and refuses another channel |

## Requirement map

| Requirement | Scenarios | Evidence and limit |
|---|---|---|
| START-1 | H29 | The plugin manifests and the `archdrawer` launcher exist and parse. Only static packaging; the plugin's command opening the app is not observable. |
| START-2 | — | To build. |
| START-3 | — | See *Not covered*. |
| START-4 | — | To build. |
| START-5 | H15, H16, H17, H25, H27, H41, H44, H84, H88, H89, H90, H91 | `validate`, `open`, `svg` (with `--channel`), `migrate` (`@1`, `@2`, `@3`), `status`, `stop`: exit codes, output lines, same id and URL on reopen, nothing written by `validate`, the path and message of every `@3` violation. |
| SCAN-1 – SCAN-4 | — | To build. |
| READ-1 – READ-3 | — | To build. |
| STORY-1 | H102, H103 | LinkedIn is chosen by its tab, drawn from the facts with Draw it and redrawn with Redraw it; switching channel starts no run (H102). Limit: README and presentation hold no drawing until 0.3, and the focus step that precedes the choice is SCAN, which is not built. Fixture engine only. |
| STORY-2 – STORY-5 | — | To build. |
| STORY-6 | — | See *Not covered*. |
| LAYOUT-1 | H15, H17, H24, H28, H32, H34, H44, H63, H84, H86, H87 | Parts are placed once and keep their place, sizes follow the contracted geometry, and editor, preview, download and `archdrawer svg` draw the same numbers (H17, H28, H63, H87). Limit: sizes and path equality are measured at 0.3 drawing px. |
| LAYOUT-2 | H84, H86 | No connection enters a part it does not join or a group's name (H84); a connection that cannot avoid a stored part is listed, not hidden (H86). Limit: one laid-out system and one stored-position fixture. |
| LAYOUT-3 | H28, H38, H39, H63, H64, H85, H86 | The report counts parts, zones, connections, cut text, crossings and connections over parts; its numbers equal an independent measurement of the exported image (H86). The LinkedIn channel's counts are read in H100. |
| LAYOUT-4 | — | To build. |
| LOOK-1 | H20, H36, H41 | Light and dark themes switch, persist and keep the library legible at the contracted contrast. No judgement of style. |
| LOOK-2 | — | To build. |
| LOOK-3 | — | See *Not covered*. |
| FILE-1 | H15, H16, H18, H19, H20, H21, H22, H23, H24, H25, H26, H27, H30, H35, H36, H40, H41, H88, H90, H94, H95, H97 | The drawing is one file; edits are saved into it; an outside edit is followed; reloads show the stored state; a channel or view change writes nothing (H97). |
| FILE-2 | H15, H16, H27, H88, H89, H90, H91, H92, H93, H96, H99, H100, H104, H105 | The file holds the facts and one drawing per channel: the shape and its defaults (H15), every validity rule's path (H16, H90), `@2` and `@1` read as `@3` with the warning and every id kept (H27, H88, H89), channel on exports and requests (H91), parts that point at facts and a post that is the LinkedIn channel (H88, H99, H100). Limit: how an `@2` post must look to be valid `@2` is no longer in the contracts (see *Contract gaps*). |
| FILE-3 | H92, H93, H94, H95, H101, H103, H104, H105 | A rename or a new part in the overview reaches the facts and every channel that draws them; `outdated` is marked exactly for a new fact, a deleted fact or relation, a relation between two shown facts, and a field a part keeps its own text for; never for the current channel or an empty one; undo restores the marks (H92–H94). A session's write is split the same way (H95). Appearance edits mark nothing (H94). In the LinkedIn channel a rename is the part's own name and a description corrects the fact (H101). Runs follow the same split (H104, H105). Limit: only the overview and LinkedIn channels hold drawings, so a mark is tested on LinkedIn alone. |
| EDIT-1 | H18, H19, H20, H21, H22, H23, H30, H31, H32, H36, H40, H85, H87, H92, H93, H94, H96, H99, H101, H103 | Move, rename in place, add by kind and form, connect by dragging, free text, undo and redo across views, and now across channels (H94, H96, H99, H101, H103). |
| EDIT-2 | H18, H22, H34, H36, H40 | The callout shows purpose, connections and files and edits them. |
| EDIT-3 | H26 | A stale save shows the conflict and the reload offer, never `Saved`. Limit: an unwritable folder is exercised only on POSIX. |
| EDIT-4 | H30 | A drag during a run is refused with the contracted toast and moves nothing. |
| AI-1 | H24, H25, H30, H31, H32, H33, H44, H86, H100, H102, H104, H105 | The instruction acts on the view, the selected parts or the whole channel through a chosen engine and model; failure, cancel, retry, undo, a concurrent session edit, and the channel a run names (H104, H105). Only the fixture engine runs. |
| AI-2 | — | See *Not covered*. |
| AI-3 – AI-5 | — | To build. |
| NAV-1 | H20, H35, H98 | A part opens its inside, detail views nest, a view is reachable from the menu, the breadcrumb and a link, a search result opens its view, and the address keeps the view across a reload (H98). |
| NAV-2 | H96, H97, H98, H99, H101, H102 | Four tabs in the contracted order with the current one, marks with their counts and their accessible names, Keep as it is, the stages of an empty channel with the tools off, the breadcrumb and views menu in the overview only, the address with channel and view, an old `?view=` link, the narrow header (H96–H98). Limit: the breadcrumb is checked at the overview's first view and one detail view. |
| NAV-3 | H35 | Slash and the search button open search; `data-match` and `data-dim` while typing (parts and connections), the count texts, Enter / Shift+Enter / `search-next` / `search-prev` with wrap, `data-match="current"` as the only selected part, no part resized and no view move while typing, the view moving only when the stepped-to part was not wholly on screen below the bar (measured on boxes), a match in another view listed with `data-view` and `data-node-id`, opened by click and by arrow keys plus Enter, `No component is called that`, Escape ending highlight and dimming and keeping the selection, and the file, its modification time and the undo stack untouched. Limit: the order of matches is not pinned; Ctrl/Cmd+K, the 50-result cap and the in-list arrow selection among several results are not exercised. |
| NAV-4 | — | To build. |
| PRES-1 – PRES-3 | — | To build. |
| SHARE-1 | H15, H23, H28, H38, H63, H85, H87, H91, H100 | PNG and SVG at twice the size, copy, light and dark, all four sizes, no product mark, real text, the same image from preview, download, HTTP and the command, now for a named channel (H91, H100). |
| SHARE-2 | H39, H100 | The modal keeps focus, closes back to its button, and carries preview, report and meter, and downloads. None of `preset-simple`, `preset-detailed`, `share-part`, `fix-simplify`, `fix-part` is present (H39). The LinkedIn post controls are not in the dialog; on the LinkedIn channel it defaults to the LinkedIn feed with that channel's view and starting switches, on the overview to README (H100). Limit: the preview of the feed format on the overview tab while a LinkedIn view exists is not pinned. |
| SHARE-3 | H39, H64 | The `readability` line is the contracted one-sentence wording for its level and destination, with no digit; the pixel sizes appear only behind `readability-details-toggle`. |
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
READ-1 to READ-3, STORY-2 to STORY-5, LAYOUT-4, LOOK-2, AI-3 to AI-5, NAV-4,
PRES-1 to PRES-3, QUAL-1, QUAL-3.

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

**To change, left unpinned on purpose**:

- AI-2: the ask box and the AI panel are used as they are today; "one place to
  type instructions" is not asserted.
- LOOK-3: held items are used wherever a panel is, but "optional, one-line
  description by default" is not asserted.

## Contract gaps found while writing the 0.2 scenarios

Each is a place where the contracts leave a choice to the builder; the scenario
asserts only what both readings share, or says here what it assumed.

- **What a valid `archdraw/diagram@2` post looks like.** The drawing contract no
  longer lists the `@2` rules. H88 and H89 build the post from ADR 0006's wording
  (a view with `postOf`, parts with `from`, view and part ids ending `-linkedin`)
  and assume the conversion adds exactly one warning (`Converted from
  archdraw/diagram@2`) for it. If the `@2` reader needs more to accept the file,
  the fixture `legacyWithPost` in `helpers.ts` is what to review.
- **`@1` connections.** The contract does not give the `@1` connection shape, so
  H27 and H89 migrate `@1` files without connections.
- **The path of some `@3` violations.** The contract documents one example
  (`channels.overview.views[0].nodes[3].form`). H90 pins that and the rules whose
  path follows from the shape, and accepts either of the two natural paths for
  the rest: a panel that shows no item (H16), a fact no overview part draws, two
  things sharing an id, a request's channel or view.
- **Which step marks a session's write.** The `outdated` rules cover an outside
  write, the batch table puts "every editor edit" in step #28. H95 is in batch B
  on that reading; if the outside write lands with #27, it passes there too.
- **Where the LinkedIn controls sit on the tab, and how `channel-draw` relates to
  them.** `design-post` and `linkedin-prepare` are looked up by test id on the
  empty LinkedIn stage (D); `channel-draw` and `channel-redraw` likewise (E). The
  scenarios do not say which button is inside which element, and assume that a
  machine with an engine offers `design-post` and one without offers
  `linkedin-prepare`.
- **The wording of the count.** `<n> change(s)` is matched as `1 change` or
  `2 change` followed by anything, so both a plural and a literal `(s)` pass.
- **The address of the overview.** Whether the overview shows `channel=overview`
  in the URL is not stated; only that other channels show theirs and that going
  back removes it. An address naming a known channel and an unknown view is not
  asserted (the contract says an unknown channel or view opens the overview).
- **The ask box on an empty channel.** "The ask box is disabled" is checked on
  `ask-input`.
- **The preview of the feed format on the overview tab** when a LinkedIn view
  exists is not pinned (H28 relies only on the no-LinkedIn case).
- **The fixture's duplicate copy.** `[fixture:invalid]` is said to cost two
  warnings; a copy that also points at the facts its original shows could cost a
  third, so H24 asks for at least two.
- **README and presentation.** They hold no drawing until 0.3; their content
  (STORY-3, STORY-4, PRES-*) cannot be tested from these contracts.

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
  Since the same day H35 is rewritten for NAV-3 and proves NAV-1, NAV-3 and FILE-1.
- **Old baselines and unused helpers removed.** The title baselines, the earlier
  suite folder, the border-case driver and the versioned helper files went with
  the scenarios they served; the functions still needed live in `helpers.ts` and
  `helpers-svg-parity.ts`.
- **Readability meter relaxed.** The scenarios that read the readability meter
  check its level, which the layout report carries too, and no longer its wording
  or the numbers it prints.

## 2026-10-21: the 0.2 file format and channels

The suite went from 33 to 51 scenarios, delivered in the batches above.

- **Helpers read the stored shape.** `readDrawing` now returns the stored
  `archdraw/diagram@3` file joined into the drawn shape the older scenarios
  already used (the overview's views, each part with its facts' text), so a
  scenario asserts what the editor shows whichever way the product stores it.
  `readDocument` returns the stored shape for the scenarios that need facts,
  channels and `outdated`. Files the older scenarios write are authored in the
  drawn shape and stored as `@3` by `workspace`; `workspaceRaw` writes a document
  exactly as given (an `@2` or `@1` file, or a broken one). No later batch edits
  a helper.
- **Scenarios migrated in A.** H15 (the `@3` defaults), H16 (paths of the `@3`
  violations; the `@2` `from` cases left with the rule), H17 (writes a part
  through `writeDrawing`), H24, H26, H29, H64 (read and write the stored
  document where they used to write a read-back copy), H25 (the request names its
  channel), H27 (migration lands as `@3`), H44 (a part shows its own fact).
  Nothing they assert about what a user sees changed.
- **Unchanged and still green in every batch.** The other 23 scenarios read only
  the joined shape. H28, H39 and H63 pick the feed format on a drawing without a
  LinkedIn view, which behaves the same before and after the LinkedIn channel
  exists.
