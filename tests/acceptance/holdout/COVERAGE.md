# Held-out coverage

The suite has 76 scenarios. A requirement id appears in a scenario title only
when the scenario observes it; an id the spec marks *To build* appears only
once a step has built something to observe (this round: START-4, SCAN-1 to
SCAN-4, READ-1 to READ-3, STORY-2 to STORY-5 and AI-5, with STORY-1 and
STORY-6 changed). Ids are the requirement ids of the product spec.

Since 0.2 the suite lands in batches, each with the step that makes it pass
(`batches/MANIFEST.md` lists the files). The *Lands in* column says which. The
0.2 batches were:

| Batch | Lands with | Scenarios |
|---|---|---|
| A | #26 + #27, the `@3` file | `helpers.ts`, H15, H16, H17, H24, H25, H26, H27, H29, H44, H64 (migrated), H88–H91 (new) |
| B | A + #28, edits split between facts and channel | H92–H95 |
| C | A + #29, channel tabs | H96–H98 |
| D | A + B + C + #30, the LinkedIn channel | H99–H101 |
| E | D + #31, draw and redraw | H102, H103 |
| F | A + #32, runs on channels | H104, H105 |

The 0.3 batches, in the order the steps land (`A, B, D, C, E, F, G, H, Z`; the
letters name the file folders, so the row order is the landing order). Files
lettered in the 0.2 table above are history; from here a letter means this table:

| Batch | Lands with | Scenarios |
|---|---|---|
| A (0.3) | #46, the file format | `helpers.ts` (every helper of the round), H90 (changed), H106–H109 |
| B (0.3) | #47, the scan resource | H110–H113 |
| D (0.3) | #49, the story briefs | H16 (changed), H114–H116 |
| C (0.3) | #48, the draw run | H117–H120 |
| E (0.3) | #51, the start flow | H41 (changed), H121–H123 |
| F (0.3) | #52, the README channel | H97, H98 (changed), H124, H125 |
| G (0.3) | #53, the presentation channel | H126–H128 |
| H (0.3) | #54, routing | H24, H30 (changed), H129, H130 |
| Z (0.3) | last | `COVERAGE.md`, `verify.json`, `README.md`, `author-check.mjs` |
| — | already in the suite and unchanged | the other scenarios |

## Scenarios

| Id | Lands in | Journey |
|---|---|---|
| H15 | A (migrated) | validate a session file, reopen the same editor and export it; the file is `@3` with the defaults per channel |
| H16 | A (migrated), D (0.3, changed) | depth warnings permit a drawing but every broken field is reported, at its `@3` path, without repair; from 0.3 a tuning number outside LinkedIn is no warning and no size warning exists |
| H17 | A (migrated) | a hinted system and nested loop render with matching export geometry and kept positions |
| H18 | — | explain a component and edit every field and held item without losing its neighbours |
| H19 | — | select and move connected parts, regroup them and undo a destructive edit |
| H20 | — | enter and create detail views and retain a hundred undo steps across views |
| H21 | — | choose kinds and forms at their destination, including a child in a group, and cancel safely |
| H22 | — | connect two parts, merge the return direction and edit the whole connection |
| H23 | — | type and resize free text, move a neighbouring part, share the text and undo its deletion |
| H24 | A (migrated), H (0.3, changed) | apply and repair an instruction, undo it, cancel and protect a concurrent session edit; the progress lines of the refine are asserted in order, not by count, since a refine starts with the routing question's engine lines, if any, then its route line (`Changing the facts`), and the fixture's answer adds no line of its own |
| H25 | A (migrated) | a machine without engines saves a literal request, with its channel and view, for the next session and stops only its own server |
| H26 | A (migrated) | save to the repository file, follow an outside edit and refuse a stale editor write with a reload offer |
| H27 | A (migrated) | migrate an old drawing to `@3`, import both versions and forget them without deleting repository files |
| H28 | — | preview and download an image for every destination in both themes and keep the drawing untouched |
| H29 | A (migrated) | use a local drawing while forged writes are refused, and find the plugin manifests and launcher in place |
| H30 | H (0.3, changed) | expand a quick ask, pick a test model, follow progress and undo the reported change; progress lines asserted in order, as H24 |
| H31 | — | retry failed and cancelled changes with the same text, model and selection |
| H32 | — | move and align just one part and warn once for a move outside selected parts |
| H33 | — | record exact changes for add, rename, hold, move and remove and reject invalid scopes without edits |
| H34 | — | fade detail at distance while keeping the open part lit and every shape and export unchanged |
| H35 | — | reach a detail view from the views menu, the part that holds it, the breadcrumb and a link; search lights matches and dims the rest, steps with Enter, lists other views, ends with Escape, and never edits the file |
| H36 | — | pin explanations beside the canvas and keep editing controls reachable in a narrow header |
| H38 | — | warn about text the image shortens and count it in the layout report beside the readability check |
| H39 | — | share the view as it is, keep keyboard focus inside sharing and call a drawing too wide to read too small in one plain sentence |
| H40 | — | rename from the callout, choose pictured forms and follow tool hints without accidental edits |
| H41 | E (0.3, changed) | open an example from an empty library (beside the folder start, no more empty-library help) and recover a registered file that became invalid |
| H44 | A (migrated) | accept lane hints in a session file, place what has no position by its place hint and leave positioned parts where they are |
| H63 | — | share a full ordinary view for three destinations with a wrapped caption and explicit clipping warning |
| H64 | A (migrated) | distinguish readable names from readable detail and report the level the measured sizes give |
| H84 | — | open a session file without positions: no overlap, no connection through a part or a group name |
| H85 | — | a sub-line the image shortens is drawn, listed and counted; after the user shortens it nothing is cut |
| H86 | — | ask for no change on a drawing with fixed positions: nothing moves and the layout report counts what the image draws |
| H87 | — | the editor and the exported image agree on every part size and connection path, also after the user moves a part |
| H88 | A | an `@2` file with a detail view and a LinkedIn post opens through the command and the editor and is read back as `@3`: facts, overview views, the LinkedIn view, the conversion warning, every id kept |
| H89 | A | `archdrawer migrate` takes an `@1` and an `@2` file to `@3`, leaves an `@3` file alone, refuses what is not a drawing, and an imported `@2` document is stored as `@3` |
| H90 | A, A (0.3, changed) | `validate` refuses each broken `@3` rule with its path and message, lists every violation with the count, writes nothing, and a missing repository path only warns on `open`; a README with one view is valid from 0.3, with two it is not |
| H91 | A | `svg --channel`, `export.svg?channel=`, `export.mmd?channel=` and a request with a channel: defaults, the named channel's own view, every refusal |
| H92 | B | a rename in the overview shows through the fact in a LinkedIn part with no mark, and marks the LinkedIn channel where a part keeps its own name |
| H93 | B | adding and deleting a part and a connection in the overview change the facts; LinkedIn is marked and keeps its drawing, apart from the part whose only fact is gone |
| H94 | B | moving, a form and the steps switch mark nothing; content edits mark; undo, redo and a reload keep the marks with the edits |
| H95 | B | a session that edits the facts in the file marks the channel it did not redraw, by the same rules, and the editor follows |
| H96 | C | four tabs in order, the current one, the marks with their counts, Keep as it is emptying a mark as one undoable edit |
| H97 | C, F (0.3, changed) | a channel with no drawing shows its stage with tools and Share disabled; switching tabs edits nothing; from 0.3 the README stage says it is not drawn yet and offers Draw it |
| H98 | C, F (0.3, changed) | the address names channel and view and survives a reload, an old `?view=` link opens the channel holding it, and the tabs live in the narrow header menu |
| H99 | D | with no engine the LinkedIn tab prepares the simple version from the overview as one undoable edit, pointing at the same facts |
| H100 | D | Design the post draws the LinkedIn channel from the facts with the fixture engine; Share packages it for the LinkedIn feed |
| H101 | D | a rename in the LinkedIn channel is its own name and leaves the overview alone, a description corrects the fact, deleting a part keeps the fact |
| H102 | E | an empty LinkedIn channel is drawn with Draw it, switching channel starts no run, one undo step takes the drawing away |
| H103 | E | Redraw it draws an outdated LinkedIn channel again from the facts, empties its marks and is one undo step |
| H104 | F | a fixture refine in the overview corrects the facts, reaches a LinkedIn part through the fact and marks only the part that keeps its own name |
| H105 | F | a refine on the LinkedIn channel with a scope changes only that channel; simplify rearranges the overview without losing a fact and refuses another channel |
| H106 | A (0.3) | a file with mechanisms, limits, evidence, held rows, a README view and a presentation with steps is valid, opens unchanged and saves through the server |
| H107 | A (0.3) | `validate` refuses each broken rule 20–24 and the changed rules 5, 6, 8 and 16 with the documented path, writes nothing, and the server refuses the same file and the same save |
| H108 | A (0.3) | a drawing written before 0.3 stays valid, opens and converts without gaining a mechanism, limit, evidence or step, and an editor edit adds none |
| H109 | A (0.3) | the README and presentation images draw the held mechanisms and the limit as rows, count them in the panel's height, and never draw a mechanism as a part |
| H110 | B (0.3) | a scan answers the card and the focus options backed by the folder's files, leaves out the option whose file is missing, and writes nothing into the project |
| H111 | B (0.3) | a second scan of the same commit answers at once from the cache, refresh scans again, a new commit is scanned again |
| H112 | B (0.3) | a folder outside git or a repository with no commit is never cached; the folder check names git and an existing drawing |
| H113 | B (0.3) | every folder sentence, the order of the scan checks, a failed scan, a cancelled slow scan and the 409 leave nothing cached |
| H114 | D (0.3) | a tuning number is warned about on the LinkedIn view only, and the layout report carries count targets on LinkedIn and none elsewhere |
| H115 | D (0.3) | a 24-part overview gets no size warning, no overview suggestion and no count targets, and Simplify the overview still folds it without losing a fact |
| H116 | D (0.3) | a story run redraws the LinkedIn channel from the facts like a post run, empties its marks, touches nothing else, and a wrong story request is refused |
| H117 | C (0.3) | a draw run reads facts with checked evidence, drops what the files do not back (the four warnings), draws every fact in the overview and each of the three channels, and writes one new file |
| H118 | C (0.3) | a draw takes the next free file name up to 99 and replaces nothing, one kept scan serves several draws, a subfolder is drawn under its own docs folder with paths from the root, and a folder outside git (also a subfolder of one) is its own root |
| H119 | C (0.3) | a draw that fails at the read, overview or channel, is cancelled, or cannot write its file (`docs` is a file, every name taken) writes and registers nothing; a left-out fact is added with one warning; the 409 |
| H120 | C (0.3) | a draw request is refused in the contracted order: scan, the scan's folder checked again, focus, option, text, channel, model, engine; `draw` stays a known run kind |
| H121 | E (0.3) | folder, card, focus, LinkedIn, draw and the editor on LinkedIn, offered the drawing the folder already holds first |
| H122 | E (0.3) | wrong folders get one sentence and start nothing, a scanned commit shows its card at once and can be scanned again, a typed focus is drawn from the keyboard |
| H123 | E (0.3) | a failed draw keeps every choice and Try again repeats the request; with no engine the screen says what to install and offers the example |
| H124 | F (0.3) | Draw it on the README tab is one undo step with the held rows drawn; a reworded limit it shows marks nothing, a new limit or a new fact marks it, Keep as it is and Redraw it each clear the mark in one undoable step; Share defaults to README |
| H125 | F (0.3) | with no engine the README tab prepares the overview as the simple version, and editing the README splits between the facts and itself like any channel |
| H126 | G (0.3) | Draw it on the Presentation tab keeps the fixture's three steps and drops the fourth with one warning; choosing, stepping and leaving a step light and dim parts, never resizing or editing; Share defaults to the slide |
| H127 | G (0.3) | text, note, parts, order, adding and removing a step are each undoable and touch only the presentation; deleting a part a step names takes it out of the steps with a warning |
| H128 | G (0.3) | with no engine the presentation is prepared with a step per numbered connection (or one step for the whole), and Redraw it makes it again as one undoable edit |
| H129 | H (0.3) | an instruction goes to the facts or the channel story, in the record and the done event, marks other channels only on the facts route, a parts scope skips the question, and a story's format follows its channel (README `readme`, presentation `slide`, any other refused) |
| H130 | H (0.3) | the AI panel and the ask box say which way an instruction went; a story on the overview may change only appearance (a move is observed; a renamed or new part is ignored with a warning); a selection of parts always changes the facts |

## Requirement map

| Requirement | Scenarios | Evidence and limit |
|---|---|---|
| START-1 | H29 | The plugin manifests and the `archdrawer` launcher exist and parse. Only static packaging; the plugin's command opening the app is not observable. |
| START-2 | — | To build. |
| START-3 | H123 | With no engine the screen says `To draw a project, install Claude Code or Codex and sign in to it.` with both install commands (H123). Limit: signed out or too old are not observable with the fixture, which is always available. |
| START-4 | H41, H110–H113, H117–H123 | The folder start: the field with the library's folders, the folder check, the card and options, the focus, the channel, the draw with its stages, the offer of an existing drawing, the keyboard path, a failed draw, no engine. Fixture engine only. |
| START-5 | H15, H16, H17, H25, H27, H41, H44, H84, H88, H89, H90, H91, H106–H109, H123 | `validate`, `open`, `svg` (with `--channel`), `migrate` (`@1`, `@2`, `@3`), `status`, `stop`: exit codes, output lines, same id and URL on reopen, nothing written by `validate`, the path and message of every `@3` violation, the 0.3 rules (H107). |
| SCAN-1 | H110, H111, H112, H113, H121 | A scan reads the folder in code (listing from git or a walk that skips `node_modules` and its kin, the files named by the dependency files) and answers a card. The size budget and the README and dependency-file reading are not observable from the fixture's answer. |
| SCAN-2 | H110, H121 | Options of the three kinds, each with title, sentence and files; the option whose file is missing is left out with one warning; fewer than three is a success; paths are relative to the repository root. Limit: "3–5 options" depends on the engine; the fixture gives three. |
| SCAN-3 | H110, H120, H121, H122 | "The whole system" and a typed focus are never options, always offered, and accepted by the draw. |
| SCAN-4 | H111, H112, H113, H122 | Cached per commit (cache file count, `cached: true`, `Scanned before at`), the same entry for a tree with uncommitted changes, `refresh`, a new commit, a folder outside git or without a commit never cached, a failed or cancelled scan caches nothing. |
| READ-1 | H117, H119, H121, H123 | After a focus the read returns components, mechanisms, relations and a limit; a failure at the read, overview or channel writes nothing. Limit: what a real engine reads is not observable; the facts are the fixture's. |
| READ-2 | H106, H107, H117, H118 | Every fact in a draw carries evidence, `files` are the evidence files, evidence that points nowhere is dropped with the contracted warnings and a fact left with none goes, with what depended on it. In a file only paths are checked. |
| READ-3 | H117 | The agent's loop is five mechanisms within the agent, the check around execution a gate, wherever the fixture answers it. Whether a real engine asks for the loop only when the card says `agent` is not observable. |
| STORY-1 | H97, H102, H103, H116, H117, H119, H120, H121, H122, H124, H125, H126, H128 | A channel is chosen after the focus and drawn from the facts without reading again, on its own tab, as one undoable step; switching channel starts no run. |
| STORY-2 | H114, H116 | LinkedIn: no held items or limits on the post, no tuning-number warning outside it, count targets only on it. Limit: "about 8–12 parts", a title of nine words and readability on a phone are the model's work and not observable. |
| STORY-3 | H106, H109, H124, H125 | The README is a drawing of its own that holds held mechanisms and limits as rows, counted in the panel's height. Limit: "one-line descriptions" and "held items only on the few parts that matter" are the model's choice. |
| STORY-4 | H106, H107, H126, H127, H128 | The presentation is one drawing and ordered steps with a text and a note each; steps are lit and dimmed in the editor, edited, reordered, undone, and follow a deleted part. Full-screen presenting is PRES-1, not built. |
| STORY-5 | H16, H106, H107, H109, H114, H124 | A number that explains a guarantee (`Stops after 12 turns`) is a limit fact drawn as a row outside LinkedIn and is no warning there. |
| STORY-6 | H114, H115, H116, H119, H129, H130 | The overview has no caps, no count targets, no size warning and no suggestion; Simplify stays. Limit: that the model decides what to draw and its rough place has no contract surface the fixture can exercise. |
| LAYOUT-1 | H15, H17, H24, H28, H32, H34, H44, H63, H84, H86, H87, H109 | Parts are placed once and keep their place, sizes follow the contracted geometry (a panel's rows included, H109), and editor, preview, download and `archdrawer svg` draw the same numbers. Limit: sizes and path equality are measured at 0.3 drawing px. |
| LAYOUT-2 | H84, H86 | No connection enters a part it does not join or a group's name (H84); a connection that cannot avoid a stored part is listed, not hidden (H86). Limit: one laid-out system and one stored-position fixture. |
| LAYOUT-3 | H28, H38, H39, H63, H64, H85, H86, H114, H115 | The report counts parts, zones, connections, cut text, crossings and connections over parts; its numbers equal an independent measurement of the exported image (H86); count targets only on LinkedIn (H114, H115). |
| LAYOUT-4 | — | To build. |
| LOOK-1 | H20, H36, H41 | Light and dark themes switch, persist and keep the library legible at the contracted contrast. No judgement of style. |
| LOOK-2 | — | To build. |
| LOOK-3 | — | See *Not covered*. |
| FILE-1 | H15, H16, H18, H19, H20, H21, H22, H23, H24, H25, H26, H27, H30, H35, H36, H40, H41, H88, H90, H94, H95, H97, H108, H118 | The drawing is one file; edits are saved into it; an outside edit is followed; reloads show the stored state; a channel or view change writes nothing (H97); an older file gains no new field (H108); a draw writes one new file and never overwrites, whatever sits at a name, and a draw whose file cannot be written leaves the folder as it was (H118, H119). |
| FILE-2 | H15, H16, H27, H88, H89, H90, H91, H92, H93, H96, H99, H100, H104, H105, H106, H107, H108, H109, H126 | The file holds the facts and one drawing per channel: the shape and its defaults, every validity rule's path, `@2` and `@1` read as `@3`, channel on exports and requests, parts that point at facts; from 0.3 mechanisms, limits, evidence, held rows, a README view, a presentation view with steps (H106–H109). Limit: how an `@2` post must look to be valid `@2` is no longer in the contracts (see *Contract gaps*). |
| FILE-3 | H92, H93, H94, H95, H101, H103, H104, H105, H108, H115, H124, H125, H127, H128, H129 | A rename or a new part in the overview reaches the facts and every channel that draws them; `outdated` is marked exactly for a new fact, a deleted fact or relation, a relation between two shown facts, and a field a part keeps its own text for; never for the current channel or an empty one; undo restores the marks. A session's write is split the same way (H95). Steps and a README rename are appearance (H125, H127). The routes of a refine mark or do not mark by the same rules (H129). |
| EDIT-1 | H18, H19, H20, H21, H22, H23, H30, H31, H32, H36, H40, H85, H87, H92, H93, H94, H96, H99, H101, H103, H125, H127, H128 | Move, rename in place, add by kind and form, connect by dragging, free text, undo and redo across views and channels, now also steps. |
| EDIT-2 | H18, H22, H34, H36, H40 | The callout shows purpose, connections and files and edits them. |
| EDIT-3 | H26 | A stale save shows the conflict and the reload offer, never `Saved`. Limit: an unwritable folder is exercised only on POSIX. |
| EDIT-4 | H30, H130 | A drag during a run is refused with the contracted toast and moves nothing. |
| AI-1 | H24, H25, H30, H31, H32, H33, H44, H86, H100, H102, H104, H105, H115, H116, H129, H130 | The instruction acts on the view, the selected parts or the whole channel through a chosen engine and model; failure, cancel, retry, undo, a concurrent session edit, the channel a run names, and a `story` run. Only the fixture engine runs. |
| AI-2 | — | See *Not covered*. |
| AI-3, AI-4 | — | To build. |
| AI-5 | H129, H130 | An instruction is routed to the facts or the channel's story: `route` in the record and `done`, the progress sentences, `ai-route` and the toast, marks only on the facts route, a story on the overview changes appearance only, a `parts` scope is the facts (its route line shown too), a simplify run shows no `ai-route`. Limit: the routing question's answer is the fixture's marker, given at once with no progress line and acted on by no other marker; how a real engine decides is not observable, and that `ai-route` goes when another run starts is not asserted. |
| NAV-1 | H20, H35, H98 | A part opens its inside, detail views nest, a view is reachable from the menu, the breadcrumb and a link, a search result opens its view, and the address keeps the view across a reload. |
| NAV-2 | H96, H97, H98, H99, H101, H102, H126, H127 | Four tabs in the contracted order with the current one, marks with their counts and accessible names, Keep as it is, the stages of an empty channel with the tools off, the breadcrumb and views menu in the overview only, the address with channel and view, an old `?view=` link, the narrow header; the steps panel on the presentation tab. |
| NAV-3 | H35 | Slash and the search button open search; `data-match` and `data-dim` while typing, the count texts, Enter / Shift+Enter with wrap, no part resized and no view move while typing, a match in another view, Escape ending the highlight, and the file untouched. Limit: the order of matches is not pinned; Ctrl/Cmd+K and the 50-result cap are not exercised. |
| NAV-4 | — | To build. |
| PRES-1 – PRES-3 | — | To build (0.5). |
| SHARE-1 | H15, H23, H28, H38, H63, H85, H87, H91, H100, H109 | PNG and SVG at twice the size, copy, light and dark, all four sizes, no product mark, real text, the same image from preview, download, HTTP and the command, for a named channel, now also README and presentation images (H109). |
| SHARE-2 | H39, H100, H124, H125, H126 | The modal keeps focus, closes back to its button, and carries preview, report and meter, and downloads; none of the old simplify and share-one-part controls. On the LinkedIn channel the dialog defaults to the feed, on the README channel to the README size, on the presentation to the slide, each with that channel's own view. |
| SHARE-3 | H39, H64 | The `readability` line is the contracted one-sentence wording for its level and destination, with no digit. |
| SAFE-1 | H25, H29 | Text typed into an instruction is data, and model names that look like options or shell words are refused. Folder and scan checks refuse a malformed model the same way (H113, H120). |
| SAFE-2 | — | See *Not covered*. |
| SAFE-3 | H29 | Foreign host and origin, missing or wrong token, loopback only (H113 and H120 also refuse a scan and a draw without the token). |
| SAFE-4 | H29 | A whole browser journey makes no request outside the local server. |
| SAFE-5 | — | See *Not covered*. |
| QUAL-1 | — | To build. |
| QUAL-2 | H64, H84, H85 | Readability levels follow the contracted thresholds (H64); no connection over a part (H84); no cut text and an empty crossing and over-part count on a fixed drawing (H85). Limit: nothing here checks a pipeline output of an agent, API or full-stack project. |
| QUAL-3 | — | To build. |

## Not covered

**To build** (nothing to observe yet): START-2, LAYOUT-4, LOOK-2, AI-3, AI-4,
NAV-4, PRES-1 to PRES-3, QUAL-1, QUAL-3.

**Today or changing, but not observable from the contracts** (a contract gap):

- START-3: signed out or too old are not observable (the fixture engine is
  always available); only the no-engine sentence is (H123).
- SAFE-2: engines are spawned by the product with an argument array and read-only
  tools; the fixture engine replaces that call, so the arguments are not
  observable. The same holds for the scan's "no tools" and a story's `readCode`
  (the request body is observed, what the engine was allowed to do is not).
- SAFE-5: the suite runs on one operating system and one Node; no surface
  names the platform differences.
- STORY-6, STORY-2, STORY-3: what the model decides to draw and where it places it,
  and whether a real engine's post has about 8–12 parts, has no numbers, or keeps its
  descriptions to one line, have no contract surface the fixture engine can exercise.
- SCAN-1, READ-1, READ-3: that the scan prompt quotes its inputs within the budget,
  that the read treats the repository as data, and that a real engine asks for the
  agent loop only for an `agent` card, are prompt contents, not observable.

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

## Contract gaps found while writing the 0.3 scenarios

- **A fixture marker in a folder name on Windows.** The scan's markers
  (`[fixture:fail]`, `[fixture:slow]`) are read from the folder's last path segment,
  and `:` cannot be in a Windows folder name. H113 and H120 create such a folder
  only off Windows and keep the rest of their journey on Windows. A draw's markers
  travel in the typed focus, so every draw scenario runs everywhere. If the markers
  should work on Windows, the contract needs another carrier for a scan.
- **The draw body and the folder.** *Folders* says a draw run takes `folder`; *The
  draw run* shows a body without it (the scan names the folder). The scenarios send
  no folder and read the folder from the scan.
- **The listing's order.** "Sorted order" is not a collation. The project the
  scenarios scan has lower-case ASCII names that sort the same under any collation
  (`alpha.ts`, `beta.ts`, `gamma.ts`, `main.ts`), and the one test of a git-ignored
  file ignores through `.git/info/exclude`, so no dot-file enters the listing.
- **Entry points of the card.** `entryPoints` is "the first two candidates"; whether a
  file named both by name and by `package.json` appears once is not stated, so H110
  asserts that `main.ts` is there and that there are at most two.
- **The scan's `commit`.** Full or short is not stated; H110 and H111 accept either
  (the `Scanned before at` text must be a prefix of the real commit).
- **Warning wording.** The contract names the draw's four evidence warnings and a left-out
  fact's warning exactly, and nothing else. The missing-file option's warning is
  matched on its file name or title (H110); an ignored story change on the overview
  is counted, not read (`>= 1`, H129); the warning of the dropped `ghost-part` step is
  counted (one, H126); the step cascade's warning is exact (H127, from the contract).
- **The overview story's parts order.** The LinkedIn story's `facts` are taken "at the
  same index" of the overview's first view, whose order (zones first or last) the
  contract does not fix, so the draw scenarios (H117, H119) assert the LinkedIn
  view's part ids and the README's and presentation's from the overview, not the
  LinkedIn parts' facts.
- **Where a fact's evidence starts.** The fixture's `A` evidence is "A" with no lines
  stated; the scenarios assert the evidence file for `app` and `store`, the lines only
  where the contract gives them (`[1, 1]`).
- **Routing and the fixture's progress lines.** The fixture answers the routing
  question at once and adds no progress line, and no marker (`[fixture:slow]`,
  `[fixture:fail]`, …) acts on it; the route line comes after any engine lines of the
  question, before the refine's own. H24 and H30 (changed in batch H) still assert the
  refine's lines in order and at least once instead of exactly once, which holds with
  or without engine lines for the question. Their `[fixture:slow]`, `[fixture:fail]` and
  `[fixture:invalid]` instructions act on the refine, not the question.
- **Revision 4 (the scan cache and `ai-route`).** The latest succeeded scan of a folder is
  kept: a newer success forgets every earlier finished scan of it, a newer failure or
  cancel only the earlier failed and cancelled ones. No scenario of C-H scans a folder
  again after a success and then fails or cancels it (the failing and cancelled scans of
  H120 are of folders of their own, the cached and refreshed scans of H122 both
  succeed), so only B's cache scenarios could observe the difference. That `ai-route`
  goes when another run starts is not asserted; H130 asserts only that a simplify run
  shows none. The `readCode: false` wording change (the request carries it) and the
  overview's `callout-create-inside` condition touch no scenario.
- **The layout report line with targets.** The example line shows `8 parts / 12`; the
  scenarios read it as "a target is printed only where one exists" (H115 expects no
  `parts / n` on the overview). The line's exact text is otherwise not pinned.
- **The start flow after an error.** `draw-start` is read as always present once a
  focus and a channel are chosen, so changing one choice after a failed draw and
  pressing it again starts a new run (H123). That the radios of a group are separate
  Tab stops is not assumed: the keyboard path in H122 Tabs to the channel group and
  chooses with Space.
- **Where the current step stands.** After Draw it, or before any choice, no step is
  asserted current; `step-add` is tested after a chosen step only.
- **Revision 1 (contracts changed after the first draft).** Left unasserted on purpose:
  that a name taken a moment before the write is still not replaced (a race with no
  surface), that a draw whose registering fails removes its file (no way to make the
  registering fail), that removing a mechanism's last held row in the overview deletes
  it (the ui contract names no control for removing a row), what a failed draw leaves
  of its temporary file beyond "writes nothing" (H119 reads the folder's listing), and
  whether `gitWithoutCommit` folders or a `.git` above the root count as outside git
  for a draw (only the folder check and the scan cache observe it, in B).
- **Mechanism rows in the editor.** Whether a mechanism or limit row carries
  `node-item` is not stated, so the editor scenarios read the rows as text of the part
  (`toContainText`) and the image scenarios as text of the exported node.
