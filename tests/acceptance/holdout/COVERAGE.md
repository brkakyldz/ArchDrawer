# archdrawer held-out acceptance coverage

Current selection: 63 ids (H15-H83 without H46, H47, H48, H57, H58, H59); runs 3,
perScenario 2, overall 0.9.

## 2026-10-19: removal of six scenarios, by the owner's decision

The owner decided a new product scope that drops two things:

- the Simplify flow (the "Simplify it" suggestion, `kind: "simplify"` runs, the
  coverage check DEP-6 and the simplify prompt), and
- the overview-as-map targets (DEP-4: an overview of 4-6 top-level zones and at
  most 15 connections, and the warning or suggestion when it misses them).

Six scenarios existed only for those two rules and are removed; nothing else was
written and no assertion of any remaining scenario changed.

| Removed | Title (abridged) | It pinned |
| --- | --- | --- |
| H46 | simplify the overview into a map that still holds every component, twice, and undo it | Simplify, DEP-4, DEP-6 |
| H47 | refuse a simplification that would lose a component and try again after a cancel | Simplify, DEP-6 |
| H48 | suggest simplifying an overview that misses its targets without changing or refusing the drawing | DEP-4 |
| H57 | simplify into reachable detail, preserve provenance and undo all views in one step | Simplify, DEP-4, DEP-6 |
| H58 | refuse lost provenance and retry a cancelled simplification with the whole drawing intact | Simplify, DEP-6 |
| H59 | offer simplification outside the overview targets without changing or rejecting a valid map | Simplify, DEP-4 |

What remains for each requirement they covered:

- **DEP-4:** nothing. No remaining scenario pins the overview targets or the warning
  and suggestion; the requirement is uncovered by the owner's decision. H42 and H49
  use overview views only incidentally.
- **DEP-6:** H60 (API validation and lifecycle of the simplify kind), H49 (the kind over
  HTTP, bad input refused before any engine) and H56 (request queued with no run).
  Retaining ids, content, files, parents, connections and provenance in reachable detail,
  refusing a lost node or provenance id, and one-step undo of a simplification are
  uncovered by the owner's decision.
- **ASK-10:** H56, H60, H43 and H49 remain. Running a simplification in the UI (progress,
  report, retained detail, undo, Cancel and Try again with identical input) is uncovered.
- **ASK-8:** H31, H50 and H61 remain; the simplify retry after cancel (H47, H58) is gone.
- **ASK-9, VIEW-2, VIEW-7, CLI-1, EDT-6, PER-1, DEP-5, SHR-10:** lost only an extra
  scenario; every one still has the others listed in the map below.

Scenarios that mix simplification with something still in scope (H43, H49, H56, H60,
H30 and others) are unchanged and are listed for a later revision.

## Scenarios

| Id | Title |
| --- | --- |
| H15 | [CLI-1, CLI-2, CLI-3, CLI-4, DM-1, SHR-6] validate a session file, reopen the same editor and export it |
| H16 | [CLI-1, DEP-3, DM-2, DM-3, DM-5] depth warnings permit a drawing but every broken field is reported without repair |
| H17 | [DM-1, DM-2, DM-3, LAY-1, LAY-2, LAY-3, LAY-4, SHR-6] a hinted system and nested loop render with matching export geometry and kept positions |
| H18 | [EDT-2, VIEW-1, DM-2, PER-1] explain a component and edit every field and held item without losing its neighbours |
| H19 | [EDT-1, EDT-6, LAY-4, PER-1] select and move connected parts, regroup them and undo a destructive edit |
| H20 | [VIEW-2, VIEW-3, EDT-2, EDT-6, EDT-7, PER-1] enter and create detail views and retain a hundred undo steps across views |
| H21 | [EDT-3, DM-2, EDT-6, PER-1] choose kinds and forms at their destination, including a child in a group, and cancel safely |
| H22 | [EDT-2, EDT-4, EDT-6, DM-3, VIEW-1, PER-1] connect two parts, merge the return direction and edit the whole connection |
| H23 | [EDT-5, EDT-6, SHR-1, PER-1] type and resize free text, move a neighbouring part, share the text and undo its deletion |
| H24 | [ASK-1, ASK-4, DM-5, LAY-3, EDT-6, PER-1] apply and repair an instruction, undo it, cancel and protect a concurrent session edit |
| H25 | [ASK-2, CLI-2, CLI-4, PER-1, PLT-3] a machine without engines saves a literal request for the next session and stops only its own server |
| H26 | [PER-1, PER-2, EDT-2] save to the repository file, follow an outside edit and refuse a stale editor write with a reload offer |
| H27 | [PER-3, DM-4, CLI-4, CLI-2] migrate an old drawing, import both versions and forget them without deleting repository files |
| H28 | [SHR-1, SHR-2, SHR-3, SHR-4, SHR-5, SHR-6, SHR-10] preview and download an image for every destination, then design the post and keep its source view |
| H29 | [PLT-2, PLT-3, PLG-1, PLG-3] inspect the packaged skill and use a local drawing while forged writes are refused |
| H30 | [ASK-5, ASK-6, ASK-9, EDT-6, PER-1] expand a quick ask, pick a test model, follow progress and undo the reported change |
| H31 | [ASK-5, ASK-8, ASK-9, EDT-6] retry failed and cancelled changes with the same text, model and selection |
| H32 | [ASK-5, ASK-7, ASK-9, LAY-3, DM-5, EDT-6] move and align just one part and warn once for a move outside selected parts |
| H33 | [ASK-5, ASK-6, ASK-7, ASK-9, PLT-2] record exact changes for add, rename, hold, move and remove and reject invalid scopes without edits |
| H34 | [VIEW-5, VIEW-1, VIEW-3, SHR-6] fade detail at distance while keeping the open part lit and every shape and export unchanged |
| H35 | [VIEW-6, VIEW-7, VIEW-2, VIEW-3] find a part across overview, detail and LinkedIn views and navigate from one views menu |
| H36 | [VIEW-8, VIEW-1, EDT-6, EDT-7, PER-1] pin explanations beside the canvas and keep editing controls reachable in a narrow header |
| H37 | [SHR-1, SHR-3, SHR-7, SHR-9, SHR-10, ASK-5, ASK-9, VIEW-7, EDT-6, PER-1] design a post for LinkedIn, edit its full caption and re-arrange only that version |
| H38 | [SHR-7, SHR-8, SHR-1, SHR-5, SHR-6] warn about shortened text and export a group or selected parts with only their own connections |
| H39 | [SHR-1, SHR-3, SHR-4, SHR-8, SHR-10] apply only useful readability fixes beside the download and keep keyboard focus inside sharing |
| H40 | [EDT-8, EDT-2, EDT-3, EDT-6, PER-1] rename from the callout, choose pictured forms and follow tool hints without accidental edits |
| H41 | [PER-3, PER-4, CLI-2, PLT-2] open an example from an empty library and recover a registered file that became invalid |
| H42 | [SHR-9, SHR-10, DEP-5, ASK-9] design the post from the drawing and read the layout report it was judged by |
| H43 | [SHR-3, SHR-10, ASK-2, ASK-10, PER-1] prepare the post and queue a rewrite and a simplification on a machine with no engine |
| H44 | [LAY-5, DEP-5, SHR-9, LAY-3] place a post by its lanes, turn the portrait spine back and leave positioned parts where they are |
| H45 | [LAY-6, LAY-7, SHR-10] keep a step badge clear of every drawn label and reserve no room for a label nobody sees |
| H49 | [SHR-9, ASK-10, DEP-6, PLT-2] run a post and a simplification over HTTP, own the post through postOf and refuse bad input before any engine starts |
| H50 | [SHR-9, SHR-7, SHR-10, ASK-8] keep over-long story text in full and report it, and keep the drawing when a story cannot be converted |
| H51 | [LAY-5, DEP-5, LAY-2, CLI-2] lay out an ordinary view by its lanes: three side parts of one anchor spread across neighbouring columns |
| H52 | [SHR-1, SHR-3, SHR-9, SHR-10, DEP-5, ASK-9] design a portrait post and download the reported result without changing its source |
| H53 | [DEP-5, LAY-5, SHR-1, SHR-3, SHR-10, EDT-6] switch post orientation and re-arrange lanes without another engine call or changed forms |
| H54 | [DEP-5, LAY-5, LAY-3, CLI-2] open an ordinary map with anchored satellites, internal lanes and a fixed positioned component |
| H55 | [DEP-5, LAY-5, LAY-6, LAY-7, SHR-10] hide labels without reserving their gaps and keep numbered badges clear in editor and SVG |
| H56 | [SHR-1, SHR-3, SHR-7, SHR-10, ASK-10, DEP-6] prepare and edit a post without an engine, then queue overview simplification |
| H60 | [SHR-9, SHR-10, DEP-6, ASK-10, PLT-2] reject bad post and simplify inputs before a run, then expose a valid simplify through GET and SSE |
| H61 | [SHR-7, SHR-9, SHR-10, SHR-3, ASK-8] keep over-target story text whole, refuse invalid intent and retry a cancelled wide redesign |
| H62 | [SHR-3, SHR-9, DEP-5, SHR-10] allocate a bounded post around a legacy collision and resolve its full source after reload |
| H63 | [SHR-1, SHR-2, SHR-7, SHR-10] share a full ordinary view for three destinations with a wrapped caption and explicit clipping warning |
| H64 | [SHR-4, SHR-10] distinguish readable names from readable detail and print the three measured sizes |
| H65 | [LAY-1, LAY-5, DEP-5, SHR-3, SHR-10] span outer cells with two zones and keep outside satellites out of both boxes |
| H66 | [LAY-1, LAY-5, SHR-3, SHR-10] leave the contracted row gaps around an anchor in ordinary and post styles |
| H67 | [LAY-1, LAY-4, SHR-6, SHR-10] bring a connection into a first-row member without crossing its group name |
| H68 | [LAY-1, SHR-3, SHR-6, SHR-10] draw larger post names across all forms and make room for a second card line |
| H69 | [LAY-1, LAY-5, LAY-6, LAY-7, SHR-10] reserve column, badge and drawn-label room between lane neighbours |
| H70 | [LAY-4, LAY-5, SHR-6, SHR-10] centre a detour label on its longest free straight run and keep the portrait turn clear |
| H71 | [LAY-1, LAY-5, DEP-5, SHR-6, SHR-10] widen the gap after a zone whose name is wider than its members |
| H72 | [LAY-4, LAY-5, SHR-6, SHR-10] end connections on borders and take the nearest available side around vertical obstacles |
| H73 | [LAY-4, LAY-5, SHR-6, SHR-10] finish ordinary upward and asymmetric border detours within their own budget |
| H74 | [LAY-4, LAY-5, SHR-6, SHR-10] end post direct and right-on-tie connections on their borders |
| H75 | [LAY-4, LAY-5, SHR-6, SHR-10] finish post upward and asymmetric border detours within their own budget |
| H76 | [LAY-1, SHR-3, SHR-6, SHR-7, SHR-10] widen a post card for its sub-line and draw the same size in the editor |
| H77 | [LAY-4, LAY-5, SHR-6, SHR-10] take a shorter crossing-free post detour when the initial curve crosses a previously drawn line |
| H78 | [DEP-5, LAY-1, LAY-5, SHR-6, SHR-10] place a side-lane zone as one unit and anchor an outside satellite on a zone first member |
| H79 | [LAY-8, SHR-6] draw every ordinary and post connection without corners in the editor and every SVG format |
| H80 | [LAY-8, SHR-6] take a short clear arc around a part without entering a group name |
| H81 | [LAY-8, LAY-3] make room around an automatic blocker while keeping every stored position |
| H82 | [LAY-8] report an unavoidable stored-position connection over a part |
| H83 | [LAY-8, LAY-7, SHR-6] put an arc label and badge in the nearest free middle spots clear of every part |

## Requirement map

Partial evidence is not complete certification. A row marked "Contract gap" has no
observation surface in the contracts.

| Requirement ID | Scenario IDs | Evidence / limit |
| --- | --- | --- |
| PLG-1 | H29 | Partial: packaged manifests, launcher and single shared skill; installation in agent hosts untested. |
| PLG-2 | — | Contract gap: no live skill-host conversation surface. |
| PLG-3 | H15, H29 | Partial: valid file → validate → open, skill's literal instructions; host update of pending requests untested. |
| PLG-4 | — | Contract gap: shared rules file and engine prompt have no named observation surface. |
| PLG-5 | — | Contract gap: missing-launcher behaviour inside an agent host. |
| DEP-1 | H17, H18, H20, H22 | Partial: represented depth, descriptions, files, nested groups, detail views and connection types; live drawing rules untested. |
| DEP-2 | H16 | Partial: tuning/repetition warnings; live drawing prohibitions untested. |
| DEP-3 | H16 | Five depth-warning categories, valid exit and unchanged input. The LinkedIn exemption is not separately exercised. |
| DEP-4 | H42, H49 | Dropped by the owner's decision of 2026-10-19: no scenario pins an overview of 4-6 top-level zones and at most 15 connections, or a warning or suggestion when an overview misses them. H42 and H49 only use overview views incidentally. |
| DEP-5 | H78, H71, H65, H52, H53, H54, H55, H62, H44, H42, H51 | H78 proves side-zone units and anchoring on the first spine member. H71 compares header-driven lane gap growth. H65 proves two reserved zones and outer-grid members. H54 tests ordinary/internal lanes, precedence over place, stored positions and legacy defaults. H52 tests story conversion; H53/H55 measure post lanes. |
| DEP-6 | H56, H60, H49 | Partial. H60 tests API validation and lifecycle of the simplify run kind, H49 runs it over HTTP and refuses bad input before an engine starts, H56 queues the request with no run. By the owner's decision of 2026-10-19 the Simplify flow is dropped: keeping every id, content, file, parent, connection and provenance in reachable detail, rejecting a missing node or provenance id, and undoing a simplification are now uncovered. |
| CLI-1 | H15, H16, H27 | Valid, malformed, v1 and invalid files; all error paths, allowed values, file existence, warnings with counts and no repair. |
| CLI-2 | H54, H15, H17, H25, H27, H41, H51 | Normalisation, layout (including a view placed from lanes alone), stable URL/id, reuse, detached start and id collision. Older-build replacement is a gap. |
| CLI-3 | H15 | Chosen view/format/theme; CLI/browser image content and geometry agree except browser font embedding. |
| CLI-4 | H15, H25, H27 | Status, stop and repeat stop, migrate and repeat migrate, usage exit. |
| DM-1 | H15, H17, H20, H23 | File/defaults, captions, multiple views and free texts. |
| DM-2 | H16, H17, H18, H21, H40 | Partial: ten kinds, four forms, fields and pictured form choices; colour encoding not numerically specified. |
| DM-3 | H16, H17, H22, H42 | Styles, two-way, labels, steps, persisted direction edits and a converted reverse pair. |
| DM-4 | H27 | Partial: documented ui→client migration and warning, caption/sub-line/files/id/position preservation, v1 import. |
| DM-5 | H16, H24, H32, H42, H50 | Session file never repaired; exactly two invalid-answer repairs; one warning for an out-of-scope move, one for a merged reverse pair, one for over-limit story text. |
| LAY-1 | H76, H78, H71, H68, H69, H67, H66, H65, H17, H28, H34 | H76 checks actual-ink widening or clipping feedback and intrinsic parity; H78 checks computed group containment. H71 proves a wider zone name grows the following gap in both styles. H68 measures the current post name/card/panel sizes; H69 measures neighbour room. Group/member containment, content sizes, group bounds, form formulas, row spacing, export parity and zoom-invariant shape sizes. |
| LAY-2 | H17, H28, H43, H51 | Hint placement, unhinted main path, wrapped group path, the no-engine two/three-column snake, a laned main path along one row, and non-overlap. |
| LAY-3 | H54, H17, H24, H32, H44 | Kept positions, non-overlapping additions, only explicitly moved parts changing position, a laned positioned part staying put through a run. |
| LAY-4 | H77, H73, H74, H75, H72, H67, H70, H17, H19, H34 | Revised smooth-arc cost bounds and individually unused post sides; twelve retained border/obstacle cases and right ties; group-name first-row entry; free label nearest curve middle. Drag/zoom invariance retained; exact port spread remains partial. |
| LAY-5 | H77, H78, H73, H74, H75, H71, H72, H69, H70, H66, H65, H53, H54, H55, H44, H42, H51 | Post arc cost bounds replace crossing-first routing; all lane, zone, gap, portrait-turn, border, drawing-frame, one-sided/right-tie and badge checks remain. Legal smooth witnesses replace coordinate-squeeze bulge witnesses. |
| LAY-6 | H69, H55, H45 | H69 measures room for drawn horizontal/vertical labels. H55 compares scale-free gaps with labels on/off and an otherwise identical empty-label drawing, proves hidden text absent and checks no file write. No invented gap size or strict reduction is required. |
| LAY-7 | H83, H69, H55, H45, H37 | H69 adds the contracted minimum badge gap. H55 tests every drawn badge against every drawn label in the full-detail editor, preview and downloaded SVG; all sets must be non-empty. Untagged exports use the number's separate graphic group, or paint beneath its centre without a shape-tag or text-enclosure requirement. See the untagged-background limit below. |
| LAY-8 | H79, H80, H81, H82, H83 | Smooth cubic grammar/normals, paint chains and SVG/export checks remain. Every group-name oracle uses the full 46 px band from the group's top: minimum extent for observed exclusion/lower bounds, maximum permitted 2 % extent for witnesses. H80 keeps primary cost/cap, stored fallback and d+120 discrimination (minimum all-port bound 201.582 px >198, maximum-box witness 228.257 px <230). H81 keeps mandatory 34-W gap growth, 48-W success or conditional drawn/saved rollback, and stored-position/report controls; its widened witness passes both full-band corners. H82 keeps name-clear shortest-fallback/report checks; H83 keeps label/badge clearance and nearest-middle checks with legal maximum-box candidates. General ties, complete port search/global optimality, exact layout-end strip exclusion, retry count, full raster coverage and browser timing remain gaps; see the LAY-8 notes below. |
| EDT-1 | H19, H23 | Selection, Shift/box selection, movement/snapping, grouping, deletion and independent text movement. |
| EDT-2 | H18, H20, H22, H26, H40 | Component/callout and edge fields, direct title rename and persisted edits. |
| EDT-3 | H21, H40 | Picker choices, insertion inside a group, cancel and pictured forms. |
| EDT-4 | H22 | Port/tool creation, reverse merge and same-direction no-op. |
| EDT-5 | H23 | Empty/focused text input, multiline typing, in-place edit, move, preset, corner scaling with opposite corner fixed, delete and share toggle. Extreme 8/200 limits not exhaustively exercised. |
| EDT-6 | H53, H19, H20, H21, H22, H23, H24, H30, H31, H32, H36, H37, H40, H43 | Undo/redo across views, text scaling, destructive edits, engine changes, post preparation (undo and redo) and a re-arranged post; H20 checks 100 undo steps. |
| EDT-7 | H20, H36 | Theme and numbered path saved/reloaded; narrow-menu actions and undo/redo. |
| EDT-8 | H40 | Callout title commit/cancel/empty refusal, all tool hints, visible pictures in form menu and picker. |
| VIEW-1 | H18, H22, H34, H36 | Partial: descriptions/paths/links, callout avoidance and screen size, connected labels lit, docked explanation beside canvas. |
| VIEW-2 | H20, H35 | Existing/created detail, unique copy id, breadcrumbs and direct view URL. |
| VIEW-3 | H20, H34, H35 | Fit, pan, buttons, pointer wheel, detail thresholds and search zoom/centering. |
| VIEW-4 | H17, H20, H36 | Partial: kinds, geometry and themes; full DESIGN.md appearance unavailable. |
| VIEW-5 | H34 | Full/outline/overview; computed text opacity, non-step connection dimming, open component/item/sub-line/connected label lit; shapes, paths, stored file and export unchanged. |
| VIEW-6 | H35 | Case-insensitive matching across every view, result labels/view titles, click/Enter, selection, callout, centering and ≥100 % zoom. |
| VIEW-7 | H35, H37 | File-order view list including overview, detail and post views, the current indicator and navigation. |
| VIEW-8 | H36 | Pinned callout beside the canvas, narrow header menu, reachable header actions and accessible names for icon buttons. |
| ASK-1 | H24, H30, H31, H32 | Partial: fixture progress/application, positions, undo, cancel and failures. Paid engine execution untested. |
| ASK-2 | H25, H43 | A real server with no offered engines: a literal queued refine request, and the queued post rewrite and overview simplification. |
| ASK-3 | — | Contract gap: real-engine argv/stdin/environment/tools/schema not observable. |
| ASK-4 | H24 | Exact concurrent-change failure and preservation of the external edit. |
| ASK-5 | H30, H31, H32, H33, H37 | Multiline panel/ask expansion, engine/model choices and memory, view/parts/all scopes, live selection, and a post rewrite scoped to the post view. |
| ASK-6 | H30, H33, H43 | Partial: engine list shape/test marker/model list, only available choices, explicit test-engine naming in the panel and the share flow, fixture-only null-engine fallback, and a machine with no engine at all. Mixed real/fixture priority is a gap. |
| ASK-7 | H32, H33 | Fixture move/right-of/below/align, box-derived target, grid, unchanged other parts/texts, parts-scope refusal and one warning. |
| ASK-8 | H61, H31, H50 | Failure and cancel keep the instruction; `ai-retry` and `share-run-retry` resend the same kind, engine, model, scope and text. |
| ASK-9 | H52, H30, H31, H32, H33, H37, H42 | Ordered progress lines and the model line, share-flow progress, pending/failed/cancelled `changes: null`, exact run changes including an added post view, all seven summary counters, zero counts omitted, changed marking then clearing, `Nothing changed`. Non-zero `edgesChanged` is a gap. |
| ASK-10 | H56, H60, H43, H49 | H56 queues the overview request with no run. H60 tests API validation and lifecycle. H43 queues the post rewrite and the simplification on a machine with no engine; H49 runs the kinds over HTTP. By the owner's decision of 2026-10-19 running a simplification in the UI (progress, report, retained detail, one-step undo of all views, Cancel and Try again with identical input) is now uncovered. |
| PER-1 | H18, H19, H20, H21, H22, H23, H24, H25, H26, H30, H36, H37, H40, H43 | Partial: file persistence, reload, ≤ 1 s save, failed-save feedback and byte-level preservation through refused runs; crash-atomicity not exposed. |
| PER-2 | H26 | Outside edit ≤ 2 s, actual stale PUT 409, disk protected and reload offer. |
| PER-3 | H27, H41 | API/UI newest-first, v1/v2 import, invalid refusal, row menu/removal with the file kept, empty library/example, contrast and hierarchy under both OS colour preferences. |
| PER-4 | H41 | Partial: invalid registered file → explanatory load error → retry → recovery/back to library; health/`server.json` build, same-build reuse. Stale server and renderer crash need an observation/injection surface. |
| SHR-1 | H52, H53, H56, H63, H23, H28, H37, H38, H39 | H52/H56 check post card/panel sizes, badge radius and editor/export size/font parity; H53 checks wide exports. H63 compares intrinsic component sizes, full paths normalized to drawing units, full text and intrinsic fonts for README/Slide/Square, plus presets/theme/focus. Font embedding markup is excluded. |
| SHR-2 | H63, H28 | H63 exports the complete ordinary view for README/Slide/Square with full wrapped caption text and no caption/component overlap. Every corner/strip fallback is not exhausted. |
| SHR-3 | H76, H68, H66, H65, H52, H53, H56, H61, H62, H28, H37, H39, H43 | H76 measures card width/ink and clipping feedback for an authored post sub-line. H68 checks intrinsic post typography across every form. H65 checks wide/portrait zone placement and H66 checks dense row spacing without file writes. H52 designs an owned view; H53 commits/undoes placement; H56 prepares/edits without an engine; H61 retries cancelled rewrite; H62 tests ownership/collision/reload/redesign. |
| SHR-4 | H64, H53, H55, H56, H61, H63, H28, H39 | Three measured meter numbers and threshold regions. H64 proves good, names-low ok and opened-low warn; detail-low ok is conditional on the measured font permitting a legal note, with an annotation otherwise. Inherited checks retain fixes and meter placement. No ordinary name font is assumed. |
| SHR-5 | H28, H38 | SVG/PNG names, 2× PNG size/signature, clipboard PNG/denial; image text carries no product mark. Raster watermark inspection untested. |
| SHR-6 | H76, H77, H78, H73, H74, H75, H71, H72, H67, H68, H70, H15, H17, H28, H34, H38 | H76–H78 use the public node/edge SVG geometry; H72–H75 retain border/path parity. H71 measures HTTP first-rect geometry; H72–H75 check preview/download connection borders. SVG checks cover group-name routing, post fonts and detour-label placement. Real text/plain shapes, no `foreignObject`/`script`, node size parity, CLI/browser parity, semantic zoom cannot change an export. |
| SHR-7 | H76, H56, H61, H63, H37, H38, H50 | H76 checks whole text or explicit clipping feedback for an authored post card; form selection is covered by preparation journeys. H56/H63 preserve long captions; H63 exposes full clipped text. H61 keeps the 34-character story label and reports its contracted 28-character target with a named warning and one overLimitText entry. Hard-limit story failure has no fixture answer. |
| SHR-8 | H38, H39 | A group with its nested descendants, selected parts, only internal connections, the parts HTTP export, filenames, an unknown part 400; the source view unchanged. |
| SHR-9 | H52, H60, H61, H62, H42, H37, H44, H49, H50 | H52 tests UI input/progress, groups/forms/chips/lanes/from, unique ids, reverse repair and GET/SSE report. H60 refuses bad inputs. H61 preserves over-target text and atomically refuses invalid intent. H62 tests bounded allocation, legacy collision and full postOf source resolution. |
| SHR-10 | H76, H77, H78, H73, H74, H75, H71, H72, H67, H68, H69, H70, H66, H64, H65, H52, H53, H55, H56, H60, H61, H62, H63, H42, H28, H37, H38, H39, H43, H45, H50 | H76–H78 cover the new post/zone rules; H72–H75 preserve the complete split border journey. H71/H72 add header gap growth, vertical detours and full preview badge containment; sampled-route limits are above. H64 checks measured readability regions; H65 reserved zones and portrait member counting; H66 dense row gaps. H52/H56 check post geometry/font parity and H52/H53/H56 exported font floor, caption/badge placement. Shared checks measure smallestText.names. H52/H60 retain report agreement; H61 guards cancelled reports. |
| PLT-1 | — | Contract gap: installation/host and OS/Node matrix outside this harness. |
| PLT-2 | H60, H25, H29, H33, H41, H49 | Host/Origin/token guards, token refusal for `/api/example` and `/api/runs` with no side effect, per-process tokens, conditional non-loopback and POSIX permissions, and every invalid run kind/format/scope/model rejected with 400 before an engine starts. |
| PLT-3 | H25, H29 | Partial: observed browser network stays local; shell-looking fixture and queued instructions stay literal data. Backend egress and real-engine execution are not observed. |

## Evidence notes

| Contract change | Evidence |
| --- | --- |
| SHR-4 / ui-v2 two-level good and three meter numbers | H64 checks good (detail below 9 when attainable), ok with names below 9, warn with opened text below 8, and ok with detail below 6.5 when the measured ordinary name font permits a legal note. An unreachable detail-only input is annotated as unverified. H28, H53, H55, H56, H61 and H63 also derive the rule from actual visible SVG runs and check all three numbers. |
| api-v2 smallestText.names | H42 and H52 compare name sizes with actual preview text; H52 and H60 validate finite non-negative name metrics and the format's seen-width formula through checkReport. No names-size HTML attribute is invented. |
| diagram-v2 dense post style | H52, H53 and H56 inspect every visible downloaded text run: drawing font at least 12.5 px. H52 and H56 additionally measure post card/panel sizes, badge radius and editor/export size/font parity for both construction paths. Global fit transforms are measured separately for readability. |
| testing-v2 empty canned spine labels | H42 asserts three numbered edges with empty labels, no overLimitText and at least one added warning; quality warnings may also occur. H52's shared checker accepts limit: 0 as a valid shape, without claiming its conversion path is covered. |
| LAY-5 / diagram-v2 outer cells and reserved zones | H65 checks ordinary, wide and portrait placement, including portrait's turn after the third actual member, member containment, outsider exclusion and separate zone boxes. H66 measures 32/22 px ordinary/post lane row gaps. H44 and H53 order the Work loop rather than its zone box. Ancestor pairs are excluded from unrelated-overlap checks. |

Notes on single scenarios:

- **H28** previews and downloads an image for README, Slide and Square, asserts both post
  sizes (wide 1620 x 1080 inside `share-advanced`, `format-feed` 1080 x 1350), designs the
  post with the fixture engine and checks nothing is drawn under the post image. The
  readability meter is held against the smallest visible text actually drawn, in image
  pixels, through `layout-report`'s unrounded `data-opened`/`data-in-place`.
- **H37** designs a post with the named test engine, edits its full caption and re-arranges
  only that version; `explain-feed` sends `kind: "post"` for the owned post id, and
  Re-arrange keeps forms, items, provenance and lanes. The pairwise overlap loop skips
  ancestor/descendant pairs, since a group's box is its children's bounding box plus
  padding and a header.
- **H39** proves "Use the LinkedIn version" by `share-size` becoming 1080 x 1350, shows
  `linkedin-flow` for both post formats, finds the prepared version through `postOf` and
  asserts the layout report beside the meter.
- **H42** puts the dialog into the post format's default toggles before comparing its report
  with the run's, counts the merge warning rather than matching its wording, and checks
  `post.postOf` is the full source id while the source's own `postOf` is null.
- **H43** holds a saved rewrite request to its contracted text and to naming a view of the
  document, and checks that no run was started.
- **H45** holds that hiding a label never widens a gap, that a drawn label gets room of its
  own, and that the badge/label rule holds in the downloaded SVG too.
- **H50** identifies the over-limit warning only by the part it names, since the same run
  also adds the reverse-pair merge warning.
- **H51** opens an ordinary, unpositioned, non-post view: three side parts of one anchor
  spread across neighbouring columns of one row, one with a `place` hint pointing the other
  way is still placed by its lane, a fourth sits above its anchor, the spine runs along one
  row, nothing overlaps, `lane`/`from` survive untouched and no warning is produced.
- **H16** rejects isolated invalid lane/from/postOf documents on CLI validate/open,
  registration and import.

## Retained limits

- testing-v2, Canned story intent: "Its spine connections have empty labels". No contracted
  answer exercises a non-empty engine-produced spine label; diagram-v2 says "A non-empty
  spine label is kept and drawn, and reported in `overLimitText` with `limit: 0`", and ADR
  0014 decision 2 adds "with one warning". These stay unverified for engine conversion.
- api-v2, Bounded revision: "Before then `revise: true` returns 400 `Layout revision is not
  enabled`, without an engine call"; "smallest name may not decrease". H49 retains the closed
  gate; comparison, the at-most-three editorial changes, the rejection warning and the
  engine-round ledger remain unexercised.
- api-v2, Layout report: "component and zone names only". The export exposes text and node
  identity but no contracted name-role tag; repeated label/sub-line/chip content is outside
  this oracle's reliable attribution, so fixtures keep those strings distinct.
- **SHR-9 hard limits:** [fixture:long] is within the hard limit. H61 tests target
  preservation and invalid-story refusal; no fixture emits text above a hard limit.
  Warnings have no category identifier or fixed wording: H52 and H61 check warning
  presence and the named target warning, allowing additional quality warnings.
- **Report geometry:** no canned non-zero crossing or over-part count is given. H52 and H60
  test shapes, pair uniqueness/endpoint exclusion, finiteness and report agreement. H42
  counts actual drawn route intersections for the fixture post and a no-change refine
  drawing; non-zero oracles are exercised synthetically. H55 measures hidden-label gaps
  against an empty-label image. An independent non-zero routed-length calculation is
  uncovered; the zero-edge ratio is checked in H63. The UI report carries no run-id to tell a
  previous result from a new one; H61 proves null reports for cancelled runs over HTTP and
  checks successful UI reports.
- **`cutText` for the post:** geometry decides whether [fixture:long]'s 34-character label
  is cut, so H50 asserts the full text in the document, the `overLimitText` entry and the
  warning, and only that cut entries carry full text, never a cut count.
- **LAY-6:** observed through the post preview's own switches as a scale-free gap ratio. A
  product that placed a post preview from stored positions instead of re-placing it from its
  lanes would fail this check; re-placement from lanes is the contracted behaviour.
- **PER-4, CLI-2:** `build` is a hash produced by installed code. No contract supplies an
  older executable or a way to induce a render crash, so H41 covers invalid-file recovery,
  health/`server.json` agreement and same-build reuse only.
- **DM-4:** no complete v1 input schema is supplied; H27 uses only migration-named fields
  with empty legacy edges, groups and notes.
- **DM-2, VIEW-4, PER-3:** `DESIGN.md` and the exact palette are not supplied; H41 checks
  numeric contrast, not visual fidelity, glow or thumbnail likeness.
- **LAY-4, VIEW-1/3, SHR-6:** exact port spread, every curve and arrowhead, simultaneous
  callouts, the smallest required pan and native pinch are not exhausted.
- **EDT-5, PER-1:** text scaling is checked above a preset with the opposite corner fixed;
  there is no crash surface proving atomic rename.
- **SHR-2/3/5/7:** all corner and strip placements, graphical watermark pixels and extreme
  names under every form are not exhausted. The fixture proves rewrite routing and source
  isolation, not stranger-facing prose quality.
- **Story spine label:** no marker emits a non-empty story spine label, so its engine
  preservation plus exactly-one-warning/limit: 0 path cannot be driven under the
  fixture-only rule. H55 still tests preserved and drawn manual labels.
- **LAY-8 general:** equal-minimum bend-count/length tie stages (fewer bends, shorter, further
  right), complete port search and global optimality, retry count, exact layout-end strip
  exclusion, full raster coverage and per-scenario browser timing alone and in varied order
  are not covered. H77's strict cheaper-avoidance and cheaper-crossing assertions and the
  vertical right-on-tie checks remain.
- H79, H81, H82 and H83 certify their witnesses against the 2 % 'maximum' name box of
  helpers-v13; diagram-v2 allows the layout end up to 4 % of the name's width past the
  glyphs, so those witnesses could cross a legal name box. Only H80 uses the 4 % box.

## LAY-8: H80 premise for every allowed name box

diagram-v2: the name box runs "from the group's left edge to 2 px past the end of its name ... 46 px tall,
from the group's top; the end as measured for layout, which leaves kerning out and adds 2 %, so it lies at or
past the painted glyphs and up to 4 % of the name's width beyond them". Also "No arc is longer than the larger
of 1.8 x that distance and that distance + 120 px" and "the shortest curve that stays out of group names is
drawn (no more than 0.5 % longer than the shortest such chain)".


Allowed boxes. Painted name width w, painted end E. Smallest box right
edge E + 2 (the layout end may equal the glyph end). Widest: "4 % of the
name's width" read as the layout width (the wider reading), so the overhang
o obeys o <= 0.04 (w + o), o <= w / 24 (4.17 % of w). H80's local
widestNameBox adds w / 24 to groupNameBox's smallest box; the shared
helpers-v13 'maximum' (2 %) is not used by H80.

Bounds. anyPortBound: start box above the band, end box below it, both
inside its x span, so a name-clear route crosses the whole band beside one
end of the box: length >= gap(start box, top corner) + 46 + gap(end box,
bottom corner), the smaller of the two ends. It holds for any port on the
two borders, so it does not depend on which ports the product picks. It is
evaluated on the smallest box, which gives the smallest bound.

Witnesses: three cubics, side-middle ports (the port a lone connection on a
free side has), 24 px handles, through both corners of one end of the
widest box (0.01 px outside). Middle ports are used because a corner-port chain could be shorter than any chain the product draws. Witness lengths below are hand Simpson sums (n = 10) of
the cubic speed; the test computes the exact upper bound itself.

Case 1, no arc (stored). short-start (0,0) compact 140 x 46, outside the
group; short-end (0,110) and short-anchor (-442,110) in short-zone, both in
its first row; label 48 W. Centres (70,23), (70,133): d = 110, cap
max(198, 230) = 230; the test needs > 231. Group left -442 - 18 = -460, top
64, name band y 64..110. Name painted from -460 + 43 = -417; with the
measured Geist width 674.9, E = 257.9.
- smallest box right 259.9; x = 259.9 - 140 = 119.9 past both parts.
- widest box right 257.9 + 674.9 / 24 + 2 = 288.02.
- any-port bound (corners (140,46) and (140,110)): hypot(119.9, 18) + 46 +
  119.9 = 121.24 + 46 + 119.9 = 287.14 drawing px > 231 (459.4 screen px at
  scale 1.6 vs 369.6). Left end: hypot(460, 18) + 46 + 460, far longer.
- width range: the bound is > 231 for any painted width >= 647 px
  (x 92: 93.74 + 46 + 92 = 231.74), so up to 27.9 px (4.1 %) under the
  measured Geist width still proves it; at 640 it would not (217.9).
- fallback check: witness round the widest box (x 148.02) is about
  153.6 + 46 + 149.8 chords plus about 11 handle overhead, about 360; the
  product's own box (its 2 % unkerned end, about x 281) gives a middle-port
  chain of about 346, under 1.005 x 360. Any allowed box is no wider than
  the widest, so its shortest chain is no longer than the witness.

Case 2, d+120 (stored). Right of the name the allowed boxes differ by
w / 24, and a name reaching past both parts is w >= 113 + x, about 190 px
(overhang >= 7.9). Needing the smallest-box bound > 199 (x > 75.4) and the
widest-box witness < 230 leaves about 1 px for where the name may end with
corner ports, and none with middle ports (that witness passes 230 near x 79.4). The box's left edge is the group's left
edge, which has no font in it. So: short-start (59,0), short-end (59,110),
short-anchor (0,260) (alone in a lower row, leftmost child), label 24 W.
Group left -18, top 64 (short-end's top 110 - 46). d = 110; 1.8d = 198, the
test needs > 199 and < 230.
- left end: u = 59 - (-18) = 77, exact.
- any-port bound: hypot(77, 18) + 46 + 77 = 79.08 + 46 + 77 = 202.08 > 199.
- right end: painted 25 .. 362.45 (24/48 x 674.9), smallest box right
  364.45: hypot(165.45, 18) + 46 + 165.45 = 377.9, far longer than the left.
- left witness, middle ports (59,23), (59,133), corners (-18,64), (-18,110):
  first cubic (0,0),(24,0),(77,17),(77,41) = 93.03; middle 46; last cubic
  (0,0),(24,0),(77,-1),(77,23) = 86.69; total about 225.72 < 230. It does
  not depend on the name's width.
- free sides: both left sides are >= 64 px from the other end and >= 104 px
  from the anchor (>= 40 required).
Margins: 3.08 drawing px over 199 and about 4.3 under 230.

Other H80 change: the primary journey's independent arc witnesses now clear
the widest box (w / 24) instead of the 2 % one; every other primary assertion
is unchanged.

## LAY-8: H81 capped arc after one permitted column widening

Two automatic layouts start with a certified fixed-placement name obstruction. The 34-W fixture
must succeed with measured gap growth and a clear capped arc. The 48-W fixture accepts successful
widening under the same output checks; only an actual fallback requires restoring every drawn relative
box and every saved x/y to the no-edge control. Contract text: "the layout widens the row or column gap
the arc needs and routes again, at most three times; widening that still leaves the connection without an
arc is undone"; "a part with a stored position never moves". There is no maximum increment.

Hand-checkable certificate, in drawing px, using the 34-W header
end x578 (the author check also samples ends x571, x578 and x584):

| Quantity | Ordinary layout | Hypothetical legal widening |
|---|---|---|
| Single column gap before column 1 | 36 | 36+3*40=156 |
| Member left x by column | 58, 234 | 58, 354 |
| Source panel | x234..418, y86..168 | x354..538, y86..168 |
| Target panel | x234..418, y264..346 | x354..538, y264..346 |
| Lower name | x40..578, y218..264 | unchanged |
| Centre distance and cap | d=178; max(320.4,298)=320.4 | unchanged |
| Free corridor right of target, 8 px from it | x>=426, name still blocks the short route | x>=546; use x546..686 past the name |

Before widening, **even allowing every port, including an illegal top**,
a right-end name-clear route is at least sqrt(160^2+50^2)+46+160=373.631 px;
the left-end bound is sqrt(194^2+50^2)+46+194=440.340 px. Both exceed 320.4.
The all-port lower bound proves ordinary impossibility independently of
which sides the router tries. Runtime computes it from the no-edge control.

After widening ONLY the gap before column 1 by 120 px (three 40 px steps), the following
two cubics are an admissible certificate, with their four controls listed:

1. (446,168), (446,192), (578,208), (602,208).
2. (602,208), (626,208), (562,305), (538,305).

All four endpoint/join handles are exactly 24 px. The join is horizontal
on both sides. The source leaves its facing bottom; the target enters its
unused right side, with no right neighbour; it is at least 96 px from
the source above, and 340 px horizontally from either column-0 compact.
Thus the extra 40 px availability condition holds. The fully covered target top is never
used. The first cubic stays at y<=208, above the lower name by 10 px. In the
second cubic, y=208+97(3t^2-2t^3) is monotone; over the name band y218..264,
x>=582.85, beyond its x578 end. The cubic's maximum x is <607.30, inside the
8 px-clear x546..686 corridor when beside the first-row parts. All other
non-endpoint parts are also at least 8 px away. The subdivided control-
polygon length upper bound is **292.798 px <320.4**, leaving 27.602 px.
The certificate is reconstructed from the no-connection layout only,
with a measured full-name box and the real panel dimensions. The product
may use any legal gap/route; these exact output controls are not asserted.

Mandatory success is retained: zero part overlaps, clear/capped output,
accurate measured report and an observed gap larger than ordinary. A
never-widen/fallback implementation fails. A first-row top entry, if the
chosen output exposes one, must be at least 10 px right of the name. The
separate 48-W case retains name exclusion and report agreement. It accepts
successful widening; actual fallback retains its admissible length bound
and restores every visual relative box and saved x/y to the no-edge control. Stored/mixed wall controls and
all authored-position assertions remain.

## Harness and isolation

- `playwright.config.ts` uses `npm start`, Chromium, one worker, zero retries, the five contracted
  server environment variables, top-level scenario files only, and the JSON report
  `test-results/holdout.json`. Its product root is three levels above the config, i.e.
  `tests/acceptance/holdout/` in an installed checkout.
- `verify.json` selects the 63 ids and keeps the command, format, report and timeout: runs = 3,
  perScenario = 2, overall = 0.9.
- Every journey creates fresh temporary repository and drawing folders and identifies its own ids, so
  each can run alone and in any order. H25, H30, H37, H41, H43, H50 start and stop their own local
  servers in `finally`; H43 starts one with `ARCHDRAW_ENGINES` empty (no engine at all) and H50 one with
  a slow fixture step, so cancels are real rather than timed. No real engine is ever enabled, no product
  response is faked and no product source is imported.
- Waits are on contract-named states: run status over HTTP, `save-status`, file contents, test ids and
  attributes. The only sleep-like device is the contracted `[fixture:slow]` marker and fixture step delay.
