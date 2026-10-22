# Held-out coverage

The suite has 149 scenarios. A requirement id appears in a scenario title only
when the scenario observes it; an id the spec marks *To build* appears only
once a step has built something to observe (the 0.3 round: START-4, SCAN-1 to
SCAN-4, READ-1 to READ-3, STORY-2 to STORY-5 and AI-5, with STORY-1 and
STORY-6 changed; the 0.4 round: LOOK-2, AI-3, AI-4 and LAYOUT-4, with LOOK-3 and
AI-2 changed; the story-limits round: STORY-7 and START-6; the ADR 0011 round:
LAYOUT-2 changed; the 0.5 round, ADR 0012: PRES-1, PRES-2 and PRES-3, which
`spec.md` keeps as *To build* until the integration marks them Today, so
`author-check.mjs` lets a title carry them as `landing`). Ids are the
requirement ids of the product spec.

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

The 0.4 batches. 0.4 is built by two lanes at the same time, on two branches merged at the end; each
lane runs only its own batches until then, and every file also passes after the merge:

| Batch | Lane | Lands with | Scenarios |
|---|---|---|---|
| 0-helpers (0.4) | both | the first commit of each lane | `helpers.ts` (the 0.4 helpers, nothing above them changed); `helpers-svg-parity.ts` is unchanged |
| A-shapes | look | #75, shapes by kind | H131–H133 |
| B-held | look | #76, no *No held items* warning | H16 (changed), H134 |
| C-conversation | ai | #77, the one AI conversation | H24, H25, H30, H31, H97 (changed), H135–H137 |
| D-preview | ai | #78, the previewed result | H32, H102, H103, H124, H126 (changed), H138–H140 |
| E-suggestions | ai | #79, suggestions | H115, H130 (changed; H130 renamed), H141, H142 |
| F-second-look | ai | #80, the second look | H116, H120 (changed), H143, H144 |
| Z-index (0.4) | last | the merge | `COVERAGE.md`, `verify.json`, `README.md`, `author-check.mjs` |

The story-limits round (ADRs 0009 and 0010) is one batch:

| Batch | Lands with | Scenarios |
|---|---|---|
| story-limits | the repair turn of a story answer (STORY-7) and a failed draw that keeps its read (START-6) | H145–H151 (new); `COVERAGE.md`, `verify.json`, `README.md`. No helper and no earlier scenario changed |
| story-limits-2 | the same two requirements, the contract sentences H145–H151 left unobserved (issue #97) | H154–H157 (new); `COVERAGE.md`, `verify.json`, `README.md`. No helper, no `author-check.mjs` and no earlier scenario changed |

The ADR 0011 round (connections pass behind parts) is one batch:

| Batch | Lands with | Scenarios |
|---|---|---|
| edges-behind | one cubic per connection, behind parts, a group's name cut out, a post's hidden spine line turned out (LAYOUT-2) | H84, H86 (rewritten), H152, H153 (new); `helpers-svg-parity.ts` (helpers added, none changed), `COVERAGE.md`, `verify.json`, `README.md`. H85 and every other scenario unchanged |

The 0.5 round (ADR 0012: the slide image, presenting, the tour and the slide exports). 0.5 is built by two lanes at the same time,
on two branches merged at the end; each lane runs only its own batches until then, and every file also passes after the merge. The
present lane has no `download-slides-*`; the share lane has no `present`, `present-*` or `tour-*`. Its scenarios are numbered from
H158, after the story-limits round's H154–H157:

| Batch | Lane | Lands with | Scenarios |
|---|---|---|---|
| 0-helpers (0.5) | both | the first commit of each lane | `helpers.ts` (the 0.5 helpers, nothing above them changed); `helpers-svg-parity.ts` is unchanged |
| A-present | present | #110, presenting (PRES-1) | H158–H161 |
| B-tour | present | #111, the tour (PRES-2) | H162, H163 |
| C-slides | share | #112, the slide exports (PRES-3) | H164–H166 |
| Z-index (0.5) | last | the merge | `COVERAGE.md`, `verify.json`, `README.md`, `author-check.mjs` |

No earlier scenario changed in 0.5: none of them asserted an exact list of header controls (H36 and H98 look at the narrow header menu
and at buttons with no text on the overview and other channels, where `present-start` and `tour-start` are not), a count of the
buttons in `share-actions` (H28, H38, H39, H63 and H115 look up controls by test id), the absence of a presenting control, or a toast
after an outside change while a layer is open (H26, H95, H140 are on the overview and the editor, with no layer).

H100 (Design the post) is unchanged: its result now arrives as a preview, and nothing it does afterwards (the share dialog, the tabs)
is refused by one. H137 (batch C) also asserts `ai-look-again` is off with no engine, which only the ai lane's finished product has.

The ADR 0013–0015 round (calm connections and a steady drag, an outline per kind and no rows on the canvas, choices, sections and
flows, the system map; `archdraw/diagram@4`). It is written by three independent authors and indexed by a third pass. Its
scenarios are numbered H167–H184 (drawing) and H190–H208 (selections); H185–H189 and H209–H214 are unused. A title of the round
reads `H<nn> [IDS #issue …] journey`: the requirement ids, then the build issues the scenario accepts (`ISSUES-drawing.md`,
`ISSUES-selections.md`), separated by spaces; every scenario from H167 on names at least one issue:

| Batch | Lands with | Scenarios |
|---|---|---|
| D-drawing | #164–#168, #170–#172, #174–#177, #184, #186, #44 | H167–H184 (new); H17–H19, H28, H31, H33, H34, H39, H40, H63, H64, H87, H94, H95, H100, H109, H124, H131–H133, H152 (changed; H109, H131, H132, H152 renamed); `helpers-drawing.ts` (new; nothing in `helpers.ts` or `helpers-svg-parity.ts` changed by it) |
| S-selections | #180–#185 | H190–H208 (new); H15, H16, H27, H35, H88, H89, H90, H96, H106, H107, H110, H117–H123, H148–H151, H156, H157 (changed); `helpers-selections.ts` (new) |
| Z-index (round) | last | `helpers.ts` (the readers read a `@4` file as its first choice in the `@3` shape; `flattenChoice`, `readStoredRaw`, `getStoredRaw` added, nothing removed); H108, H114, H115, H131 (changed); `COVERAGE.md`, `verify.json`, `README.md`, `author-check.mjs` |

Why the readers moved: once the product has opened a drawing, the stored and the served file is `archdraw/diagram@4` and `facts` and
`channels` are inside `choices[…]`. About eighty older scenarios read a stored drawing through `readDocument`, `readDrawing`,
`getDocument`, `persisted`, `persistedDoc` and `sessionWrite` and ask for "the overview channel" of it; on `@4` they read it from the
file's first choice, which for a converted `@3` file is its one choice `system`. They return it in the `@3` shape with `schema`
`archdraw/diagram@3` (so a document built from it can still be written by `outsideWrite` as a session that knows `@3` does), and the
requests of that choice without their `choice` key; `sessionWrite` on a `@4` file merges the change back into its first choice and
keeps the other choices and their requests. A scenario that asserts the format string of a file reads it with `readStoredRaw`.

## Scenarios

| Id | Lands in | Journey |
|---|---|---|
| H15 | A (migrated) | validate a session file, reopen the same editor and export it; the file is `@3` with the defaults per channel |
| H16 | A (migrated), D (0.3, changed), B-held (0.4, changed) | depth warnings permit a drawing but every broken field is reported, at its `@3` path, without repair; from 0.3 a tuning number outside LinkedIn is no warning and no size warning exists; from 0.4 six parts with no panel get no held items warning, so the three depth warnings remain |
| H17 | A (migrated) | a hinted system and nested loop render with matching export geometry and kept positions |
| H18 | — | explain a component and edit every field and held item without losing its neighbours |
| H19 | — | select and move connected parts, regroup them and undo a destructive edit |
| H20 | — | enter and create detail views and retain a hundred undo steps across views |
| H21 | — | choose kinds and forms at their destination, including a child in a group, and cancel safely |
| H22 | — | connect two parts, merge the return direction and edit the whole connection |
| H23 | — | type and resize free text, move a neighbouring part, share the text and undo its deletion |
| H24 | A (migrated), H (0.3, changed), C-conversation (0.4, changed) | apply and repair an instruction, undo it, cancel and protect a concurrent session edit; the progress lines of the refine are asserted in order, not by count, since a refine starts with the routing question's engine lines, if any, then its route line (`Changing the facts`), and the fixture's answer adds no line of its own; from 0.4 the result is a preview, kept before the ordinary undo, and the single-line instruction is typed in the AI panel and shows `Nothing changed` with no preview |
| H25 | A (migrated), C-conversation (0.4, changed) | a machine without engines saves a literal request, with its channel and view, for the next session and stops only its own server; from 0.4 it is typed in the AI panel and shows as a `saved` turn, which a reload empties |
| H26 | A (migrated) | save to the repository file, follow an outside edit and refuse a stale editor write with a reload offer |
| H27 | A (migrated) | migrate an old drawing to `@3`, import both versions and forget them without deleting repository files |
| H28 | — | preview and download an image for every destination in both themes and keep the drawing untouched |
| H29 | A (migrated) | use a local drawing while forged writes are refused, and find the plugin manifests and launcher in place |
| H30 | H (0.3, changed), C-conversation (0.4, changed; title changed) | pick a test model in the AI panel, follow progress, keep the previewed change and undo it; progress lines asserted in order, as H24; the engine note names the canned second look; the changed part stays lit until Accept |
| H31 | C-conversation (0.4, changed) | retry failed and cancelled changes with the same text, model and selection; one turn per run and its final state; the kept result is undone with the ordinary undo (the accepted turn's state is read before that undo, not after) |
| H32 | D-preview (0.4, changed) | move and align just one part and warn once for a move outside selected parts; each next run keeps the previous preview and the last result is kept before the undo |
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
| H84 | edges-behind (rewritten) | open a session file without positions: no overlap, every connection one `M … C …` cubic in the editor and the image, every label within 10 px of its curve, and the share dialog's connections-over-parts and crossings equal an independent measurement of the exported image (no part is required to be clear) |
| H85 | — | a sub-line the image shortens is drawn, listed and counted; after the user shortens it nothing is cut |
| H86 | edges-behind (rewritten) | ask for no change on a drawing with fixed positions: nothing moves, every connection is one cubic, a line through a part (`lr` through `wall`) is drawn under it and listed by the run's report and the share dialog exactly as an independent measurement of the image lists it, no group or end listed |
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
| H97 | C, F (0.3, changed), C-conversation (0.4, changed) | a channel with no drawing shows its stage with tools and Share disabled; switching tabs edits nothing; from 0.3 the README stage says it is not drawn yet and offers Draw it; from 0.4 there is no ask box; on a stage with no drawing `ai-button` still opens the AI panel, but `ai-send` (with text typed), the channel's suggestions and `ai-look-again` are disabled and nothing is sent, and they are enabled on the overview |
| H98 | C, F (0.3, changed) | the address names channel and view and survives a reload, an old `?view=` link opens the channel holding it, and the tabs live in the narrow header menu |
| H99 | D | with no engine the LinkedIn tab prepares the simple version from the overview as one undoable edit, pointing at the same facts |
| H100 | D | Design the post draws the LinkedIn channel from the facts with the fixture engine; Share packages it for the LinkedIn feed |
| H101 | D | a rename in the LinkedIn channel is its own name and leaves the overview alone, a description corrects the fact, deleting a part keeps the fact |
| H102 | E, D-preview (0.4, changed) | an empty LinkedIn channel is drawn with Draw it, switching channel starts no run, the drawing arrives as a preview and, kept, one undo step takes it away |
| H103 | E, D-preview (0.4, changed) | Redraw it draws an outdated LinkedIn channel again from the facts, empties its marks and, kept, is one undo step |
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
| H115 | D (0.3), E-suggestions (0.4, changed) | a 24-part overview gets no size warning, no overview suggestion and no count targets, and the fold (from 0.4 the `Simpler` suggestion) still folds it without losing a fact |
| H116 | D (0.3), F-second-look (0.4, changed) | a story run redraws the LinkedIn channel from the facts like a post run, empties its marks, touches nothing else, and a wrong story request is refused; the unknown-kind sentence names `revise` |
| H117 | C (0.3) | a draw run reads facts with checked evidence, drops what the files do not back (the four warnings), draws every fact in the overview and each of the three channels, and writes one new file |
| H118 | C (0.3) | a draw takes the next free file name up to 99 and replaces nothing, one kept scan serves several draws, a subfolder is drawn under its own docs folder with paths from the root, and a folder outside git (also a subfolder of one) is its own root |
| H119 | C (0.3) | a draw that fails at the read, overview or channel, is cancelled, or cannot write its file (`docs` is a file, every name taken) writes and registers nothing; a left-out fact is added with one warning; the 409 |
| H120 | C (0.3), F-second-look (0.4, changed) | a draw request is refused in the contracted order: scan, the scan's folder checked again, focus, option, text, channel, model, engine; `draw` stays a known run kind and the sentence for a wrong kind lists `revise` too |
| H121 | E (0.3) | folder, card, focus, LinkedIn, draw and the editor on LinkedIn, offered the drawing the folder already holds first |
| H122 | E (0.3) | wrong folders get one sentence and start nothing, a scanned commit shows its card at once and can be scanned again, a typed focus is drawn from the keyboard |
| H123 | E (0.3) | a failed draw keeps every choice and Try again repeats the request; with no engine the screen says what to install and offers the example |
| H124 | F (0.3), D-preview (0.4, changed) | Draw it on the README tab (a preview, kept before the undo) is one undo step with the held rows drawn; a reworded limit it shows marks nothing, a new limit or a new fact marks it, Keep as it is and Redraw it each clear the mark in one undoable step; Share defaults to README |
| H125 | F (0.3) | with no engine the README tab prepares the overview as the simple version, and editing the README splits between the facts and itself like any channel |
| H126 | G (0.3), D-preview (0.4, changed) | Draw it on the Presentation tab (a preview, kept before the steps are looked at) keeps the fixture's three steps and drops the fourth with one warning; choosing, stepping and leaving a step light and dim parts, never resizing or editing; Share defaults to the slide |
| H127 | G (0.3) | text, note, parts, order, adding and removing a step are each undoable and touch only the presentation; deleting a part a step names takes it out of the steps with a warning |
| H128 | G (0.3) | with no engine the presentation is prepared with a step per numbered connection (or one step for the whole), and Redraw it makes it again as one undoable edit |
| H129 | H (0.3) | an instruction goes to the facts or the channel story, in the record and the done event, marks other channels only on the facts route, a parts scope skips the question, and a story's format follows its channel (README `readme`, presentation `slide`, any other refused) |
| H130 | H (0.3), E-suggestions (0.4, changed; renamed `H130_the_ai_panel_says_which_way_an_instruction_went.spec.ts`) | the AI panel says which way an instruction went (and the preview carries the sentence); a story on the overview may change only appearance (a move is observed; a renamed or new part is ignored with a warning); a selection of parts always changes the facts; `Simpler` names no route |
| H131 | A-shapes | a card of each of the ten kinds and a compact of seven, a panel and a group: the five shaped kinds draw their `data-shape` in the editor and in the exported image, at the size of a plain part with the same text, light and dark, with no shape in the file |
| H132 | A-shapes | the picker's card and compact buttons are drawn in the chosen kind's shape; an added part wears it; changing the kind in the callout changes the outline and not the size or place; undo and redo; a panel is a card |
| H133 | A-shapes | a LinkedIn post draws the same shapes in its post style, in the editor and in the portrait and wide images, every card 176 × 84; a card-form `llm` part on the overview is an `agent`, only a `panel` is `card`; viewing it writes nothing |
| H134 | B-held | `validate` and `open` on six parts with no panel print no held items warning in any channel; Flat, No main path and Repeated label still show on the overview and the README at their paths, and LinkedIn is warned about none; a panel changes nothing |
| H135 | C-conversation | no ask box; the AI panel is closed on opening; Shift+Enter is a line break and Enter sends; a turn per run from `ai-send`, `channel-draw` and `explain-feed` with its text and where; summary, route and report on the latest turn only (the progress and Cancel are checked in H136, H141 and H144 on `[fixture:slow]` runs); an earlier turn keeps `ai-turn-result`; the thread is empty after a reload and nothing of it is in the file |
| H136 | C-conversation | a failed and a cancelled run are turns that keep their error; Try again adds a turn with the same request; the text comes back to the input; nothing is written until a run succeeds |
| H137 | C-conversation | with no engine the panel saves each instruction as a `saved` turn and a request with its channel and view, starts no run, takes shell-looking text as data, and the simple version of a channel is no turn; `ai-look-again` is off; a reload empties the thread |
| H138 | D-preview | a result is a preview that stays past the old 3 s with its part lit; a drag and a delete are refused with the toast; `tool-undo` and `tool-redo` are disabled and their keys (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y) show the same toast; the share dialog and zoom still work; Accept keeps it as one undo step; redo; edits go through again |
| H139 | D-preview | Undo on a preview returns to before the run and saves it (file and reload); redo brings the result back; a run that changes nothing shows no preview |
| H140 | D-preview | a new instruction accepts the preview first (and the first run is its own undo step); an outside change to the file and a reload each end a preview as accepted, and no result is lost |
| H141 | E-suggestions | each channel's suggestions and labels; each is a routed run that leaves the input alone (Show the loop: facts route, `Nothing changed`; Fewer details, Fewer steps, Shorter for LinkedIn: story route); disabled during a run; Simpler from a detail view goes to the first view and folds the overview without losing a fact |
| H142 | E-suggestions | with no engine a suggestion saves its instruction as a request for its channel and view and shows as a `saved` turn; no run, input and drawing left alone |
| H143 | F-second-look | the `revise` request is refused in order (format — only absent or the channel's default is accepted —, readCode, image missing / not a PNG / too large, image on another kind, instruction, scope, drawing, view, channel, engine, no drawing); on the overview one part moves 40 px, on README, LinkedIn and presentation the channel's story; `route` null; progress starts `Looking at the drawing`; a failure writes nothing |
| H144 | F-second-look | `ai-look-again` posts the view's PNG in the channel's default format at 1x with no old `revise` flag; the overview answer is `1 part moved` as a preview that Undo takes back; LinkedIn gets its story as a preview and the editor, once there, stays where the user goes next; off during a run and on a channel with no drawing |
| H145 | story-limits | a post and a README story whose first answer has an over-long description are repaired by the engine: saved with its own shorter text, `Fixing 1 problem in the answer` between the two check lines, no `Shortened` warning, the repair adding no warning |
| H146 | story-limits | with `[fixture:stubborn]` the over-long description is saved at 240 characters ending in `…` with exactly one `Shortened the description to 240 characters` warning, after one repair turn only, for a post and a README story; the run succeeds |
| H147 | story-limits | a post with a connection to `ghost` is saved without it after the repair turn; with `[fixture:stubborn]` too the run fails naming `The engine's LinkedIn post cannot be drawn:` and `ghost`, and the drawing file is byte for byte unchanged |
| H148 | story-limits | a draw from the home screen whose overview answer is over-long: one `Fixing 1 problem in the answer` with `stage: "overview"`, after the read and before the channel, a written drawing holding the engine's own overview description and no `Shortened` warning |
| H149 | story-limits | a draw failing at the channel stage writes nothing; `Try again` from the home screen makes no new scan or read (`Using the facts already read`, no engine lines in the read stage), reuses the overview, writes one drawing, and its warnings equal those of a draw of the same project that never failed |
| H150 | story-limits | a draw failing at the overview stage, then a draw with another channel: the read is reused, the overview is drawn by a call (engine lines, nothing reused), only that channel is drawn; after that success the next draw reads again |
| H151 | story-limits | a draw failing at the channel stage, a file the read cites deleted from the folder with no new scan, the same draw again: `Using the facts already read` then `Checking the facts`, no engine line in the read stage, the overview drawn by a call (no `Using the overview already drawn`), a written drawing whose facts no longer cite the deleted file (nor hold the facts only it backed), with a warning naming it; another focus with the same scan reads again |
| H152 | edges-behind | a connection level with a group's name, in the readme and the square image: the name is cut out of the line (no pixel differs from the same drawing without the line), the line is drawn left of the group, in it beyond the name and right of it, as one cubic with its label and badge, the report lists no part, and nothing moves |
| H153 | edges-behind | three stored parts in a column and a line from the first to the third: the overview draws it straight down behind the middle part, under it, and lists that part; the LinkedIn post turns it out on one side as one cubic clear of the part by 8 px with 24 px handles and lists nothing, its other two lines stay straight on facing sides, its label stays within 10 px, nothing moves |
| H154 | story-limits-2 | six draws that all fail at the channel, one scan: another model and then another focus (and the other model again) each read the code again (`Reading the code`, `Checking the facts`, overview drawn by a call, no `Using …` line); the same trimmed focus and model with another channel, twice, reuses the read and the overview with no engine line; nothing is written and nothing is registered |
| H155 | story-limits-2 | a post answer with two problems (`[fixture:invalid][fixture:overlong]`): one repair turn announced `Fixing 2 problems in the answer` right after the first check line, saved without `ghost` and with the engine's own description and no `Shortened` warning; with `[fixture:stubborn]` too, the same plural line once, the run fails naming the LinkedIn post and `ghost`, the file is as it was |
| H156 | story-limits-2 | a draw from the home screen whose overview answer stays over 240 characters after its repair turn (`[fixture:overlong][fixture:stubborn]`): one `Fixing 1 problem in the answer` in the overview stage and no second, an editor and no `draw-error`, the file written and registered, the overview lede 240 characters ending in `…` with exactly one `Shortened the description to 240 characters`, the read's four warnings first, the post not cut |
| H157 | story-limits-2 | a draw failing at the overview call, then `draw-retry` on the home screen: the screen is recorded; the read stage shows `running` with `Using the facts already read`, `done` once the overview is `running`, no stage starts before the one before is done, the overview is drawn by a call, the drawing opens and is written once with the four read warnings |
| H158 | A-present | `present-start` and `tour-start` exist on the presentation channel only, stay in the header at 820 px with their names and out of `header-menu`, are off with the title `Add a step first` with no drawing or no step; Present opens `present` in `present` mode on the opening slide in the drawing's theme (dark, then light after `tool-theme`) with focus on the layer and Tab held inside, asks for full screen and `data-fullscreen` agrees with `document.fullscreenElement`, the layer fills the window, the browser's own exit (when granted) or Escape leaves with focus on `present-start` and no step current; nothing saved and no run |
| H159 | A-present | Right, Down, Space, PageDown, Left, Up, PageUp, Home, End and a click on `present-slide` walk the opening slide and three steps, never past either end; `present-status` `Step <i> of <n>: <text>` and the caption title on the opening slide; the band's text (whole) and `<i> / <n>`; the opening slide dims nothing and has no band, a step slide dims the parts outside the step (a group even with a part in it lit), every edge unless both ends are in the step, and the text, with `data-dim` and `opacity` 0.25; boxes keep their shape; the hint goes with the first change and stays gone |
| H160 | A-present | `present-note-toggle` hidden on the opening slide and N doing nothing there, `aria-expanded` closed on entry, N or the button opens it, kept open or closed from step to step, the note with its newline or `No note for this step`; Space and Enter on the focused button toggle without moving; Escape, `Exit` and Enter on a focused `Exit` leave with focus on `present-start`, the step shown current and lit in the steps panel; Delete, Backspace, tool keys, `/`, Ctrl+K, Ctrl+Z and a click on another part's place reach nothing: selection, tool, search and file unchanged |
| H161 | A-present | an outside write while presenting redraws the slide with no `Updated from the file` toast (a text and a part's name; a reorder follows the step by its id; a removal shows the last step; a new caption on the opening slide which stays); no step left closes the layer with `The presentation has no steps any more` and turns the buttons off; with the layer closed the usual toast is back |
| H162 | B-tour | `tour-start` opens `tour` mode on the first step, `data-fullscreen` `false`, with no hint and no note button; `tour-note` with its newline or `No note for this step`; one `tour-part` per lit part in the order of the view's parts with `data-node-id` and label; `tour-file` text per path once, facts then held facts, a fact's files then its evidence files, ranges `:<from>–<to>` or `:<from>`, merged parts listing each path once; `No files recorded`; `tour-copy` copying the path alone with `Copied the path`; no write and no file check |
| H163 | B-tour | the tour's keys (no opening slide; N does nothing; Home first, End last) and a click on the slide, never past either end; `tour-panel` beside the slide at 1600 px and under it at 820 px with `tour-start` still in the header; `Exit` and Escape leave with focus on `tour-start` and the step shown current; nothing saved; then Tab and Shift+Tab stay inside the layer, and an outside write re-renders the slide shown, with no toast |
| H164 | C-slides | the share dialog on the presentation channel downloads `<slug>-slides.pdf` (`%PDF-1.4`, `%%EOF`, `/Count` 4, four pages of `/MediaBox [0 0 960 540]`, four 3840 × 2160 `DCTDecode` images starting `FF D8`) and `<slug>-slides.zip` (four stored entries `-slide-00.png` … `-03.png`, 3840 × 2160, checksums right) whose slides are the PDF's pages in the same order (decoded by the browser and matched); one file per click; `download-png` still gives the slide at twice the size; the drawing is untouched |
| H165 | C-slides | the dialog's theme reaches the zip and the PDF (light and dark differ slide by slide, a dark PDF is nearer the dark slides); the title off or the description on changes the opening slide and no other; texts off changes every slide; the square format keeps the entries and the 3840 × 2160 size and changes the slides through its toggles |
| H166 | C-slides | no slide download in the dialog of the overview, README or LinkedIn channel; an accented title with `!` is `creme-brulee-cafe`; eleven steps are twelve pages and entries `-00` to `-11`; one step is two; the last step removed turns both buttons off with `Add a step first` and nothing downloads, undo turns them on |
| H167 | D-drawing | dragging one part across a group keeps the other labels, badges and frames still, lifts the part and lights its own lines, and is saved once on release |
| H168 | D-drawing | a drop shows the group it would join while dragging, never covers another part, and stays exactly where it is released when it overlaps nothing |
| H169 | D-drawing | alignment guides and equal-gap marks snap a dragged part within 6 screen pixels, Alt turns snapping off, release moves nothing, and no export draws a guide |
| H170 | D-drawing | sides are held while a part is dragged, flip to the stateless choice on release, and the editor paths then equal the SVG export |
| H171 | D-drawing | connections are neutral until a part or line is hovered or selected or the line is numbered, and every export draws the same neutral lines in light and dark |
| H172 | D-drawing | a line that passes behind a part leaves a faint trace of itself over that part in the editor and the image, and a line that passes behind nothing leaves none |
| H173 | D-drawing | a label sits clear of every other line and on its own, in the editor and the image, and hovering a label lights its own connection without moving it |
| H174 | D-drawing | a connection leaves the next free side when its facing side is busy, close parts get handles that never leave the gap, ports in line give a straight line, and the arrowhead touches its part |
| H175 | D-drawing | three lines into one side from one direction share a trunk that is drawn once, lines from opposite directions or in another style do not, and the editor and the image agree |
| H176 | D-drawing | a part five parts use is marked used by 5 and its lines from them are not drawn but a step line is, the lines show on hover selection and drag, and the report counts only what is drawn |
| H177 | D-drawing | a group name sits on a halo and nothing is cut out of a line that crosses its header, and lines that enter a member from above come in right of the name |
| H178 | D-drawing | the layout orders the parts it places to cut crossings, closes empty columns, keeps place hints, step order and stored positions, and gives the same layout for the same file |
| H179 | D-drawing | every kind of part draws its own outline at its contracted box, in the editor and in the exported image, in light and dark, and a panel is a card of its kind |
| H180 | D-drawing | a panel draws no row in the editor or in any image, is as big as a card of its kind, and its callout lists and edits what it holds |
| H181 | D-drawing | the sub-line switch shrinks the parts of one view only, is one undoable saved edit that leaves no field when on, and the share image follows it unless show-sub says otherwise |
| H182 | D-drawing | a LinkedIn post sizes each card by its shape in the post style, a long label stops at three lines inside the box, and sub-lines off take 18 px from every card |
| H183 | D-drawing | the empty LinkedIn stage chooses the engine and model that Draw it uses, shares the choice with the AI panel both ways, goes off while a run is going, and is absent with no engine |
| H184 | D-drawing | a part with an inside draws the same open mark in the editor and in the exported image, on a card, a compact part, a panel and a group, and the mark changes no size |
| H190 | S-selections | a scan offers the project\ |
| H191 | S-selections | after a scan the home screen lists the whole system, the sections, the flows and something else as checkboxes, none ticked, each option with its title, sentence and files, and says so when the scan found no option |
| H192 | S-selections | tick the whole system, a section, a flow and your own words from the keyboard, choose the LinkedIn post, draw all four in one run, and land on the first choice with one file that holds them all |
| H193 | S-selections | a draw of several choices is refused with the first fault in the contracted order, a single focus still works as a list of one, and nothing is started or written |
| H194 | S-selections | one draw run of three choices lists them from the start, reads each in turn with events that name their choice, and writes one valid format 4 file with every choice, its overview and the README; ids are slugs |
| H195 | S-selections | a failure in the second choice writes nothing and keeps the first, the same draw again goes through the first without an engine call and starts at the second, and a draw without the failed choice reuses what was kept in any order |
| H196 | S-selections | a draw whose second choice fails shows the first done and the second failed, writes nothing and keeps every tick; Try again goes through the first without a new read and draws the second; a changed third choice reuses the first two |
| H197 | S-selections | cancelling a draw in its second choice shows the first done and the second cancelled, writes nothing, and the next draw reuses the first |
| H198 | S-selections | a format 3 file opens as one choice with every fact, view, request and mark as it was and no new warning, is written back as format 4 by migrate and by the server, draws exactly the same images, and an invalid one is not converted |
| H199 | S-selections | a file of four choices validates, opens, imports, saves and reopens; each broken rule is refused with its choice in the path; twelve choices are valid and thirteen are not; a fact in a detail view is drawn |
| H200 | S-selections | a move, a rename, a new part and the steps switch in one choice change that choice alone, the other choices stay byte for byte and unmarked, and undo walks back through the edits of every choice |
| H201 | S-selections | the image, the Mermaid text, the command, the share dialog, a saved request and a run each take the current choice: the default is the one that holds the view or else the first, and a wrong choice or a view of another choice is refused |
| H202 | S-selections | the whole system of a draw is a map of a part and a card that holds its inside in a detail view, every fact is on the map or in a detail view, a flow stays in one view, the map has its own report target, and the editor goes from the map into the inside and back |
| H203 | S-selections | a click without moving goes into a part with an inside and is no edit, a drag of the same part moves it and opens nothing, Shift+click selects it, and Enter on it opens it; a part with no inside still opens its callout |
| H204 | S-selections | a part with an inside draws the same open mark in the editor, the image and the command: 20 px, 8 px inside a card\ |
| H205 | S-selections | the views panel lists the whole system, the sections, the flows and the user\ |
| H206 | S-selections | the keyboard reaches every entry of the views panel in order, Up and Down do not wrap, Home and End, Enter and Space go to the view; the panel is 240 px beside a stage that narrows, folds to a 40 px strip that is remembered for every drawing, and is absent for one choice with one view |
| H207 | S-selections | below 900 px the views panel is in the header menu with the same entries, choosing one goes there and closes the menu, 900 px brings the panel back beside the stage, and the old views button exists at no width |
| H208 | S-selections | the address, the tabs and their marks, the crumbs, search and an instruction all follow the current choice, and an older link with only a view opens the choice that holds it |

## Requirement map

| Requirement | Scenarios | Evidence and limit |
|---|---|---|
| START-1 | H29 | The plugin manifests and the `archdrawer` launcher exist and parse. Only static packaging; the plugin's command opening the app is not observable. |
| START-2 | — | To build. |
| START-3 | H123 | With no engine the screen says `To draw a project, install Claude Code or Codex and sign in to it.` with both install commands (H123). Limit: signed out or too old are not observable with the fixture, which is always available. |
| START-4 | H41, H110–H113, H117–H123, H148, H149, H151, H154, H156, H157 | The folder start: the field with the library's folders, the folder check, the card and options, the focus, the channel, the draw with its stages, the offer of an existing drawing, the keyboard path, a failed draw, no engine. Fixture engine only. |
| START-5 | H15, H16, H17, H25, H27, H41, H44, H84, H88, H89, H90, H91, H106–H109, H123 | `validate`, `open`, `svg` (with `--channel`), `migrate` (`@1`, `@2`, `@3`), `status`, `stop`: exit codes, output lines, same id and URL on reopen, nothing written by `validate`, the path and message of every `@3` violation, the 0.3 rules (H107). |
| START-6 | H149, H150, H151, H154, H157 | A draw that fails after its read keeps it in memory only: a later draw with the same scan, focus, engine and model starts from the first stage that did not finish. After a channel-stage failure `Try again` shows `Using the facts already read`, `Checking the facts`, then `Drawing the overview` and `Using the overview already drawn`, makes no scan and no engine line before the channel, and its warnings equal a never-failed draw's (H149). After an overview-stage failure another channel reuses the read and draws the overview by a call (H150). A success removes what was kept: the next draw reads again (H150). The kept read answer's evidence is checked again against the folder as it is now, with no new commit or scan: a file the read cites, deleted after the failure, is dropped on `Try again` with the facts only it backed, the overview is then drawn by a call, and the drawing cites no deleted file; another focus with the same scan reads again (H151). Another model, and another focus, with the entry still standing after failed draws, read again (`Reading the code`, `Checking the facts`, the overview drawn by a call), while the same trimmed focus, engine and model with another channel reuses it, which pins the keys (H154). After an overview-stage failure `draw-retry` on the home screen shows the read stage `running` with `Using the facts already read`, then `done` once the overview starts, the overview drawn by a call, and the drawing opens (H157, the stage list recorded in the page). Limit: the one-hour expiry, another engine reading again (the fixture is the only engine), a cancel or timeout keeping the read, and the 409 of a second draw are not exercised (the expiry has no clock surface). |
| SCAN-1 | H110, H111, H112, H113, H121 | A scan reads the folder in code (listing from git or a walk that skips `node_modules` and its kin, the files named by the dependency files) and answers a card. The size budget and the README and dependency-file reading are not observable from the fixture's answer. |
| SCAN-2 | H110, H121 | Options of the three kinds, each with title, sentence and files; the option whose file is missing is left out with one warning; fewer than three is a success; paths are relative to the repository root. Limit: "3–5 options" depends on the engine; the fixture gives three. |
| SCAN-3 | H110, H120, H121, H122 | "The whole system" and a typed focus are never options, always offered, and accepted by the draw. |
| SCAN-4 | H111, H112, H113, H122 | Cached per commit (cache file count, `cached: true`, `Scanned before at`), the same entry for a tree with uncommitted changes, `refresh`, a new commit, a folder outside git or without a commit never cached, a failed or cancelled scan caches nothing. |
| READ-1 | H117, H119, H121, H123 | After a focus the read returns components, mechanisms, relations and a limit; a failure at the read, overview or channel writes nothing. Limit: what a real engine reads is not observable; the facts are the fixture's. |
| READ-2 | H106, H107, H117, H118, H151, H154, H157 | Every fact in a draw carries evidence, `files` are the evidence files, evidence that points nowhere is dropped with the contracted warnings and a fact left with none goes, with what depended on it; a kept read answer is checked again against the folder as it is (H151). In a file only paths are checked. |
| READ-3 | H117 | The agent's loop is five mechanisms within the agent, the check around execution a gate, wherever the fixture answers it. Whether a real engine asks for the loop only when the card says `agent` is not observable. |
| STORY-1 | H97, H102, H103, H116, H117, H119, H120, H121, H122, H124, H125, H126, H128 | A channel is chosen after the focus and drawn from the facts without reading again, on its own tab, as one undoable step; switching channel starts no run. |
| STORY-2 | H114, H116, H153 | LinkedIn: no held items or limits on the post, no tuning-number warning outside it, count targets only on it; the post style's own line rule for a hidden straight line (H153). Limit: "about 8–12 parts", a title of nine words and readability on a phone are the model's work and not observable. |
| STORY-3 | H106, H109, H124, H125 | The README is a drawing of its own that holds held mechanisms and limits as rows, counted in the panel's height. Limit: "one-line descriptions" and "held items only on the few parts that matter" are the model's choice. |
| STORY-4 | H106, H107, H126, H127, H128, H158–H166 | The presentation is one drawing and ordered steps with a text and a note each; steps are lit and dimmed in the editor, edited, reordered, undone, and follow a deleted part. Presenting, touring and exporting them as slides (PRES-1 to PRES-3) are listed under those ids. |
| STORY-5 | H16, H106, H107, H109, H114, H124 | A number that explains a guarantee (`Stops after 12 turns`) is a limit fact drawn as a row outside LinkedIn and is no warning there. |
| STORY-6 | H114, H115, H116, H119, H129, H130 | The overview has no caps, no count targets, no size warning and no suggestion; Simplify stays. Limit: that the model decides what to draw and its rough place has no contract surface the fixture can exercise. |
| STORY-7 | H145, H146, H147, H148, H155, H156 | A story answer with a problem gets one repair turn: `Fixing <n> problem(s) in the answer` between the two check lines (post and story, H145, H146, H147) or in the overview stage of a draw (H148); the engine's second answer is saved as it is, with no `Shortened` warning (H145, H148); a still over-long description is cut to 240 characters ending in `…` with exactly one `Shortened the description to 240 characters` warning and the run does not fail (H146); a violated relation is repaired by the engine's second answer or fails the run `The engine's LinkedIn post cannot be drawn: …` naming the connection, writing nothing (H147); two problems in one answer are one repair turn announced `Fixing 2 problems in the answer`, also with a stubborn engine, whose run then fails (H155); a draw whose overview answer stays over its limit after the repair turn is shortened with one warning and still writes and registers its drawing (H156). Limit: prompt wording and the schema's `maxLength` are not observable with the fixture; the other `Shortened <what>` forms, the 60-part relation, the presentation's empty-step and 20-step repairs, a revise's repair turn, a channel call's repair turn in a draw and the overview's failure message (no marker reaches them) are not exercised. |
| LAYOUT-1 | H15, H17, H24, H28, H32, H34, H44, H63, H84, H86, H87, H109 | Parts are placed once and keep their place, sizes follow the contracted geometry (a panel's rows included, H109), and editor, preview, download and `archdrawer svg` draw the same numbers. Limit: sizes and path equality are measured at 0.3 drawing px. |
| LAYOUT-2 | H84, H86, H152, H153 | ADR 0011. Every connection is one `M … C …` cubic, never an arc, a chain or a straight command, in the editor and the image (H84, H86, H152, H153); a connection that meets a part it does not join passes behind it, is drawn under it, and is listed in `edgesOverParts`, the run's report and the share dialog agreeing with an independent measurement of the exported image, and nothing a line passes behind is missing or invented (H84, H86, H153); a group's name is cut out of the line in two exported images and the line is drawn everywhere else (H152); in a post a straight line hidden behind the part between its ends turns out on one side as one cubic, clear of it by 8 px with 24 px handles, while the overview draws the same line behind the part (H153); labels lie within 10 px of their curve or are left out (H84, H153); stored positions never move (H84, H86, H152, H153). Limit: that code places parts without a stored position so lines clear them where it can (and the widening of gaps, at most three times) is not asserted, since no fixture makes the outcome certain; the cut-out of a group's name is measured by pixels in two exports, not in the editor; which side a post's line turns out on (right on a tie) and the 0.42 handle length are not asserted; the editor's hit area not being cut is not observable. |
| LAYOUT-3 | H28, H38, H39, H63, H64, H84, H85, H86, H114, H115, H152, H153 | The report counts parts, zones, connections, cut text, crossings and connections over parts; its numbers equal an independent measurement of the exported image (H84, H86, H152, H153); count targets only on LinkedIn (H114, H115). |
| LAYOUT-4 | H97, H143, H144 | The `revise` run: its request checks in their contracted order (format, `readCode`, image missing / not a PNG / too large, an image on another kind, instruction, scope, drawing, view, channel, engine, no drawing), the fixture's answers (the overview's first part 40 px right and nothing else; the channel's story elsewhere; a lone group changes nothing), `route` null, progress starting `Looking at the drawing`, a failed run writing nothing (H143); `ai-look-again` posting the view's PNG in the channel's default format at 1x, ending in a preview, off during a run and on an empty channel (H144), off with no engine (H137). Limit: that the image shows what the reader sees, that the revise folder under the data directory is made and removed, and what a real engine does with the picture are not observable with the fixture engine. |
| LOOK-1 | H20, H36, H41, H131, H158, H165 | Light and dark themes switch, persist and keep the library legible at the contracted contrast; the shapes are the same in both (H131). No judgement of style. |
| LOOK-2 | H131, H132, H133 | A card or compact part of kind `llm`, `actor`, `data`, `external` or `gate` names its outline in `data-shape` (`agent`, `person`, `store`, `external`, `check`), every other kind, a panel and a group as `card` / `card` / `group`; the same in the editor and in `export.svg`; no size or place changes with it, also in the post style; the picker's card and compact buttons show the chosen kind's shape; changing a kind in the callout changes the shape only. Limit: what the outlines look like (a second outline, a head badge, a cylinder, dashes, cut corners) is not observable from `data-shape`; the picker's panel and group buttons and the callout's form menu thumbnails are not asserted. |
| LOOK-3 | H16, H134 | A drawing of six or more parts with no panel gets no *No held items* warning from `validate` or `open`, also on the README, while Flat, No main path and Repeated label stay (H16, H134). Limit: that the briefs ask for a one-line sub-line and held mechanisms only where the story is about them is a prompt matter, not observable with the fixture engine. |
| FILE-1 | H15, H16, H18, H19, H20, H21, H22, H23, H24, H25, H26, H27, H30, H35, H36, H40, H41, H88, H90, H94, H95, H97, H108, H118, H161 | The drawing is one file; edits are saved into it; an outside edit is followed; reloads show the stored state; a channel or view change writes nothing (H97); an older file gains no new field (H108); a draw writes one new file and never overwrites, whatever sits at a name, and a draw whose file cannot be written leaves the folder as it was (H118, H119). |
| FILE-2 | H15, H16, H27, H88, H89, H90, H91, H92, H93, H96, H99, H100, H104, H105, H106, H107, H108, H109, H126, H162 | The file holds the facts and one drawing per channel: the shape and its defaults, every validity rule's path, `@2` and `@1` read as `@3`, channel on exports and requests, parts that point at facts; from 0.3 mechanisms, limits, evidence, held rows, a README view, a presentation view with steps (H106–H109). Limit: how an `@2` post must look to be valid `@2` is no longer in the contracts (see *Contract gaps*). |
| FILE-3 | H92, H93, H94, H95, H101, H103, H104, H105, H108, H115, H124, H125, H127, H128, H129 | A rename or a new part in the overview reaches the facts and every channel that draws them; `outdated` is marked exactly for a new fact, a deleted fact or relation, a relation between two shown facts, and a field a part keeps its own text for; never for the current channel or an empty one; undo restores the marks. A session's write is split the same way (H95). Steps and a README rename are appearance (H125, H127). The routes of a refine mark or do not mark by the same rules (H129). |
| EDIT-1 | H18, H19, H20, H21, H22, H23, H30, H31, H32, H36, H40, H85, H87, H92, H93, H94, H96, H99, H101, H103, H125, H127, H128, H160 | Move, rename in place, add by kind and form, connect by dragging, free text, undo and redo across views and channels, now also steps. |
| EDIT-2 | H18, H22, H34, H36, H40 | The callout shows purpose, connections and files and edits them. |
| EDIT-3 | H26 | A stale save shows the conflict and the reload offer, never `Saved`. Limit: an unwritable folder is exercised only on POSIX. |
| EDIT-4 | H30, H138 | A drag during a run is refused with the contracted toast and moves nothing; from 0.4 the same refusal, with its own toast, while a result is a preview (H138). |
| AI-1 | H24, H25, H30, H31, H32, H33, H44, H86, H100, H102, H104, H105, H115, H116, H129, H130, H135, H136, H137, H138, H143 | The instruction acts on the view, the selected parts or the whole channel through a chosen engine and model; failure, cancel, retry, undo, a concurrent session edit, the channel a run names, and a `story` run. Only the fixture engine runs. |
| AI-2 | H24, H25, H30, H31, H97, H130, H135, H136, H137, H140, H141, H142, H144 | The ask box is gone; the AI panel is closed on opening and is the one place to type (Enter sends, Shift+Enter breaks the line); the conversation holds one turn per run or saved request from `ai-send`, a channel control, a suggestion and `ai-look-again`, with its text, `Channel · Scope`, state and run id; the latest turn holds progress, error and Try again, summary, route and report, an earlier one its `ai-turn-result`; it is empty after a reload and never in the file. Limit: the scope sentence of a channel control's turn is matched as `<channel> · <something>`; the placement of the conversation in the panel is not asserted. |
| AI-3 | H24, H30, H31, H32, H102, H103, H124, H126, H138, H139, H140, H144 | A run on the open drawing arrives as a preview with the changed parts lit until the user chooses; edits are refused with the toast and undo and redo are disabled (their keys show the toast) meanwhile; the editor goes once to the run's channel and view (H144); the share dialog and zoom work; Accept keeps it as one undo step; Undo returns to before the run, saved, and redo brings it back; a new run, an outside change and a reload each end it as accepted; `Nothing changed` shows none. Limit: a failed save of an Undo and a `draw` run's lack of a preview (H121–H123 only draw) are not asserted here. |
| AI-4 | H97, H115, H130, H141, H142 | The suggestions of each channel with their labels, sent as routed instructions that leave the input alone, disabled during a run and on a channel with no view (H97), `Simpler` as the canned simplification of the overview's first view from a detail view, saved as requests with no engine; `simplify-overview` gone. Limit: that no model chooses the suggestions is a design fact, not observable. |
| AI-5 | H129, H130 | An instruction is routed to the facts or the channel's story: `route` in the record and `done`, the progress sentences, `ai-route` and the toast, marks only on the facts route, a story on the overview changes appearance only, a `parts` scope is the facts (its route line shown too), a simplify run shows no `ai-route`. Limit: the routing question's answer is the fixture's marker, given at once with no progress line and acted on by no other marker; how a real engine decides is not observable, and that `ai-route` goes when another run starts is not asserted. |
| NAV-1 | H20, H35, H98 | A part opens its inside, detail views nest, a view is reachable from the menu, the breadcrumb and a link, a search result opens its view, and the address keeps the view across a reload. |
| NAV-2 | H96, H97, H98, H99, H101, H102, H126, H127, H158, H163 | Four tabs in the contracted order with the current one, marks with their counts and accessible names, Keep as it is, the stages of an empty channel with the tools off, the breadcrumb and views menu in the overview only, the address with channel and view, an old `?view=` link, the narrow header; the steps panel on the presentation tab. |
| NAV-3 | H35 | Slash and the search button open search; `data-match` and `data-dim` while typing, the count texts, Enter / Shift+Enter with wrap, no part resized and no view move while typing, a match in another view, Escape ending the highlight, and the file untouched. Limit: the order of matches is not pinned; Ctrl/Cmd+K and the 50-result cap are not exercised. |
| NAV-4 | — | To build. |
| PRES-1 | H158, H159, H160, H161 | ADR 0012. `present-start` on the presentation channel only, off with the title `Add a step first`, in the header at every width; the layer `present` in `present` mode on the opening slide (`data-index` 0), in the drawing's theme, a dialog that holds the focus; full screen asked for and `data-fullscreen` equal to `document.fullscreenElement`, a refused request leaving the layer open and filling the window (H158); every key of the table, a click as next, no step passed at either end, `present-status` and the slide image's band, the dimming rules of *The slide image*, the hint until the index first changes (H159); the speaker note, Escape / `Exit` / a focused `Exit` leaving with the focus back and the step shown current, an editor that takes no key or click under the layer (H160); an outside change re-rendering the slide with no toast, the step followed by its `id`, the last step when it was removed, the opening slide kept, the layer closed with its toast when no step is left (H161). Limit: whether the browser grants full screen is not assumed, so the browser-exit leg (H158) runs only when it did, and a refusal is observed only if the browser refuses; the layout inside a slide, the hint's position, the layer's colours and the `Exit` button's place are not asserted; arrow keys with a button focused are not asserted (the contract says no other key *acts on* the button, not whether it still moves the slide); that the opening slide's state of the note is kept across it is not asserted. |
| PRES-2 | H162, H163 | `tour-start` opens `tour` mode on the first step, never full screen, with no hint or note button; `tour-panel` beside the slide at 900 px or more and under it below; `tour-note`, one `tour-part` per lit part in the view's order, `tour-file` per path once in the contracted order with its ranges, `No files recorded`, `tour-copy` copying the path alone with its toast; the tour's keys, a click as next, leaving with the focus back; no request writes or checks a file while touring (H162, H163). Limit: the second range of a path is read as `src/api.ts:3–9, :20–24` or `src/api.ts:3–9, 20–24` (the contract's "joined by `, `" allows both); a range cited by a fact other than the one that lists the path is not asserted (the contract does not say whose ranges a path shows); `Copying is not allowed here` is accepted where a browser refuses the clipboard; no surface shows that the tour opens no file beyond the requests seen. |
| PRES-3 | H164, H165, H166 | ADR 0012. `download-slides-pdf` and `download-slides-png` in `share-actions` on the presentation channel only, `<slug>-slides.pdf` and `<slug>-slides.zip`; the PDF read as the testing contract says (`%PDF-1.4`, `%%EOF`, `/Count` = steps + 1, that many pages of `/MediaBox [0 0 960 540]`, each one 3840 × 2160 `DCTDecode` image starting `FF D8`); the zip's stored entries, counted by the end-of-central-directory record, `<slug>-slide-00.png` … in two digits, each a PNG of 3840 × 2160 with a right checksum; the pages and the entries the same slides in the same order (decoded by the browser and matched without fixing a colour); the dialog's theme and toggles reaching them, the title and description on the opening slide only, the format never changing a slide's size; the accented slug; off with `Add a step first` without a step (H164, H165, H166). Limit: `Making slides…` and the failure toast are not asserted (no surface makes slides slow or fail); that notes are not in the exports is not asserted; a slide's drawing (dimming, band) is observed through the presenter (H159), not through the downloaded pixels, since the contracts fix no colour. |
| SHARE-1 | H15, H23, H28, H38, H63, H85, H87, H91, H100, H109, H152, H153, H159, H164, H165 | PNG and SVG at twice the size, copy, light and dark, all four sizes, no product mark, real text, the same image from preview, download, HTTP and the command, for a named channel, now also README and presentation images (H109); the slide image the presenter and the slide downloads show (H159, H164, H165). |
| SHARE-2 | H39, H100, H124, H125, H126, H166 | The modal keeps focus, closes back to its button, and carries preview, report and meter, and downloads; none of the old simplify and share-one-part controls. On the LinkedIn channel the dialog defaults to the feed, on the README channel to the README size, on the presentation to the slide, each with that channel's own view. |
| SHARE-3 | H39, H64 | The `readability` line is the contracted one-sentence wording for its level and destination, with no digit. |
| SAFE-1 | H25, H29 | Text typed into an instruction is data, and model names that look like options or shell words are refused. Folder and scan checks refuse a malformed model the same way (H113, H120). |
| SAFE-2 | — | See *Not covered*. |
| SAFE-3 | H29 | Foreign host and origin, missing or wrong token, loopback only (H113 and H120 also refuse a scan and a draw without the token). |
| SAFE-4 | H29 | A whole browser journey makes no request outside the local server. |
| SAFE-5 | — | See *Not covered*. |
| QUAL-1 | — | To build. |
| QUAL-2 | H64, H84, H85, H152, H153 | Readability levels follow the contracted thresholds (H64); the report equals an independent measurement of the image, and a line behind a part is listed, not hidden (H84, H152, H153); no cut text and an empty crossing and over-part count on a fixed drawing of neighbouring parts (H85); a post's hidden line is turned out so the post lists none (H153). Since ADR 0011 "no connections over parts" is the report's promise where the layout can clear them, not a property of every drawing (H86 holds a line that cannot). Limit: nothing here checks a pipeline output of an agent, API or full-stack project. |
| QUAL-3 | — | To build. |

## Not covered

**To build** (nothing to observe yet): START-2, NAV-4, QUAL-1, QUAL-3. (LAYOUT-4,
LOOK-2, AI-3 and AI-4 left this list with 0.4. PRES-1 to PRES-3 are observed by H158–H166
from 0.5 and stay *To build* in `spec.md` until the integration marks them Today.)

**0.5, not testable from the contracts** (a part of the 0.5 contract no scenario can
exercise, and why):

- `Making slides…` and the failure toast `The slides could not be made` (ui contract,
  *Share*): no contract-named surface makes the rasterising slow or fail, and the time it takes
  is not contracted.
- The look of a slide: the band's font sizes (34 / 28 / 22 px), its 1640 px width and weight, the
  counter's mono 24 px and right alignment, the fit into the margins above the band, and the caption
  sizes are layout inside the slide that the contract leaves to the renderer and that the presenter
  shows as an SVG. H159 reads the band's text and count, the caption's presence and the dimming;
  the downloaded pixels are compared only with each other (their order, theme, toggles), never with a colour.
- Full screen as the browser's decision: whether the browser grants full screen is not
  assumed. H158 and the leaving legs use `data-fullscreen` against `document.fullscreenElement`;
  the legs that need a granted request (the browser's own exit leaving the layer) run only when it
  was granted, so a browser that refuses never exercises them, and a refusal is exercised only by a
  browser that refuses.
- The pages of the PDF in the slides' order cannot be read from the PDF alone (the testing contract
  points at the zip). H164 matches each page to the zip's slide of the same index by decoding both in the
  browser, which assumes only that two different slides differ more than two encodings of one slide.
- That the exports leave out the speaker notes and that the tour opens no file: a request log
  (nothing written, nothing checked) is the only evidence (H162).

**Today or changing, but not observable from the contracts** (a contract gap):

- STORY-7, START-6: prompt text, the schema's `maxLength` (and its removal for Codex), the
  repair turn's tools, and the one-hour expiry of a kept read are not observable with the
  fixture engine.

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

- LOOK-3: that the briefs ask for a one-line description by default and for
  held items only where the story is about how a part works is not observable
  with the fixture engine (ADR 0008): only the removal of the *No held items*
  warning is asserted (H16, H134).
- LOOK-2: the look of each outline (a second outline 4 px inside, a head badge,
  a cylinder, a dashed line, cut corners) is not asserted, only the
  `data-shape` that names it.
- LAYOUT-4: the folder under `<ARCHDRAW_DATA_DIR>/revise/` the server writes the image
  into, and the start-up removal of a dead server's folders, are not
  observed on disk, and the image's content is not compared with the share
  dialog's (only its format, its size and that it is a PNG).

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
- **The ask box on an empty channel.** 0.2 asserted `ask-input` disabled there; from
  0.4 there is no ask box, and H97 asserts the AI panel's controls instead (see the 0.4
  gaps).
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

## Contract gaps found while writing the 0.4 scenarios

Each is a place where the contracts leave a choice to the builder; the scenario asserts
only what both readings share, or says here what it assumed.

- **Where `data-shape` sits.** The diagram contract puts it on the element with class
  `body`, inside `node-<id>` and `g[data-node-id]`. The helpers find it as the first
  descendant with class `body` (`[class~="body"]`, also on the node itself). The picker's
  buttons are read as every `data-shape` on `picker-form-<form>` or inside it, since the ui
  contract says a `form-thumb` is "drawn in the chosen kind's shape, with its `data-shape`"
  without saying on which element. Only the card and compact buttons are asserted; the
  panel and group buttons and the callout's form menu are not.
- **`ai-button` on a stage with no drawing** (settled by the contract review). `ai-button`
  still opens the panel on a channel with no view, where `ai-send`, the channel's suggestions
  and `ai-look-again` are disabled. H97 asserts it on the empty README, presentation and
  LinkedIn tabs (`ai-send` with text typed in the input), H144 asserts `ai-look-again` there.
  Whether the panel stays open across a tab change is not stated, so both reopen it when it
  is not visible.
- **What a turn's text is for a suggestion.** `ai-turn-text` is "the instruction as sent, or
  for a control without one its name (…, a suggestion's label)". H141 and H142 match the
  words both give (`Show the loop`, `shorter for LinkedIn`, `fewer details`, `fewer steps`,
  `simpl`).
- **The scope in a channel control's `ai-turn-where`.** `Draw it`, `Redraw it`, `Design the
  post` and `Rewrite it in plain words` start story and post runs that have no scope; the
  scenarios match `<channel name> · <something>` for them, and the exact `Overview · This
  view` only where a scope was chosen (the panel, a suggestion, `ai-look-again`).
- **Is the old result still lit or labelled in an `accepted` turn?** The contract says only
  the latest turn holds `ai-summary`, `ai-route`, `ai-progress`, `ai-error` and the report.
  H135 asserts that an earlier turn has no `ai-summary` and that exactly one exists; whether
  the latest turn keeps them after Accept is not asserted (they are read in `preview`,
  `unchanged` and `failed`).
- **The state of an undone turn after redo.** `ai-undo` makes the turn `undone`; what a later
  `tool-redo` makes it is not stated, so H139 reads the state only right after Undo.
- **Undo and redo during a preview** (settled by the contract review). `tool-undo` and
  `tool-redo` are disabled while a result is in preview and their keys show the toast;
  H138 asserts both. What `tool-undo` does to an `accepted` turn, whether a reload clears the
  undo history, and whether `tool-undo` is disabled after a `Nothing changed` run are not
  stated and not asserted (H31, H139, H140).
- **`ai-input` after a suggestion or a send without an engine.** A suggestion "leaves
  `ai-input` as it is"; whether a typed instruction saved as a request is cleared is not
  stated, so H137 does not read the input there (H142 reads it after suggestions).
- **The temporary image folder, the PNG's pixels, and the order of the image checks.** Not
  observed on disk (as the brief asks). The order `A revise needs the drawing's image`, `The
  image is not a PNG`, `The image is too large (4 MB at most)` is the order of the api
  contract's sentence; H143 therefore expects an oversize file with no PNG signature to be
  called "not a PNG". The 4 MB limit is exercised at 4 MiB + 1 KiB (over under either
  reading) and 3,000,000 bytes (under under either).
- **The fixture's revise answer.** "x + 40" is snapped to the 8 px grid (diagram contract,
  *Writing the answer back*); H143 and H144 accept a move of 32–48 px for the first part and
  require the others and the facts untouched. The fixture's own `Fixture: no image to look
  at` failure cannot be reached through the server's checks, so it is not tested.
- **The suggestions' instruction for `Simpler`.** The ui contract gives its text; the api
  contract says the server puts that text in front of whatever the caller adds. H141 and
  H115 assert the run's kind and view, not the instruction string, for it.

## Contract gaps found while writing the story-limits scenarios

- **Where a story run's warnings are read.** The api contract says a repair adds a warning and
  the run ends `Saved with <n> warning(s)`; a draw's document carries `warnings`. H145–H147 read
  a post's or story's warnings from the stored document's `warnings` (only the lines starting
  `Shortened` are counted, since a post also carries the fixture's one two-way-connection
  warning and may carry a target warning when its lede is over 140), and H145 reads
  `Saved with 1 warning` as "the repair turn added none".
- **The check line of a story run.** The api contract says story and post both show `Checking
  the post`; H145 counts that line twice for the README story as well. A draw's channel call
  uses `Checking the drawing` and the overview call has none (H148 does not read either).
- **How many problems an invalid post has.** `[fixture:overlong]` is one problem (the lede), so
  the line is asserted exactly; `[fixture:invalid]` is asserted as one repair turn only, with the
  count not pinned beyond that (H147 matches `Fixing` once, not its number).
- **The over-long lede's text.** The fixture repeats a sentence until 250 characters; the
  separator is not stated. H146 asserts that the saved lede starts with the sentence, is exactly 240
  characters and ends with `…`.
- **Engine lines of a repair turn.** `Fixing …` is followed by the repair turn's engine lines
  (api contract). H145 and H148 require at least one line there, without naming it.
- **The fixture's own lines are every call's.** The fixture's `Reading the code` is a line of
  every call, not only the read, so reuse is asserted per stage (`stage` of the progress events):
  the read stage of a reused draw holds none of `Reading the drawing`, `Reading the code`,
  `Updating the drawing`, and the overview stage of a reused overview none either (H149, H150).
- **Which markers reach which call.** A draw's marker travels in the typed focus (so the
  scenarios run on Windows too). `[fixture:flaky:<stage>]` counts once per server process and
  folder, so every flaky scenario has a folder of its own, and a control draw of the same project
  uses another folder with the same files and no marker (H149).
- **No scenario for the channel call's repair turn or a revise's.** The fixture's `overlong`
  and `stubborn` act on the overview call of a draw, on a post and on a story only; no marker
  makes a draw's channel call or a revise answer a problem.

## Contract gaps found while writing the story-limits-2 scenarios (issue #97)

- **The issue and the contracts agree.** Each of the four points was checked against api.md
  (*Progress*, *What a failed draw keeps*), diagram.md (*Problems and the repair turn*, *Hard
  limits*), ui.md (`draw-stage`, `draw-error`, `draw-retry`) and testing.md (*Markers*, *Draw*);
  none needed a correction. All four points are scenarios (H154–H157); none is left out.
- **H151 does not cover another focus.** Its other-focus draw comes after the retry that
  succeeded, and a success removes the folder's entry, so that draw would read again with any
  key. H154 therefore keeps the entry standing: every draw in it fails at the channel with
  `[fixture:fail:channel]` (which fails every time, unlike `flaky`), another model and another
  focus are each followed by a draw that reuses (the same trimmed focus and model, another
  channel), and no draw succeeds.
- **The model of the fixture.** testing.md names `fixture-fast` and `fixture-careful` and
  accepts any valid model name; H154 uses those two, and reads `Using model fixture-careful` among
  the progress lines of a fresh read as the sign that the model was sent. Another engine cannot be
  tried: the fixture is the only engine of the suite.
- **The plural line.** `[fixture:invalid][fixture:overlong]` on a post gives two problems (the
  connection to `ghost`, the over-long description), as the issue and testing.md say; H155 pins
  `Fixing 2 problems in the answer` exactly and the singular's absence. `Saved` is matched
  without a warning count: the repair turn adds none, and the fixture's own warnings are not
  this scenario's concern.
- **A stubborn overview in a draw.** The shortened text is the overview view's caption lede
  (`Shortened the description to 240 characters`, as for a post). Where the warning stands among
  the draw's warnings is not pinned beyond "after the read's four", since warnings are in stage
  order.
- **What the screen shows for a reused stage (H157).** The ui contract says a reused stage shows
  `running` with its `Using …` line in `draw-line`, then `done` once the next stage starts. The
  reused read's `Using the facts already read` and `Checking the facts` follow each other with no
  engine call between them, so the moment is short; H157 does not sleep or poll for it but records
  every state the stage list and `draw-line` are in (a `MutationObserver` in the page) and asserts
  on the recording. If a client drew only the last of several events that arrive together, this
  moment would not be seen and H157 would fail; the contract sentence is the reason it is asserted.

## Contract gaps found while writing the 0.5 scenarios

Each is a place where the contracts leave a choice to the builder; the scenario asserts only what
every reading shares, or says here what it assumed.

- **The second range of a path in `tour-file`.** "`:<from>–<to>` … joined by `, `" read literally gives
  `src/api.ts:3–9, :20–24`; a builder may write `src/api.ts:3–9, 20–24`. H162 accepts both
  (`TOUR_DESK_FIRST`) and uses one path with two ranges only for that. Which fact's ranges a path shows
  when two facts of the part cite it is not stated, so no scenario has a path cited by two facts.
- **Is `tour-copy` inside `tour-file`?** The text of `tour-file` is "the path, then … ranges", and `tour-copy` is
  "one per `tour-file`". H162 reads `tour-file`'s text with any `tour-copy` inside it removed (on a clone) and
  whitespace-normalised, and the buttons as the part's `tour-copy` list; whether a space separates a path from
  its ranges is open, so none is kept before a colon that follows the path.
- **What `present-slide` is.** "The slide's SVG": the helpers read the element itself when it is an `svg`, else
  its first `svg`, so a wrapper works. The slide must be inline SVG, not an image, since the dimming is read
  from `g[data-node-id]`, `g[data-edge-id]`, `g[data-text-id]` and the band from `[data-slide-text]` and
  `[data-slide-count]` (the ui contract names these as attributes of groups and elements in the SVG). The step's
  text is the text of every `[data-slide-text]` element in document order (one element per line is a valid reading).
  The SVG is "scaled to fit", so its `width`/`height` are not asserted: `slideSized` accepts `viewBox="0 0 1920 1080"`
  or the attributes, and the 16:9, inside-the-layer and beside/under checks (H158, H163) run on the drawn slide,
  `slideBox`: the corners (0,0) and (1920,1080) through the SVG's `getScreenCTM()`, not the element's own box, which
  may be larger. The downloads keep their exact size checks.
- **Whitespace in the band's text.** The band's text may be set on several lines, so it is compared with every
  space removed (`squeezed`); its being whole (never shortened) is what is asserted.
- **Keys with a button focused.** "Space and Enter on a focused button activate it and do not move; no other key acts
  on a focused button" does not say whether an arrow still moves the slide then. H160, H162, H163 and H158 give the focus
  back to the layer (`layer.focus()`) before an arrow key or Escape that follows a button's click or a Tab, and assert
  keys only with the focus on the layer.
- **The note across the opening slide.** `present-note-toggle` is "closed when the layer opens, and kept open or
  closed from slide to slide". H160 asserts it between steps and not after going back through the opening slide.
- **Leaving with a step current already.** "No step current after the opening slide" is read for a start with no step
  current; H158 leaves the opening slide only when none was. H160 asserts no step current when it leaves on the opening
  slide, and the step shown when it leaves on a step. Whether the part selected before presenting stays selected after
  leaving is not asserted (the contract says only that the step shown becomes current); `tool-pan` is asserted not
  `aria-pressed="true"`, since `aria-pressed` is given "on the active one" only.
- **Leaving with Escape and the editor's own Escape.** The Escape that leaves the layer must not also clear the
  editor's selection (the editor takes no key while the layer is open), but the selection is checked after leaving with
  `Exit`, not with Escape, since which handler sees that keydown last is not contracted.
- **Where the click lands.** "A click on `present-slide` is the next slide" is exercised at the element's centre. A
  click on the layer outside the slide (the bars of a window that is not 16:9) is not contracted, so H160 reads the index
  after clicking where another part sits under the layer and expects the matching step current.
- **`tour-panel` after an outside write.** "While the layer is open, an outside change to the file … re-renders the slide
  shown, with no toast" says nothing of the tour's panel. H163 observes the slide (its label, compared with `squeezed`
  since a label may be drawn as several `tspan`s) and the absence of a toast, and asserts nothing about `tour-part` or
  `tour-file` changing; the panel's ids at the step are checked, not that its labels follow the write.
- **The index read after a click under the layer.** `data-index` may follow a click a frame later, so H160 reads it only
  when two reads 250 ms apart agree, before leaving, and derives the current step from that value.
- **Full screen.** Granted or refused is the browser's; see *Not covered*.
- **The hint after the first change.** "Shown until `data-index` first changes" is read as gone for good once the index
  has changed, also when it returns to 0 (H159).
- **A step's `id` when the layer follows an outside change.** The outside writes of H161 only reorder, retext and remove
  steps and change the caption; a step whose parts are renamed or removed by the write is not exercised.
- **`updatedAt` of an outside write.** The session's write carries a later `updatedAt` than the stored one (`sessionWrite`),
  as H26 and H95 do; whether the server needs it is not stated.
- **The slide's pixels.** The contracts fix no colour, so the PNG and JPEG slides are compared with each other through
  the browser (`pixelGrids`), never with an expected colour (which theme is darker is not asserted; the PDF made in dark is asserted nearer the dark
  slides than the light ones), and a slide is matched to
  its own index by nearest grey-level grid (192 × 108), which assumes two different slides of the talk differ more than a PNG
  and a JPEG of the same slide.
- **A disabled button's click.** H158 and H166 click disabled buttons with `force: true` to prove nothing starts; a browser
  never fires a click on a disabled button, so the product need do nothing for that to hold, and the assertion is that the
  layer stays closed and no file downloads.
- **Slug of adjacent non-alphanumerics.** `non-alphanumerics → -` is read per run in neither scenario: the titles used
  (`Crème Brûlée Café!`, `Slides Shop`, `Theme Shop`, `One Step Talk`) have none side by side.

## Requirement and issue map of the ADR 0013–0015 round

Every requirement id this round marks *To build* or *To change* in `spec.md`, and every build issue of `ISSUES-drawing.md` and
`ISSUES-selections.md`, with the scenarios that observe it (a title carries the id or `#issue`; a changed older file is listed when
it was rewritten for the rule). It extends the *Requirement map* above for these ids: where a row above lists fewer scenarios, this
table is the current one.

| Requirement | Scenarios | Evidence and limit |
|---|---|---|
| EDIT-5 | H167, H168, H169, H170, H19 | One drag moves only what it moves, lifts the part and saves once (H167); the drop target and the free spot (H168); guides and equal gaps within six screen pixels, never in an export (H169); held sides and the editor paths equal to the export after release (H170). Limit: the matcher's unit tests are not observable. |
| LOOK-2 | H179, H182, H184, H131, H132, H133, H17 | An outline per kind in cards, compacts and panels, in the editor and the image, at the content box the shape needs. Limit: the post stack's extra width and the two-versus-three-line wrap of a medium label are read one way (see the gaps below). |
| LOOK-3 | H180, H181, H17, H18, H31, H33, H34, H40, H94, H95, H124, H28, H39, H63, H64, H100, H109, H131, H133, H108 | No row on a part, in the editor or in an export; the callout lists held rows, items and limits; the sub-line switch (`show-sub`) replaces `show-items`. |
| LOOK-4 | H167, H171, H172, H173, H176, H177, H152, H28, H63, H100 | Neutral lines, colour on hover, selection or number; the faint trace; a label clear of other lines; the hub mark. Limit: the neutral colour is compared exactly, the trace colour and the halo colour are not (see the gaps). |
| LAYOUT-2 (group name halo) | H177, H152, H172 | A line level with a group's name is drawn over it with the name on a halo, not cut. |
| LAYOUT-5 | H170, H174, H175, H87 | Busy sides, short handles for close parts, straight pairs, trunks; the editor and the export draw the same paths. Limit: H174's numbers are a hand calculation of the cost rule. |
| LAYOUT-6 | H178 | Rows and columns ordered to cut crossings, hints and stored positions kept. Limit: crossings are compared with the sorted order and zero on a ladder only. |
| AI-1, STORY-1 (engine on the empty LinkedIn stage) | H183 | `start-engine` chooses the engine and model the AI panel then uses. |
| SCAN-2 | H190, H110, H121, H191 | Sections and flows, files cut to eight, an unknown kind becomes `flow`, cache `version` 2. |
| SCAN-3 | H190, H191, H192, H121 | Ticking one or several choices, from the pointer and the keyboard. |
| STORY-1 | H192, H194, H195, H148, H156, H183 | One channel after the choices; one run draws them in order. |
| START-7 | H194, H195, H196, H197, H149, H157 | Several choices drawn one after the other; a failure keeps the finished ones and `Try again` starts from the first unfinished; cancel writes nothing. |
| STORY-8 | H202, H199 | The whole system as a map of a few parts, each holding its inside in a detail view; the map's target in the layout report (also H114, H115). |
| FILE-2 | H198, H199, H200, H15, H16, H27, H89, H90, H106, H107, H108 | `archdraw/diagram@4`: a `@3` file becomes the choice `system` with nothing lost; four choices validate with the choice in the path, save and reopen; an edit in one choice changes no other. |
| NAV-1 | H203, H204, H202, H184, H35 | A click goes into a part with an inside, a drag moves it, Enter opens it (H203); the open mark is the same in the editor, the image and the command (H184, H204). |
| NAV-2 | H205, H206, H207, H208, H35, H96 | The views panel lists every view by choice, marks the current one, reaches any in one click and by keyboard, folds to a strip (remembered), folds into the header menu below 900 px. |
| "used by N" (a part four or more parts use) | H176 | Mark and no lines at four users; three users stay as today; a step line stays. |
| #44 | H183 | |
| #164 | H170, H174 | |
| #165 | H170, H87 | |
| #166 | H167, H19 | |
| #167 | H168, H19 | |
| #168 | H169 | |
| #170 | H167, H171, H177, H152, H28, H63, H100 | |
| #171 | H172 | |
| #172 | H173 | |
| #174 | H175 | |
| #175 | H178 | |
| #176 | H177, H152 | |
| #177 | H179, H180, H181, H182, H131, H132, H133, H17, H18, H31, H33, H34, H39, H40, H63, H64, H94, H95, H100, H109, H124, H28, H87 | |
| #180 | H190, H110, H191, H121 | |
| #181 | H192, H193, H194, H195, H196, H197, H120, H121, H122, H123, H148, H149, H150, H151, H156, H157 | |
| #182 | H198, H199, H200, H106, H107, H15, H16, H27, H89, H90 | |
| #183 | H201, H208, H200 | |
| #184 | H184, H202, H203, H204 | |
| #185 | H205, H206, H207, H208, H35, H96 | |
| #186 | H176 | |

Changed older files and the reason, in short: H108, H114, H115 (the map target `parts: 9` on a converted file's overview, `choices[0]`
in violation paths, no rows on the canvas) and H131 (the opened file is `@4`) are the index pass's; every other change is listed by
its batch above. Older scenarios that only read a stored file through the readers of `helpers.ts` were not touched: the readers carry
them.

### Not covered this round

- **Acceptance outside the browser, the API and the files**: the unit tests of the issues (the matcher, the cost rule, the outline
  tables), the live scan of this repository, the live draws "recorded in the ledger", the before/after images in the pull requests,
  the crossings recorded on the fixtures, `npm run check`/`smoke:core` and the routing time per drag move (#175) cannot be asserted
  by a scenario; the scenarios observe the same rules through the editor, the exports, the API and the command.
- **Trunk markup**: the export markup of a trunk is not contracted beyond `g[data-trunk]` and its `path`, so the arrowhead count and
  tone of a trunk in an export are not asserted (the tone is asserted in the editor, `data-tone`).
- **Colours the contract does not fix**: the trace's colour is compared with the neutral colour when its line is neutral and only
  "not neutral" when numbered; the halo's colour is not asserted (a solid stroke of 4 px, round, `paint-order` stroke is).
- **Sizes printed without a number**: the post stack's extra width and the card's sub-line row when the sub-line is empty are read
  one way; compact widths are exact for a short label with no sub-line only; two versus three lines of a medium label is not asserted.
- **Layout report of a later choice**: the `targets` the contract names are asserted for the map; the other keys of the report of a
  choice that is not the first are not (H202).
- **Folder-name markers on Windows**: a `[fixture:…]` marker cannot be part of a Windows folder name, so the parts of the selections
  scenarios that need one are guarded by `process.platform !== 'win32'`; the rest of each journey runs.
- **Still To build**: START-2, NAV-4, QUAL-1, QUAL-3. START-1 (To change) is observed only as static packaging (H29).
- **Not run**: no scenario of the round has been compiled or run (no product and no runner in the authoring sandboxes); the first run
  of the suite on the built product is the first check of the type-level and selector assumptions.

## Contract gaps found while writing the ADR 0013–0015 scenarios

The authors' readings, kept as they wrote them (each is a place where the contract allowed more than one), and the index pass's
own at the end. A build step that reads the contract another way should say so in its issue rather than change a scenario.

**Drawing (H167–H184):** a card keeps its sub-line row when its sub-line is empty (sub-lines on); a panel is as big as the card of
its kind, also in the post style; the post stack's extra width is 8; compact widths exact for short labels with no sub-line only; the
three-line cap is exact, two versus three for a medium label is not asserted; "opacity 0.25" of the trace is opacity × stroke-opacity;
a line level with a name sits 11 px above the name's middle, and a raster difference over the name's whole width is the sign that
nothing is cut; a group's name text is read from `g[data-group-head]` (editor `node-head-<id>`); held sides use the 0.8 rule with
margins (about 46.8° keeps the horizontal pair going down, 43.8° keeps the vertical pair going back, 38° flips it); "24 px clear" is
a box gap of at least 23 px on one axis; "stays where released" is the offset to a fixed reference part before and after; `data-at`
of a centre guide is the anchor's centre and any `y` guide at that coordinate is accepted for a same-height part; H174's numbers are
a hand calculation of the cost rule; the trunk end is asserted on the part's border; `used by 5` counts a two-way user and a step
user; compaction (parts at columns 0 and 6 laid out like columns 0 and 1) is read from step 4 as holding without a crossing; the
callout lists held rows, then shown items, then limits; removing a held row also deletes the mechanism fact once nothing holds it;
H183's `start-engine` leg runs only if it exists on `/` and asserts `draw.body.engine` as `fixture`; the "Open <label>" button is
found with `getByRole`; the neutral colour is `rgb(132, 139, 152)` light and `rgb(99, 106, 119)` dark.

**Selections (H190–H208):** a failing typed choice is placed second where `:second` markers are used; "at most 10 choices" includes
the whole-system choice; `Try again` shows `Using the <channel> already drawn` only when the channel is unchanged; view ids are plain
`overview`/`linkedin` for the first choice and `<choice id>-overview`/`-linkedin` for later ones; the open mark's placement is within
±2 px of the stated insets and `node-inside` is looked up inside the part, or inside `node-head-<id>` for a group; the views panel
with one choice and one single-view overview is absent, with a multi-view overview it is shown; the map's `step` ordering is asserted
as a set; the warnings of a multi-choice draw are prefixed `"<choice title>: "` followed by the single-choice text.

**Index pass:** (1) a reader returns the file's first choice, with `schema` `archdraw/diagram@3` on what it returns; (2) "opening
writes the file back as `@4`" is read as: `open`, the editor's first open and an import write it, `validate`, `svg` and an export do
not (H198 asserts the second half, H108 relies on the first); (3) the map target `parts: 9` applies to the first overview view of the
`system` choice only, so a converted `@3` drawing's overview carries it and its README and presentation views do not (H114, H115);
(4) a violation path is `choices[<n>].…` even for a file written as `@3` (rule 1), because the file is converted first; (5) a request
read through `readDocument` belongs to the first choice unless it names another.
