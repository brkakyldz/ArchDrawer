# Held-out coverage

The suite has 90 scenarios. A requirement id appears in a scenario title only
when the scenario observes it; an id the spec marks *To build* appears only
once a step has built something to observe (the 0.3 round: START-4, SCAN-1 to
SCAN-4, READ-1 to READ-3, STORY-2 to STORY-5 and AI-5, with STORY-1 and
STORY-6 changed; the 0.4 round: LOOK-2, AI-3, AI-4 and LAYOUT-4, with LOOK-3 and
AI-2 changed). Ids are the requirement ids of the product spec.

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

H100 (Design the post) is unchanged: its result now arrives as a preview, and nothing it does afterwards (the share dialog, the tabs)
is refused by one. H137 (batch C) also asserts `ai-look-again` is off with no engine, which only the ai lane's finished product has.

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
| LAYOUT-4 | H97, H143, H144 | The `revise` run: its request checks in their contracted order (format, `readCode`, image missing / not a PNG / too large, an image on another kind, instruction, scope, drawing, view, channel, engine, no drawing), the fixture's answers (the overview's first part 40 px right and nothing else; the channel's story elsewhere; a lone group changes nothing), `route` null, progress starting `Looking at the drawing`, a failed run writing nothing (H143); `ai-look-again` posting the view's PNG in the channel's default format at 1x, ending in a preview, off during a run and on an empty channel (H144), off with no engine (H137). Limit: that the image shows what the reader sees, that the revise folder under the data directory is made and removed, and what a real engine does with the picture are not observable with the fixture engine. |
| LOOK-1 | H20, H36, H41, H131 | Light and dark themes switch, persist and keep the library legible at the contracted contrast; the shapes are the same in both (H131). No judgement of style. |
| LOOK-2 | H131, H132, H133 | A card or compact part of kind `llm`, `actor`, `data`, `external` or `gate` names its outline in `data-shape` (`agent`, `person`, `store`, `external`, `check`), every other kind, a panel and a group as `card` / `card` / `group`; the same in the editor and in `export.svg`; no size or place changes with it, also in the post style; the picker's card and compact buttons show the chosen kind's shape; changing a kind in the callout changes the shape only. Limit: what the outlines look like (a second outline, a head badge, a cylinder, dashes, cut corners) is not observable from `data-shape`; the picker's panel and group buttons and the callout's form menu thumbnails are not asserted. |
| LOOK-3 | H16, H134 | A drawing of six or more parts with no panel gets no *No held items* warning from `validate` or `open`, also on the README, while Flat, No main path and Repeated label stay (H16, H134). Limit: that the briefs ask for a one-line sub-line and held mechanisms only where the story is about them is a prompt matter, not observable with the fixture engine. |
| FILE-1 | H15, H16, H18, H19, H20, H21, H22, H23, H24, H25, H26, H27, H30, H35, H36, H40, H41, H88, H90, H94, H95, H97, H108, H118 | The drawing is one file; edits are saved into it; an outside edit is followed; reloads show the stored state; a channel or view change writes nothing (H97); an older file gains no new field (H108); a draw writes one new file and never overwrites, whatever sits at a name, and a draw whose file cannot be written leaves the folder as it was (H118, H119). |
| FILE-2 | H15, H16, H27, H88, H89, H90, H91, H92, H93, H96, H99, H100, H104, H105, H106, H107, H108, H109, H126 | The file holds the facts and one drawing per channel: the shape and its defaults, every validity rule's path, `@2` and `@1` read as `@3`, channel on exports and requests, parts that point at facts; from 0.3 mechanisms, limits, evidence, held rows, a README view, a presentation view with steps (H106–H109). Limit: how an `@2` post must look to be valid `@2` is no longer in the contracts (see *Contract gaps*). |
| FILE-3 | H92, H93, H94, H95, H101, H103, H104, H105, H108, H115, H124, H125, H127, H128, H129 | A rename or a new part in the overview reaches the facts and every channel that draws them; `outdated` is marked exactly for a new fact, a deleted fact or relation, a relation between two shown facts, and a field a part keeps its own text for; never for the current channel or an empty one; undo restores the marks. A session's write is split the same way (H95). Steps and a README rename are appearance (H125, H127). The routes of a refine mark or do not mark by the same rules (H129). |
| EDIT-1 | H18, H19, H20, H21, H22, H23, H30, H31, H32, H36, H40, H85, H87, H92, H93, H94, H96, H99, H101, H103, H125, H127, H128 | Move, rename in place, add by kind and form, connect by dragging, free text, undo and redo across views and channels, now also steps. |
| EDIT-2 | H18, H22, H34, H36, H40 | The callout shows purpose, connections and files and edits them. |
| EDIT-3 | H26 | A stale save shows the conflict and the reload offer, never `Saved`. Limit: an unwritable folder is exercised only on POSIX. |
| EDIT-4 | H30, H138 | A drag during a run is refused with the contracted toast and moves nothing; from 0.4 the same refusal, with its own toast, while a result is a preview (H138). |
| AI-1 | H24, H25, H30, H31, H32, H33, H44, H86, H100, H102, H104, H105, H115, H116, H129, H130, H135, H136, H137, H138, H143 | The instruction acts on the view, the selected parts or the whole channel through a chosen engine and model; failure, cancel, retry, undo, a concurrent session edit, the channel a run names, and a `story` run. Only the fixture engine runs. |
| AI-2 | H24, H25, H30, H31, H97, H130, H135, H136, H137, H140, H141, H142, H144 | The ask box is gone; the AI panel is closed on opening and is the one place to type (Enter sends, Shift+Enter breaks the line); the conversation holds one turn per run or saved request from `ai-send`, a channel control, a suggestion and `ai-look-again`, with its text, `Channel · Scope`, state and run id; the latest turn holds progress, error and Try again, summary, route and report, an earlier one its `ai-turn-result`; it is empty after a reload and never in the file. Limit: the scope sentence of a channel control's turn is matched as `<channel> · <something>`; the placement of the conversation in the panel is not asserted. |
| AI-3 | H24, H30, H31, H32, H102, H103, H124, H126, H138, H139, H140, H144 | A run on the open drawing arrives as a preview with the changed parts lit until the user chooses; edits are refused with the toast and undo and redo are disabled (their keys show the toast) meanwhile; the editor goes once to the run's channel and view (H144); the share dialog and zoom work; Accept keeps it as one undo step; Undo returns to before the run, saved, and redo brings it back; a new run, an outside change and a reload each end it as accepted; `Nothing changed` shows none. Limit: a failed save of an Undo and a `draw` run's lack of a preview (H121–H123 only draw) are not asserted here. |
| AI-4 | H97, H115, H130, H141, H142 | The suggestions of each channel with their labels, sent as routed instructions that leave the input alone, disabled during a run and on a channel with no view (H97), `Simpler` as the canned simplification of the overview's first view from a detail view, saved as requests with no engine; `simplify-overview` gone. Limit: that no model chooses the suggestions is a design fact, not observable. |
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

**To build** (nothing to observe yet): START-2, NAV-4, PRES-1 to PRES-3, QUAL-1,
QUAL-3. (LAYOUT-4, LOOK-2, AI-3 and AI-4 left this list with 0.4.)

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
