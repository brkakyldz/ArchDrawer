# Contract — the web client

What the browser shows and how it behaves: the home screen, the editor (canvas,
callouts, connections, texts, views), the AI panel, and the share
dialog with its image. Every element named here carries
`data-testid="<id>"`; `<x>` marks a template (`node-api`). Behaviour is
normative for end-to-end tests; styling is not, except where stated.

Implemented by: `src/web/App.tsx`, `src/web/home/*` (the home screen),
`src/web/editor/*` (Editor, Canvas, Callout, Panels, AiPanel, Find,
Views, LoadError, ops, runner, useAutosave, useDocHistory, viewport),
`src/web/share/ShareDialog.tsx`, `src/web/ui/LayoutReport.tsx`,
`src/core/export/svg.ts`, `src/core/export/share.ts`,
`src/core/export/feed.ts`.

## Routes

- `/` — **Home** (the home screen). `/d/<id>` — **Editor** on the first choice's overview
  channel, its first view;
  `/d/<id>?choice=<choiceId>&channel=<channel>&view=<viewId>` opens that
  choice, channel and view (`channel` defaults to `overview`, `view` to the
  channel's first view, `choice` to the choice holding `view` when one is
  given, else the first choice). Going to a choice, channel or view updates
  the URL. Reloading shows the same thing. An older link with only
  `?view=<viewId>` or `?channel=<channel>&view=<viewId>` opens the choice and
  channel holding that view (view ids are unique in the file); an unknown
  choice, channel or view opens the first choice's overview.
- Unknown id: `not-found` (`This drawing is not in the library.` and a link
  `Back to the drawings` to `/`).
- Never a blank page: when the drawing cannot be loaded, when the server's
  `build` differs from the page's (`The editor server is older than this
  page. Stop it with `archdrawer stop`, then open the drawing again with
  `archdrawer open <file>`.`), or when the editor fails while showing it
  (`The editor failed while showing it: <message>`), the page shows
  `load-error` with that sentence, `load-retry` (`Try again`) and `load-back`
  (`Back to the drawings`).
- A mutating call refused for its token shows
  `The server restarted — reload the page`; an unreachable server
  `Could not reach the archdrawer server`.

## Home

`/` is the home screen (HOME-1 … HOME-12). It chooses a repository, scans
it, chooses what to draw and where it will go, follows the drawings being
made, and lists the drawings in the library. Its look is DESIGN.md's *Home
screen*; the texts below are exact. The server is reached only through the
api contract: *Sources*, *The folder dialog*, *A repository from a link*,
*Scans*, *The draw run*, *Joining a running draw*, *Trying again*,
*Activity* and the endpoint table.

**Times.** A time shown as `mm:ss` counts minutes (which may pass 59) and
seconds. Times since an event are counted on the server's clock: the page
adds to its own clock the difference between `now` of its latest
`GET /api/activity` and the moment that answer arrived. A **relative time**
reads the first of these that fits: `just now` under a minute, `<n> min ago` under an hour, `<n> h ago`
under a day, `Yesterday` on the day before in the browser's local calendar, `<n> days ago` up to
six days, then `<d> <Mon>` (`26 Oct`) within the year and `<d> <Mon> <yyyy>`
before.

**Columns.** Three columns: `home-nav` (236 px), the work column
(`start`, then the drawings) and the side column (312 px:
`activity`, then `home-continue` or `scan-card`, then `start-engine`).

- At 1240 px wide or less the side column moves under the work column, and
  `activity-toggle` appears in the top bar.
- At 860 px or less `home-nav` becomes one row at the top holding only
  `home-nav-drawings` and `home-nav-new`, and `home-continue` is hidden.
- At 640 px or less every column is full width, and `start-steps` writes
  only the name of its current step.

### Frame

| Test id | Element and behaviour |
|---|---|
| `home` | root; `data-theme` `light`/`dark`: the theme kept in this browser (as `library-layout` is), else the system's. It is the same stored choice `tool-theme` writes when it switches a drawing's theme; the editor shows each drawing in its own `theme` and does not read it |
| `home-theme` | icon button, accessible name `Switch theme`: toggles the home screen's theme and keeps it in this browser |
| `home-engine-chip` | a dot and `Engine <label>`, the engine `ai-engine` holds; pressing it scrolls `start-engine` into view and focuses `ai-engine`. Absent without an engine |
| `home-import` | `Import`: opens `import-input` |
| `activity-toggle` | only at 1240 px wide or less: `<n> running`, `<n>` as in `activity-count`, hidden when it is 0; pressing it scrolls `activity` into view |
| `home-nav` | the left column: `home-nav-drawings`, `home-nav-new`, then *Recent* and *Found on this computer* (*Choosing a repository*), then `home-server` |
| `home-nav-drawings` | `Drawings` and the number of drawings in the library; scrolls `library` into view |
| `home-nav-new` | `New drawing`: as `draw-another`, then focuses `start-folder` |
| `home-server` | the page's own host and port (`127.0.0.1:4317`) |
| `start` | the panel `Draw a project`: `start-steps`, then the step it is on |
| `start-steps` | four steps, `Folder`, `Focus`, `Destination` and `Draw`, each with `data-state` `now`, `done` or empty. `Folder` is `now` while the panel follows nothing or a scan that has not succeeded; `Focus` while it follows a succeeded scan and no choice is ticked; `Destination` once a choice is ticked; `Draw` while it follows a draw, whatever the draw's state (*Following a job*). The steps before `now` are `done` |

### Choosing a repository

`start-source` holds two tabs: `start-source-local` (`This computer`,
selected at first) and `start-source-link` (`Link`). The lists come from
`GET /api/sources`, asked when the page loads, after a scan succeeds, after
a draw the page sees succeed (it registered its file), and after
`source-forget`, `source-found-refresh`, `library-forget` and
`start-open-existing`.

| Test id | Element and behaviour |
|---|---|
| `start-folder` | This computer: a combobox, accessible name `Folder of the project`, placeholder `Search your repositories, or paste a path`. Focusing it or typing opens `start-folder-list`, unless its text starts like a path: a drive letter then `:\` or `:/`, or `\\`, `/`, `~/` or `~\`. Then it is a pasted path and the list stays closed. ArrowDown and ArrowUp move a highlight through the list; Enter takes the highlighted entry, or presses `start-scan` when none is highlighted; Escape closes the list |
| `start-folder-list` | a listbox: the heading `Recent` over the entries of `recent`, then `Found on this computer` over those of `found`, each entry a `start-folder-option`. Only entries whose name or path holds the text (case-insensitive) are listed; all of them when the text is empty. A heading with no entry under it is left out; when none is left, `start-folder-none`: `No repository here matches "<text>". Paste the whole path, or choose the folder.` |
| `start-folder-option` | `data-path` the entry's `path`; it shows the entry's name, its path (its `link` for a copy) and `<branch> · <relative time of lastCommitAt>`, the branch left out when `branch` is null and the time when `lastCommitAt` is null (nothing when both are). Taking one puts its path in `start-folder`, closes the list and focuses `start-scan`; it does not scan |
| `start-pick` | `Choose folder…`, beside `start-folder`, shown only when `picker` is `true` and while the panel is on the `Folder` step of This computer. It calls `POST /api/folders/pick`; while that waits it is disabled and reads `Dialog open…`. `picked`: the answer's `folder` goes into `start-folder`, `start-scan` takes focus, and when the answer's `drawing` is not null `start-existing` shows. `cancelled`: nothing changes. `unavailable`: `start-pick` is hidden. A 400, 409 or 500 shows its message in `start-error` |
| `start-link` | Link: a text field, accessible name `Repository link`, placeholder `https://github.com/owner/repo`. 300 ms after its last change, a text that is not empty is checked with `POST /api/folders/check` `{"link"}`, and `start-link-hint` shows the answer of the latest check. Enter presses `start-scan` |
| `start-link-hint` | under `start-link`. Empty field: `A github.com, gitlab.com or bitbucket.org link, public or reachable with your own git sign-in.` Accepted: the answer's `link`, then `, branch <branch>` when `branch` is not null, then ` · copied into archdrawer's own folder, read-only` when `copied` is false, or ` · already on this computer` when it is true. Refused: the 400's message, `role="alert"` |
| `start-scan` | `Scan`. This computer: an empty `start-folder` shows `start-error` `Give the whole path, starting from the drive or from /.`; otherwise `POST /api/folders/check` `{"folder"}`, then, unless refused or `start-existing` shows, `POST /api/scans` `{"folder", "engine", "model"}`. Link: disabled until the latest check of the text accepted it; then `POST /api/scans` `{"link", "engine", "model"}`, unless the check's `drawing` is not null (`start-existing`). The engine and model are those of `start-engine`. On 202 the panel follows the scan (*Following a job*). A 409 for a scan already running makes the panel follow the scan its `scanId` names |
| `start-error` | one plain sentence, `role="alert"`, under the field: for the folder check, `This folder does not exist.` (`Not found`), `This is a file, not a folder.` (`Not a folder`), `Give the whole path, starting from the drive or from /.` (`The path must be absolute`); any other refusal of the check, the dialog, a scan, a join or a forget shows the server's message; for a failed scan, its `error` (`Could not reach the archdrawer server` when the server went away). A failed draw shows in `draw-error`. It is cleared by the next `start-scan` |
| `start-existing` | when the check's `drawing` is not null: `This folder already has a drawing.` with `start-open-existing` (`Open it`: `POST /api/files` with that path, then the editor) and `start-again` (`Start again`: goes on to the scan; the new drawing gets the next free name). Neither scans by itself |
| `source-recent` | in `home-nav`, under `Recent`: one `source-item` per entry of `recent` |
| `source-found` | in `home-nav`, under `Found on this computer` and beside `source-found-refresh`: one `source-item` per entry of `found` |
| `source-item` | `data-path` the entry's `path`; its name and, under it, `<branch> · <relative time of lastCommitAt>` as in `start-folder-option`; the path (or link) as its tooltip. Pressing it selects This computer, puts the path in `start-folder`, scrolls `start` into view and focuses `start-scan`; it does not scan |
| `source-forget` | in a `source-item` of *Recent* whose `diagrams` is empty, shown on hover and focus: icon button, accessible name `Remove <name> from Recent`. It asks `confirm("Remove \"<name>\" from Recent?")`, then, for an entry with a `link`, `confirm("Also delete the copy of <link> from this computer?")`, and calls `POST /api/sources/forget` `{"path", "deleteCopy"}` with the second answer |
| `source-found-refresh` | icon button, accessible name `Look again`: `POST /api/sources/refresh`; disabled until it answers |

While the panel follows a job, `start-source`, `start-folder`, `start-link`,
`start-pick` and `start-scan` are disabled, and the field shows the job's
folder (its `link` for a copy). When the following ends (*Following a job*)
they are enabled again.

### The scan and the repository card

| Test id | Element and behaviour |
|---|---|
| `scan-progress` | in the panel while the followed scan runs: a turning mark, `Scanning` (`Waiting for a free engine` while its `waiting` is true), the scan's `message` (its latest progress line), a bar sliding without end, and `scan-cancel` (`Cancel`: `POST /api/scans/:scanId/cancel`). A cancelled scan shows `start-error` `Cancelled`, a failed one its error; either ends the following, and the panel is on the `Folder` step with the folder kept |
| `scan-card` | in the side column in place of `home-continue`, once the followed scan has succeeded: the header `Project` with `scan-again` (`Scan again`: the same scan with `refresh: true`), `scan-card-name`, `scan-card-sentence`, `scan-card-type` (`AI agent project`, `Backend service`, `Full-stack app`, `Other project`, with `data-type`) and `scan-card-languages` (one tag per language), then the rows `Entry` (one `scan-card-entry` per entry point) and `Commit` (`scan-card-commit`, the short commit; absent outside git). A copy's scan adds `scan-card-link`, its link. A cached scan adds `scan-cached` (`Scanned before at <short commit>`) |

### Choosing what to draw

After a scan succeeds the panel holds, in this order: `focus-list`, the
destinations, and the bar.

| Test id | Element and behaviour |
|---|---|
| `focus-list` | the heading `What should it draw?`, `focus-count` at its right, then the choices as cards in two columns, each a checkbox (SCAN-3), in this order: `focus-whole`, `focus-sections`, `focus-flows`, `focus-typed`. None is ticked at first; any number may be. Space ticks the focused card |
| `focus-whole` | checkbox `The whole system`, the full width, always there, `data-kind="system"`, with the line `A map of the main parts; open each one for its inside` |
| `focus-sections` | the heading `Sections`, then one `focus-option` per option of kind `section`, in option order. Absent when the scan gave none |
| `focus-flows` | the heading `Flows`, then one `focus-option` per option of kind `flow`, in option order. Absent when the scan gave none |
| `focus-option` | one per option, a checkbox with `data-option` (`o1` …) and `data-kind` (`section` or `flow`): an icon, the title, the sentence and `focus-option-files`, one chip per file of the option. Only the first 3 chips show; with more, `focus-option-files-more` (`+<n> more`) shows the rest and goes |
| `focus-typed` | checkbox `Something else`, the full width, always there, `data-kind="custom"`. Ticking it shows and focuses `focus-text`, a text field of at most 300 chars (`What should the drawing explain?`); unticking hides it and keeps its text |
| `focus-none` | when the scan gave no option: `The scan found no sections or flows. Draw the whole system, or say what to draw.` |
| `focus-count` | once a choice is ticked: `<n> chosen` |
| `channel-choice-linkedin`, `channel-choice-readme`, `channel-choice-presentation` | under the heading `Where will it go?`, shown once a choice is ticked: radio cards `LinkedIn post` (`1080 × 1350`), `README drawing` (`wide · light or dark`) and `Presentation` (`16 : 9 slides`), each with a small frame of its shape. None is chosen at first. The one chosen is drawn for every choice (STORY-1) |
| `draw-summary` | in the bar: `Pick at least one` with no choice ticked; `<n> drawing` or `<n> drawings`, then `: choose where it will go` with no channel, or ` for a LinkedIn post`, ` for a README` or ` for a presentation` |
| `start-change-folder` | in the bar: `Change folder`: back to the `Folder` step, the folder kept, the ticks and the channel cleared |
| `draw-start` | in the bar: `Draw it` with one choice ticked, `Draw all <n>` with several; enabled once a choice is ticked and a channel chosen, and `focus-text` is not empty when `focus-typed` is ticked. It starts a `draw` run (`POST /api/runs`, *The draw run*) with the followed scan, `choices` in the order of `focus-list` (the whole system, the sections, the flows, then the typed text), the channel, and the engine and model of `start-engine`; on 202 the panel follows the run. A 409 whose `runId` names a running draw turns the step into a join (below), the ticks kept |

**Joining a running draw** (JOB-4). While `activity` lists a `draw` that
is `running`, not `writing`, has the followed scan's `folder` and `root`,
and whose `scan` is the followed scan, or a scan listed in `activity` with
the same `commit` (not null) and the same `options` as the followed scan,
the choosing step joins it:

- a choice the draw already holds is ticked, disabled and marked
  `focus-in-draw` (`In this draw`): the whole system by its `kind`
  `system`, an option by its kind and title, `focus-typed` when the draw
  holds a choice of kind `custom`;
- the destinations show the draw's channel, chosen and disabled, with
  `channel-locked`: `New choices join the draw that is running, so they take
  its <LinkedIn post | README drawing | presentation>.`;
- `draw-start` reads `Add it to the draw` or `Add all <n> to the draw`, `<n>`
  the new choices, and sends only those with
  `POST /api/runs/:runId/choices` `{"scan", "choices"}`; on 200 the panel
  follows that draw. A refusal (a 409 or a 400) shows its message in
  `start-error`, and `draw-start` stays disabled until the ticks change; a
  draw that `activity` no longer lists as `running` and not `writing` ends
  the join, and the step is a new draw again.

### Following a job

The panel follows one job at a time: the scan it started, the draw it
started or joined, or the job last pressed in `activity`. Following:

- a running scan shows `scan-progress`;
- a succeeded scan shows its choosing step, with its card and options as
  `activity` keeps them (JOB-7);
- a draw shows `draw-progress`, whatever its state: running, then
  `draw-ready` or `draw-error` once it ended. A draw that failed or was
  cancelled does not show its choosing step again: its choices and channel
  are not edited there. `draw-retry` tries it again; `draw-another` leaves
  it.

The following ends, and the panel then follows nothing, with its fields
enabled and on the `Folder` step, when: the followed scan failed or was
cancelled (the folder kept); `start-change-folder` is pressed (the folder
kept); `draw-another` (`Draw another project`) or `home-nav-new` is pressed
(the fields emptied); or the followed job answers 404 or `activity` no
longer lists it. A job left this way goes on in `activity`.

| Test id | Element and behaviour |
|---|---|
| `draw-progress` | one `draw-choice` per choice of the draw, in the draw's order, a joined choice added when its first `choice` event arrives; then one of three, under the rows: while the draw runs, `draw-line` (a turning mark and the draw's latest progress line, of any choice) with `draw-another` and `draw-cancel` (`Cancel`: `POST /api/runs/:runId/cancel`; hidden while `writing`); once it succeeded, `draw-ready`; once it failed or was cancelled, `draw-error`. The rows are shown once, as the draw ended |
| `draw-choice` | `data-choice` (its id in the run record), `data-kind` and `data-state` (its record's `status`: `waiting`, `running`, `done`, `failed`, `cancelled`). It shows `draw-choice-title` (its `title`), three `draw-stage`, `draw-choice-time` and `draw-choice-line` |
| `draw-stage` | one per stage, in order, with `data-stage` (`read`, `overview`, `channel`) and `data-state`: every stage `waiting` while the choice waits and `done` once it is done; else the stages before its `stage` `done`, its `stage` `running` (`failed` for a failed or cancelled choice), the later ones `waiting`. The texts are `Reading the code`, `Drawing the overview` (for the whole system `Drawing the map`) and `Drawing the <LinkedIn post / README drawing / presentation>` |
| `draw-choice-time` | `mm:ss` from its `startedAt`, every second, while it runs; from `startedAt` to `endedAt` once it ended; empty while it waits |
| `draw-choice-line` | waiting, while the draw runs: `Waiting for a free engine`; once the draw has ended: `Not started`. Running: `draw-choice-pulse`, then the `message` of the latest progress event whose `choice` is this choice, then `draw-choice-files` (`<n> files read`, `1 file read`; shown once `filesRead` is above 0), then `draw-choice-parts` (`<n> parts found`, `1 part found`; shown once `parts` is not null). Done: `Drawn`, then ` · <n> parts` when `parts` is not null. Failed: `Could not draw: <error>`. Cancelled: `Cancelled` |
| `draw-choice-pulse` | a dot; `data-events` counts the progress events of this choice received so far, and the dot beats once on each |
| `draw-choice-quiet` | in `draw-choice-line` in place of the message, while the choice runs and no engine line came for 30 s: the `at` of this choice's latest progress event with `source: "engine"` received on the stream, else its record's `lastEngineEventAt`, else its `startedAt`, is at least 30 s before the server's now. It reads `Quiet for <s> s — still running (limit <m> min)`, `<s>` the whole seconds since that time, every second; `<m>` the run time limit in whole minutes, `timeoutMs` of `GET /api/activity` / 60 000 rounded down. It goes with the next engine line |
| `draw-line` | the draw's latest progress line; `Writing the drawing` while it writes |
| `draw-ready` | once the draw `succeeded`, in place of `draw-line`: `Ready`, then `<k> drawing` or `<k> drawings`, `<k>` the `done` choices, then ` for a LinkedIn post`, ` for a README` or ` for a presentation`, then ` · <f> could not be drawn` when `<f>` choices failed; `draw-open` (`Open`: `/d/<diagramId>?choice=<choice>&channel=<channel>` of the run), `draw-another`; and, when a choice failed, `draw-retry` |
| `draw-error` | inside `draw-progress`, under the rows, once the draw ended `failed` or `cancelled`: its `error` (`Cancelled` for a cancel), `role="alert"`, with `draw-retry` and `draw-another` |
| `draw-retry` | `Try again`: `POST /api/runs/:runId/retry` (*Trying again*): after a draw that succeeded, its failed choices are drawn into its file; after one that failed or was cancelled, every choice into a new file, the finished ones from what was kept (a reused stage shows `running` with its `Using …` line, then `done`). On 202 the panel follows the new run. A refusal shows its message in `draw-error` after a draw that failed or was cancelled, and in `start-error` after one that succeeded |

No job opens the editor by itself (JOB-8): it opens only when the user
presses `draw-open`, `job-notice-open`, `activity-open`,
`start-open-existing`, `home-continue-open`, `library-example`, a library
card, or imports a file.

### Activity

`activity` is the first block of the side column in every state (JOB-7).
The page asks `GET /api/activity` when it loads, every 2 s while a listed
job is `running`, every 15 s otherwise, and at once after it starts, joins
or cancels a job. The followed job's own stream (`events`) moves its rows
between answers.

| Test id | Element and behaviour |
|---|---|
| `activity` | the header `Activity` with `activity-count`, then the jobs that are `running` (waiting ones included), newest `createdAt` first, then `Done` over the ended ones, newest `endedAt` first; `activity-none` (`Nothing is running.`) when no job runs; at the bottom `activity-keep`: `Keeps going if you reload. Up to <total> at once.`, `<total>` the answer's `slots.total` |
| `activity-count` | `<n> running`, `<n>` the jobs `running` and not `waiting`; hidden when 0 |
| `activity-job` | one per listed job: `data-job` its id, `data-type` (`scan`, `draw`), `data-state` (`waiting` while its `waiting` is true, else its `status`), `aria-current="true"` on the followed one. It shows a status dot, `activity-job-name` (its `name`), `activity-job-status` and, while it runs, `activity-job-time` (`mm:ss` from its `startedAt`, from its `createdAt` while `startedAt` is null). Pressing it makes the panel follow it |
| `activity-job-status` | a scan: `Scanning`; `Scan · <n> sections and flows` once it succeeded (`<n>` its options); `Scan failed`; `Scan cancelled`. A draw, after its channel's name (`LinkedIn post`, `README drawing`, `Presentation`) and ` · `: `<d> of <n> drawn` with several choices, `step <s> of 3` with one (`<s>` the place of its stage, 1–3); `quiet for <s> s` when a running choice is quiet (*Following a job*), the longest; `writing the drawing`; `Ready`, with `, <f> failed` after it when choices failed; `failed`; `cancelled`. While a job waits, whatever its type: `Waiting for a free engine` |
| `activity-open` | on an ended job: `Open` on a draw that succeeded (the editor, as `draw-open`); `Choose` on a scan that succeeded (the panel follows it) |
| `job-notice` | when a draw the page saw running ends `succeeded`: `<name> is ready` with `job-notice-open` (`Open`, as `draw-open`) and `job-notice-dismiss` (a close button, accessible name `Dismiss`), `role="status"`, at the top centre; it leaves after 8 s |
| `jobs-restarted` | when `instance` changes while the page followed jobs `running` (JOB-9): `The server restarted; <n> jobs stopped` (`The server restarted; 1 job stopped`), once, at the top of `activity`, until the page reloads |

### The engine

| Test id | Element and behaviour |
|---|---|
| `start-engine` | the side column's block `Engine`: `ai-engine` (label `Agent`) and `ai-model` (label `Model`), sharing their stored choice (*Choosing the engine*), and `start-engine-status`: `<label> <version> · reads only` for an available engine. The scan and the draw the page starts use them; a joining choice takes its draw's |
| `start-no-engine` | in `start-engine` when no engine is available: `To draw a project, install Claude Code or Codex and sign in to it.` with the commands `npm install -g @anthropic-ai/claude-code` and `npm install -g @openai/codex`. `start-scan` is disabled, and `library-example` shows |

### Drawings

Under `start`: the heading `Drawings` with `library-count`, then
`library-search` and `library-layout`, then the drawings.

| Test id | Element and behaviour |
|---|---|
| `library` | the drawings of `GET /api/diagrams`, newest `updatedAt` first, as cards in a grid (or rows in the list layout) |
| `library-count` | the number of drawings in the library, whatever the search |
| `library-search` | field `Search drawings`: shows only the drawings whose title or `library-item-path` holds its text, case-insensitive; with none, `library-none`: `No drawing matches "<text>"` |
| `library-layout` | `library-layout-grid` (`Grid`) and `library-layout-list` (`List`), icon buttons with `aria-pressed`; the choice is kept in this browser |
| `library-item` | one per drawing, `data-diagram-id`. Pressing it, or Enter on it, opens `/d/<id>`. It holds `library-item-preview`, `library-item-title`, `library-item-path`, `library-item-kinds`, `library-item-updated` and `library-menu`. In both themes the title has contrast ≥ 7:1 and the path ≥ 4.5:1 against the background; the title is larger and bolder |
| `library-item-preview` | the first view of the first choice's overview channel, drawn by `src/core` as the editor draws it, in the drawing's theme, from `GET /api/diagrams/:id` when the card comes into view. With more than 8 components it fills the frame (cut at its edges, centred); with 8 or fewer it is drawn whole. A drawing that cannot be read shows `No preview`. With more than one view in that channel, `library-item-views` (`<n> views`) and one dot per view; while the pointer is on the card the preview moves to the next view every 1.1 s, and back to the first when it leaves |
| `library-open` | `Open`, on the preview while the pointer is on the card or the card has focus: opens `/d/<id>` |
| `library-item-title` | the drawing's title |
| `library-item-path` | the file path; `Imported` for an imported drawing; the `link` for a drawing in a copy (SRC-6) |
| `library-item-kinds` | one dot per kind of component in the previewed view, at most 5, in the order they first appear, each titled with the kind's name |
| `library-item-updated` | the relative time of `updatedAt` |
| `library-menu` | button `⋯`, accessible name `More actions for <title>`; opens `library-menu-list` (Escape or a click elsewhere closes it) |
| `library-forget` | `Remove from list` (registered file) or `Delete` (imported); asks `confirm()` (`Remove "<title>" from this list? The file stays where it is.` / `Delete the imported drawing "<title>"?`). For a drawing in a copy it then asks `confirm("Also delete the copy of <link> from this computer?")` and, on yes, sends `DELETE /api/diagrams/:id?deleteCopy=true`; a refusal shows its message in `form-error` |
| `import-input` | file input (`.json`) behind `home-import`: a valid `@4`, `@3`, `@2` or `@1` document is imported and opened (`@3`, `@2` and `@1` converted, drawing contract); otherwise `form-error` shows the server's message and up to 8 violations, or `Not a JSON file: <message>` |
| `form-error` | under the top bar, `role="alert"`: an import's refusal (`import-input`) or a refusal of `library-forget`; cleared by the next import or forget |
| `library-empty` | when the library is empty: `No drawings yet` and `library-example` |
| `library-example` | `Open the example drawing`: `POST /api/example`, then opens it; shown in `library-empty` and with `start-no-engine` |
| `home-continue` | in the side column while the panel is on the `Folder` step and the library is not empty: the header `Continue`, the newest drawing's preview (as `library-item-preview`), its title, `edited <relative time>` and `home-continue-open` (`Open`) |

### The keyboard

Every control is reachable with Tab in this order: the top bar, `home-nav`,
`start` (the tabs, the field, `start-pick`, `start-scan`; or the
choices, the destinations, `start-change-folder`, `draw-start`; or the
rows' controls), the drawings, the side column. `Ctrl K` (`⌘ K` on macOS)
selects This computer and focuses `start-folder`, after `draw-another` when
the panel follows a job. Enter in a field acts as its button (`start-folder`
as said above); Space ticks a checkbox and chooses a destination; on the
choosing step, Enter on a focused choice or destination presses `draw-start`
when it is enabled.

## Editor frame

| Test id | Element and behaviour |
|---|---|
| `editor` | root; `data-theme` `light`/`dark`; `data-choice` the current choice's id; `data-channel` the current channel; `data-view` the current view id |
| `repo-name` | the document `title` |
| `channel-tabs` | the current choice's channels, four tabs in this order: `channel-tab-overview` (`Overview`), `channel-tab-linkedin` (`LinkedIn`), `channel-tab-readme` (`README`), `channel-tab-presentation` (`Presentation`); the current one `aria-current="true"`; a tab whose channel's `outdated` is not empty has `data-outdated="<n>"` and shows `channel-outdated-<channel>`, a dot with the accessible name `Needs update: <n> change(s)`; choosing a tab goes to that channel's first view |
| `crumbs` | overview channel only: the path of views from the current choice's first overview view to the current one, following `detail` links; earlier views are buttons `crumb-<viewId>`, the current one is text. Absent in the other channels |
| `save-status` | `Saved` when the file has the latest edit; `Saving…` while one is pending (edits are saved 350 ms after the last change, one request at a time, always the latest document); on failure the error and `save-retry` (`Retry`), never `Saved`; on 409 `The file changed outside the editor` and `save-reload` (`Load the file's version`), which loads the stored document |
| `canvas` | the drawing surface; `data-detail`, `data-tool`. Wheel zooms around the pointer (Ctrl+wheel and pinch faster); drag pans with the pan tool, or with any tool while Space is held or with the middle or right button; dragging empty canvas with the select tool box-selects; a drag never selects page text |
| `zoom-in`, `zoom-out`, `zoom-fit` | ×1.2 / ÷1.2 around the centre, zoom 15–300 %; fit shows the whole view at most 115 %. `zoom-level` shows the whole percent (`100%`) |
| `toast` | a message for about 2.6 s |
| `warnings` | shown when the document has `warnings`: `<n> warning(s) from the last change` and the list; a run that saves replaces them with its own, so after a clean run the banner is gone; `warnings-dismiss` clears them from the document |
| `views-panel` | the views panel (*Choices and the views panel*). There is no `views-button`, `views-menu` or `view-item-<viewId>` any more |
| `search-button` | also `/` or Ctrl/Cmd+K when no text input has focus: opens `search` with `search-input` focused (`/` or Ctrl/Cmd+K focuses it again when it is already open). A component matches when its label contains the typed text, case-insensitively. As you type, the matches on the current view are lit on the canvas (`node-<id>` `data-match="true"`, a ring drawn around the part) and every other component dims (`data-dim="true"` on `node-<id>`, and on every `edge-<id>` that does not join two matches); nothing moves and no part changes size. `search-count` shows `<n> match(es)`, `<i> of <n>` once stepped, or `No match in this view`; any typing in `search-input`, even of the same text, ends the stepping (no current match). Enter steps to the next match on this view and Shift+Enter to the previous one, wrapping (also `search-next`, `search-prev`): the match becomes `data-match="current"` and the only selected component, and the view moves, at the same zoom, only when that part is not wholly on screen or is behind the search panel (it is then centred below the panel). Matches in other views are listed under `In other views` (at most 50): `search-result` with `data-view` and `data-node-id`, label and view title; a click, or the arrow keys then Enter, goes to that view (fitted, then moved the same way only if the part is still off screen or behind the panel) with that match selected and current; with no match on this view, Enter opens the first listed one. `No component is called that` when no view has a match. Search stays open until Escape (in it, or anywhere outside a text input), which closes it, ends the highlight and dimming and keeps the selection |
| `ai-button` | toggles `ai-panel` |
| `present-start`, `tour-start` | presentation channel only: `Present` and `Tour` open `present` (*Presenting and the tour*). Disabled, with the title `Add a step first`, when the channel has no view or no step. They stay in the header at every width (icon-only, with these accessible names, below 900 px wide); `header-menu` is unchanged |
| `header-menu-button` | only below 900 px wide: opens `header-menu`, which then holds `repo-name`, `channel-tabs`, `crumbs`, `views-panel` (when there is one), `tool-undo`, `tool-redo`, `tool-theme`, `tool-steps`, `tool-sublines` |

Every icon-only button has an accessible name at every width.

| Test id | Key | Behaviour |
|---|---|---|
| `tool-select` | V | default; click selects, drag moves |
| `tool-pan` | H | drag pans |
| `tool-component` | C | a click opens the component picker there |
| `tool-connect` | E | drag from one component to another connects them |
| `tool-text` | T | a click opens a new text there (or edits the text clicked) |
| `tool-undo`, `tool-redo` | Ctrl/Cmd+Z; Ctrl/Cmd+Shift+Z or Ctrl+Y | disabled when there is nothing to undo/redo, while a run is going and while a result is in preview (*Preview, Accept and Undo*); their keys then show the toast of that state |
| `tool-theme` | — | toggles `theme` (saved; `aria-pressed` when dark) |
| `tool-steps` | — | toggles the current channel's `showSteps` (saved; `aria-pressed`) |
| `tool-sublines` | — | `Sub-lines`: toggles the current view's sub-line switch (`subLines`, drawing contract *View*; `aria-pressed` when on). One undoable edit, saved, changing only the current channel. Off, no `node-sub` is drawn in the view and every part shrinks to its icon and label (drawing contract, *Sub-lines*); on again, the field is removed from the view. Disabled on a channel with no view |
| `share-button` | — | opens `share-dialog` |

Tools have `aria-pressed` on the active one. Tool keys do nothing while a text
input has focus, with a modifier held, or while the share dialog is open.
Escape closes the header menu or the picker; otherwise (outside a text input)
it clears the selection and callouts and returns to the select tool.
Delete/Backspace with focus in the canvas deletes the selection.

`tool-hint`, one line over the canvas for every tool but select: component
`Click an empty spot to add a component`; connect `Drag from one component to
another to connect them`; text `Click anywhere to type text`; pan
`Drag to move around`.

**While a run is going**, every edit, undo and redo is refused with the toast
`Edits are paused while the instruction runs`; the run's result then arrives
as a preview (*Preview, Accept and Undo*) and, once kept, is one undo step.

**Undo/redo** covers every edit in every view of every channel, with the
`outdated` marks it set, and keeps the last 200 steps; a view or channel
change is not an edit; typing in one field within 0.9 s is one step;
a drag is one step.

**Semantic zoom.** `canvas` `data-detail` is `full` at ≥ 75 %, `outline` from
50 % to under 75 %, `overview` below 50 %. Sizes, positions and paths never
change with it. In `outline` the contents of every `edge-label-<id>` have
opacity 0; in `overview` also every `node-sub`, and connections without a
step are at 0.3.
The component whose callout is open, and labels of its connections, stay at
full opacity. Faded elements stay clickable.

### Choices and the views panel

A drawing holds one or more choices (drawing contract, *Choice*); the editor
shows one at a time, the **current choice**. `channel-tabs`, `crumbs`, the
canvas, search, the AI panel and its runs, the steps panel, presenting, the
tour and the share dialog with its downloads all act on the current choice
alone, and an edit changes only it (drawing contract, *Edits: facts or
channel*). Search looks in the current choice only. Undo and redo cover the
edits of every choice.

`views-panel` (`<nav>`, accessible name `Views`) lists every overview view
of every choice (NAV-2):

- It shows when the drawing has more than one choice, or its one choice's
  overview holds more than one view; otherwise it is absent.
- At 900 px wide and over, it sits left of the stage, 240 px wide and as
  tall as the stage, which narrows so nothing is covered. `views-collapse`
  (`aria-expanded`, accessible name `Hide views` while open, `Show views`
  while folded) folds it to a 40 px strip holding only that button, and back;
  the browser remembers it for every drawing.
- Below 900 px wide it is not beside the stage: `header-menu` holds it, with
  the same test ids, and choosing an entry closes the menu.

It lists, in this order: the `system` choice; `views-heading-section`
(`Sections`) and each `section` choice; `views-heading-flow` (`Flows`) and
each `flow` choice; `views-heading-custom` (`Your own`) and each `custom`
choice. Choices of a kind are in file order, and a heading shows only when
its kind has a choice. Each choice is `views-choice-<choiceId>`, with
`data-kind`, holding its entries:

- `views-entry-<viewId>` for its overview's first view, `data-depth="0"`,
  showing the choice's title;
- under it, `views-entry-<viewId>` for each other view of its overview,
  showing the view's title: first the views `detail` links reach from the
  first view, depth first, each after the view that links to it, in the order
  of the linking parts in that view's `nodes`, with `data-depth` 1, 2, 3 …
  and indented 16 px per level; then the views no link reaches, at depth 1,
  in file order.

Every entry is a button with `data-choice`, `data-view` and `data-depth`.
In the overview channel the current view's entry has `aria-current="true"`;
in any other channel the current choice's first entry has it. One click on
an entry goes to that view, in the overview channel of its choice, fitted;
the URL follows (*Routes*) and `crumbs` show its path. Going there is not an
edit, and it works during a run and a preview as going to a view always does.

Keyboard: every entry is in the tab order, after the header and before
`canvas`. Up and Down move the focus to the entry above or below (not
wrapping), Home and End to the first and the last; Enter or Space goes to
the entry's view.

## Channels

Each edit is split between the facts and the current channel (drawing
contract, *Edits: facts or channel*). In short: moving, form, icon, group
membership, shown items, steps, texts and captions change only the current
channel; a rename, description, files, a new part or connection change the
facts and show in every channel that draws them. Deleting a part or a
connection in the overview deletes its facts; in any other channel it only
leaves it out of that channel. The current channel is never marked.

| Test id | Element and behaviour |
|---|---|
| `channel-empty` | the stage of a channel with no view, instead of the canvas: `The <LinkedIn post / README drawing / presentation> is not drawn yet`. With an engine, `channel-draw` (`Draw it`) draws it from the facts alone, as a preview that, once accepted, is one undoable step: a `story` run whose request carries `readCode: false` (the engine is asked to read no file, and Claude Code runs with no tools; STORY-1). Without one, `channel-prepare` (`Prepare the simple version`; on LinkedIn `linkedin-prepare`) draws the simple version (*Simple versions*), and `post-engine-note` shows (`No engine available — prepared without AI`). LinkedIn also has the controls of *The LinkedIn flow*; its `channel-draw` may send the same run as a `post` with `readCode: false` (api contract: a post is a story on LinkedIn). Drawing tools and `share-button` are disabled there |
| `channel-outdated` | on the stage of a channel other than the overview whose `outdated` is not empty: `<n> change(s) in the facts since this was drawn`. `channel-keep` (`Keep as it is`) empties `outdated` as one undoable edit. `channel-redraw` (`Redraw it`) redraws the channel from the facts as one undoable step: with an engine a `story` run (a preview first) whose request carries `readCode: false`, without one the simple version. On the overview only `channel-keep` shows. Both are disabled during a run |

### Simple versions

Without an engine, `channel-prepare` (and `linkedin-prepare` on LinkedIn) and
`channel-redraw` draw a channel from the overview channel's first view (for a `system` choice the map and its detail views in `views-panel` order, skipping parts with a `detail`) in
code. It is one undoable edit that replaces what the channel held and empties
its `outdated`. The view keeps its id when the channel already has one, else
it is named as a story's new view is (drawing contract, *The view*: the
channel's name, such as `readme`, or `<choice id>-readme` outside the file's
first choice, `-2`, … when taken). It is titled `LinkedIn`, `README` or
`Presentation`, and its caption is copied from the overview's first view.

- **LinkedIn:** as *The LinkedIn flow* says.
- **README:** the overview's first view as it is:
  - the same parts, with the same ids, facts, forms, held mechanisms, limits
    and groups, and no own text;
  - the same connections and relations;
  - laid out again with the README format's spacing;
  - no texts.
- **Presentation:** the README's simple version, plus one step per numbered
  connection, in step order. Each step:
  - names the connection's two parts;
  - has as text the connection's drawn label, else
    `<from label> → <to label>`;
  - has an empty note.

  With no numbered connection, it has one step naming every top-level part,
  with the caption title as its text.

### README and presentation

The README channel is edited, measured and shared like the others. On the
presentation, `steps-panel` sits beside the drawn view (STORY-4):

| Test id | Element and behaviour |
|---|---|
| `steps-panel` | `Steps`: one `step-item` per step, in order (`data-step-id`, its number and text); the current one `aria-current="true"` |
| `step-item` | choosing it makes it current. Its parts get `data-step="on"` and every other part `data-dim="true"`, the way search dims them, never changing a part's size. `step-text` (input, at most 120 chars) and `step-note` (textarea, at most 1000 chars) edit the current step |
| `step-prev`, `step-next` | `Previous` and `Next` go one step back or on. They are disabled at the ends. With no step current, `Next` goes to the first. Left and right arrow keys do the same while focus is in the panel and not in a field |
| `step-parts` | `Parts in this step`: one checkbox per part of the view, checked for the step's parts. Unchecking the last one is refused, with the toast `A step highlights at least one part` |
| `step-add` | `Add a step` after the current one (else at the end). It holds the selected parts, else the current step's, and has the text `New step` and an empty note. At most 20 steps |
| `step-remove` | `Remove this step` |
| `step-up`, `step-down` | move the current step one place |
| `step-none` | without steps: `No steps yet`, with `step-add` |

Every step edit is undoable, saved like any edit, and changes only the
presentation channel. Escape on the canvas leaves the current step and
un-dims the parts. The steps are presented, toured and exported as slides
(*Presenting and the tour*, *Share*, *The slide image*).

## Drawing

| Test id | Element |
|---|---|
| `node-<id>` | one per component of the view; `data-kind`, `data-form`, `data-parent` (id or empty), `data-selected`, `data-changed="true"` while a run's result that added, changed or moved it is in preview (*Preview, Accept and Undo*); `data-dim="true"` while dimmed (an open callout or a search); `data-match` while search lights it (`true`, or `current` for the one stepped to); `data-lifted="true"` while it is dragged, `data-drag-dim="true"` while other parts are dragged, and on a group `data-drop-target="true"` while a dragged part would join it on release (*Dragging*); contains the outline with `data-shape` (drawing contract, *Geometry*, Shapes), `node-label`, `node-sub` (when drawn: non-empty and the view's sub-lines on), `node-inside` (when `detail` is set; a click goes to that view) and, on a part four or more parts use, `node-used-by` (*Parts many parts use*). No part draws an item, held or limit row. A group's `node-label`, `node-sub` and `node-inside` are in its `node-head-<id>` instead |
| `node-head-<id>` | a group's head, drawn over the connections and under the parts (drawing contract, *A group's name*): its icon, `node-label` and `node-sub` with their halo, and `node-inside`. Double-clicking its label renames the group as `node-label` does elsewhere |
| `node-used-by` | inside a hub's `node-<id>`: the mark `used by <n>`, `data-count="<n>"` (drawing contract, *Parts many parts use*). Hovering it is hovering the part |
| `port-<id>-<t\|r\|b\|l>` | four ports on the hovered component; dragging from one onto another component connects them |
| `edge-<id>` | `data-style`, `data-both`, `data-step` (number or empty), `data-selected`, `data-dim="true"` while dimmed (an open callout, a search, or numbered steps on and the connection has no step); `data-tone` `kind` or `neutral` and `data-focus="true"` while in focus (*Connections in focus*); `data-hidden="true"` while a hub hides it; `data-drag-dim="true"` while parts it does not touch are dragged |
| `edge-label-<id>` | the label when drawn (a label without room is left out, never drawn over a component); its border takes its line's colour while the line is coloured. Hovering it puts its connection in focus, as hovering the line does |
| `trunk` | one per shared trunk (drawing contract, *Trunks*): `data-part` (the part it arrives at), `data-side` (`t`, `r`, `b`, `l`), `data-edges` (the ids of its connections in view order, space-separated) and `data-tone`. Hovering it is hovering none of its connections |
| `step-badge-<id>` | while steps are on, on each connection with a step; never intersects a drawn label, also in `share-preview` and SVG downloads |
| `text-<id>` | `data-size`, `data-selected`; the text as real `<text>` |

The canvas draws the same markup and numbers as the share image: at 100 %
zoom, a `node-<id>` box has the size of the first `rect` of
`[data-node-id="<id>"]` in the exported SVG, and once no pointer is down every
`edge-<id>` line has the path of the `<g data-edge-id>` line in the export.
The marks of focus, dragging, guides and the drop target are the editor's
alone: no export, share preview or slide draws them.

### Connections in focus

Connections are drawn in one neutral colour (drawing contract, *Colour*). A
connection is *in focus* — `data-focus="true"`, `data-tone="kind"`, drawn in
its kind colours with its label's border in its colour — while:

- one of its ends is hovered (the pointer over its `node-<id>`) or selected,
  which includes the component whose callout is open;
- it is selected, or the pointer is over it or over its `edge-label-<id>`;
- one of its ends is being dragged;
- on the presentation channel with a step current, both its ends are in that
  step's parts;
- while search lights matches, both its ends match.

A connection with a step is always `data-tone="kind"`, with `data-focus` only
while in focus. Every other connection is `neutral`. Focus moves nothing and
changes no size.

**Parts many parts use.** A connection a hub hides (drawing contract, *Parts
many parts use*) is in the canvas as `edge-<id>` with `data-hidden="true"`:
not visible, taking no pointer input, with no label, badge or trace drawn.
While one of its ends is hovered, selected or dragged it shows: `data-hidden`
is absent, it is in focus, and its label, badge and trace are drawn where the
routing put them; nothing else moves. The hub's `callout-link-<otherId>`
chips list every connection, hidden or not.

### Selecting and moving

- A click on a component, text or connection selects it; Shift+click toggles
  it in the selection; a box drag selects what it touches.
- Dragging moves the selection (a group with everything inside), as
  *Dragging* says. A moved component whose centre lands inside a group
  becomes its child (as deep as nesting allows); outside every group it
  becomes top level.
- A click on a component also opens its callout, a second click closes it.
  A click on empty canvas clears the selection and callouts.
- After every edit, lanes stay valid: a component whose spine order is taken
  among its new siblings loses its lane, and a side lane whose anchor is gone,
  no longer a spine part, or inside the component is dropped.

### Dragging

EDIT-5, ADR 0013. A drag of components with the select tool:

- **What moves.** On every pointer move only the dragged components and the
  connections with an end among them are routed again (their sides held as
  the drawing contract's *While dragging* says, their ends gliding over
  120 ms), with their own labels and badges. Every other connection keeps its
  path, its `edge-label-<id>` box and its `step-badge-<id>`, and every
  group's `node-<id>` keeps its box, the dragged components' own groups too,
  until release. On release everything is measured, routed and placed again
  once, as the export draws it.
- **Lifted look.** Each dragged component has `data-lifted="true"`: a
  stronger shadow, with no scale and no size change (its box is the same
  during and after the drag). Its connections are in focus and drawn above
  every other connection, still under the components. Every other
  `node-<id>` and `edge-<id>` has `data-drag-dim="true"` and opacity 0.6. On
  release all of these go.
- **The target group.** While dragging, the group the piece under the pointer
  would join on release (by the rule above, its centre) has
  `data-drop-target="true"` and a box-shaped ring in the accent colour. Over
  no group, no component has it; after release none has it.
- **Guides and snapping.** The dragged components' bounding box is compared
  with the box of every other component that does not hold one of them: its
  left, centre and right with theirs, and its top, middle and bottom with
  theirs. Within 6 screen px (6 ÷ zoom in drawing px) it snaps to the nearest
  such line in each axis, and a `drag-guide` shows that line from the other
  box to the dragged one, with `data-axis` (`x` for a vertical line, `y` for
  a horizontal one) and `data-at` (its drawing coordinate). When the box
  lies between two components in a row — the nearest one each side whose
  boxes overlap it vertically — and the two gaps differ by at most 6 screen
  px, it snaps so they are equal, and one `drag-gap` marks each gap
  (`data-axis="x"`, `data-size` the gap in drawing px); likewise in a column
  (`data-axis="y"`). Where both would snap in one axis, the nearer wins, a
  guide on a tie. In an axis with no snap, every dragged component's
  position snaps to the 8 px grid during the drag. Positions are whole
  pixels, so release changes none of them.
- **Alt.** While Alt is held, no guide or gap mark shows and nothing snaps:
  the components follow the pointer, in whole pixels.
- **A drop never covers.** On release, a moved top-level piece (a group with
  everything inside) whose box overlaps a component that is neither moving
  nor one of the piece's new ancestors moves, with what it holds, to the
  nearest free spot: on the 8 px grid, searched ring by ring from where it
  was dropped, 24 px clear of every such component, and with the frames of
  its new groups, grown around it, clear of the components outside them, as
  *Adding a component* places a new one. It keeps the parent its drop gave
  it. A drop that overlaps nothing, inside a group's empty area too, stays
  exactly where it was released.
- **One save.** A drag is one edit and one undo step, saved once after
  release: one `PUT` per drag, and `save-status` does not show `Saving…`
  before release.

### Callout

Opens beside its component in free canvas at screen size, never covering it
or its neighbours where it can avoid them. `callout-pin` (`aria-pressed`,
`Pin to the side`) docks it as a side panel right of the stage, which
narrows so nothing is covered; the choice is remembered in the browser for
every component until unpinned.

| Test id | Element and behaviour |
|---|---|
| `callout-<id>` | the callout; `data-docked` `true`/`false` |
| `callout-title` | the label; a click gives `callout-title-input` (Enter or blur commits, Escape cancels, empty refused) |
| `callout-kind` | the kind label; opens `kind-menu` with `kind-option-<kind>` |
| `callout-form` | the form; opens `form-menu` with `form-option-<form>`, each a `form-thumb` and its name. Choosing `panel` shows the fact's items, or adds `New item` when it has none; leaving `panel` hides the items and keeps them in the fact (drawing contract, *Edits: facts or channel*); leaving `group` moves its members to its parent |
| `callout-icon` | opens `icon-menu`: `icon-option-default` (`Kind's icon`) and `icon-option-<name>` |
| `callout-description` | double-click: `callout-description-input` (Ctrl/Cmd+Enter or blur commits, Escape cancels, empty keeps the old text) |
| `callout-items` | (panel) `What it holds`: the part's rows in the file's order (drawing contract, *What a channel draws*), the only place they show, since no part draws them on the canvas or in an export (LOOK-3). One `callout-item` each, with `data-row` `held` (a held mechanism's label), `item` (a shown item) or `limit` (a limit's text, in the muted colour after a timer icon). Double-click gives `callout-item-input` (Enter/blur commits — a held row renames its mechanism and a limit row edits its limit, in every channel —, Escape cancels, emptied removes it); `callout-item-up`, `callout-item-down` (a row moves only among rows of its own `data-row`); `callout-item-remove` (a held or limit row only stops being held, drawing contract *Mechanisms and limits*); `callout-item-add` (`+ Add an item`, hidden at 12 rows) adds `New item` before the limits and edits it; removing the last row makes it a card |
| `callout-link-<otherId>` | a chip per connected component, `data-direction` `to`/`from`/`both`; a click selects it and opens its callout |
| `callout-files` | absent for a part that shows no fact; `callout-file` each with `callout-file-remove` (which removes it from every fact of the part that lists it); `callout-file-add` gives `callout-file-input` (Enter adds a repository-relative path, at most 20; a path outside the repository toasts `Use a path inside the repository, like src/app.ts`; Escape or blur cancels). A path that does not exist in the repository (`check-files`, api contract) still saves; its `callout-file` has `data-missing="true"` and shows `callout-file-missing` `not in the repository` |
| `callout-parent` | `<select>`: `""` (`Top level`) and every group of the view except the component and what it holds; choosing one moves it inside that group at a free spot |
| `callout-open-inside` | (`detail` set) `Open inside`: goes to that view |
| `callout-create-inside` | (`detail` null, on the overview: the other channels hold one view each) `Draw its inside`: adds a view titled after the component, id `<part id>-inside` (`-2`, `-3`, … when any view of the file has it), holding one copy of it (a group copied as a card), pointing to the same facts (a group with no fact copied with its drawn label, kind and description as its own), sets `detail`, goes there |
| `callout-ask` | `Change this part`: selects the component and opens `ai-panel` with `ai-scope-selection` chosen and `ai-input` focused |
| `callout-delete` | deletes the component, its connections, and moves a group's members to its parent; in the overview its facts go too, elsewhere it is only left out of this channel (*Channels*) |
| `callout-close` | closes |

On the canvas: double-click a label → `node-label-input`; a sub-line →
`node-sub-input` (below the label of a component without one adds one; with
the view's sub-lines off there is none to edit). Enter or blur commits,
Escape cancels; an empty label is refused. Rows are edited in the callout.

### Adding a component

`tool-component`, then a click on empty canvas opens `component-picker`:
`picker-kind-<kind>` (default `service`), `picker-form-<form>` (default
`card`, each with a `form-thumb`: a card, compact or panel drawn in the
chosen kind's shape, with its `data-shape`, and a group as `group`),
`picker-add` (`Add component`). Adding
places `New component` (id `new-component`, `-2`, …) of that kind and form
centred on the click, moved to the nearest free spot, inside the group
clicked in; a panel starts with `New item`, a group empty. `node-label-input`
opens with the text selected and the tool returns to select. Escape closes the
picker and adds nothing.

### Connections

A dragged connection is `call`, one-way, no label, no step. Onto a component
already connected the other way it makes that connection two-way (toast
`Made the connection two-way`); onto one connected the same way it adds
nothing (toast `Already connected`, or `Already connected both ways`).

Selecting one connection opens `edge-callout`: `edge-label-input` (Enter or
blur commits, Escape resets), `edge-style-call|async|dep` (`aria-pressed`),
`edge-both` (checkbox), `edge-step-input` (number; empty = no step),
`edge-reverse`, `edge-delete`.

### Texts

- `tool-text`, then a click on empty canvas opens `text-input` there, empty
  and focused, its first line centred on the click; a click on a text edits
  it. The tool returns to select. Double-click a text edits it too.
- `text-input` is a borderless textarea in the text's font, size, line height
  and colour, growing as typed; the drawn text hides under it. Enter is a new
  line; Escape, Ctrl/Cmd+Enter or a click elsewhere commits. Nothing typed
  adds nothing; an emptied text is deleted. A new text uses the last size
  chosen (20 px at first).
- Drag moves a text (snapped to 8 px on release). One selected text shows
  `text-handle-nw|ne|sw|se`; dragging one scales the text (8–200 px, one
  decimal), the opposite corner fixed, one undo step.
- One selected text shows `text-toolbar` above it (below it near the stage
  top): `text-size-s|m|l|xl` (16, 20, 28, 40 px; `aria-pressed` on an exact
  match) and `text-delete`.

### Views and steps

`node-inside`, `callout-open-inside` and a click on a part with an inside
(below) go to the component's `detail` view; `crumbs` and `views-panel` lead
back; going to a view fits it. A view removed by undo or a run falls back to
the first view of its choice. With `tool-steps` on, `step-badge-<id>` appear
and connections without a step dim; off, no badges.

**Opening a part's inside** (NAV-1, ADR 0015). A part whose `detail` is set
is a **part with an inside**, in any overview view of any choice, whatever
its form. Its `node-<id>` has `data-open="true"`, and it draws the open mark
(drawing contract, *Geometry*, The open mark): `node-inside` is that mark, and
the share image and every export draw it the same. With the select tool, in
place of what *Selecting and moving* says of a click on a component:

- a click on it (press and release with less than 3 screen px of movement
  between them, and no modifier key) goes to its `detail` view, fitted. It
  selects nothing, opens no callout and is not an edit;
- a drag of it moves it as any part is moved, and goes nowhere;
- Shift+click toggles it in the selection, as on any part, and opens its
  callout when it is then the only part selected; there `callout-title`
  renames it and `callout-open-inside` goes in. A box drag selects it too;
- it is focusable (`tabindex="0"`, `role="button"`, accessible name `Open
  <label>`), in the order of the view's `nodes`, after `canvas` in the tab
  order; Enter on it goes in.

A part with no inside behaves as before: a click selects it and opens its
callout.

## AI panel

The one place to type an instruction (AI-2). Beside the stage, not modal: the
canvas stays usable. Closed when a drawing opens; `ai-button` (accessible
name `Ask AI`) opens and closes it.

| Test id | Element and behaviour |
|---|---|
| `ai-panel` | the panel; `ai-close` or Escape inside it closes it |
| `ai-thread` | the conversation (below) |
| `ai-suggestions` | the current channel's suggestions (*Suggestions*) |
| `ai-input` | textarea, at most 4000 chars; placeholder `Ask <engine label> to change this drawing`; for the test engine `Ask the test engine (no AI) to change this drawing`; with no engine `Ask Claude to change this drawing`. Enter or Ctrl/Cmd+Enter sends; Shift+Enter adds a line break |
| `ai-engine` | `<select>` of available engines (value id, text label); absent without an engine |
| `ai-model` | `<select>`: `""` `Default`, then the engine's models; each engine remembers its own choice in the browser |
| `ai-engine-note` | `<label> reads the repository (read-only) and changes the drawing`; for the test engine `Test engine (no AI): it understands only add, remove, rename, hold, move and align, gives a canned post, a canned simplification and a canned second look, and changes nothing else`; without engine `No engine is available: the instruction is saved in the file for your next archdrawer session` |
| `ai-scope-view`, `ai-scope-selection`, `ai-scope-all` | radios `This view`, `Selected parts (<n>)`, `The whole channel`; default view; selection disabled (and falls back to view) without a selected component |
| `ai-send` | disabled while `ai-input` is empty, while a run is going, and on a channel with no view (`ai-button` still opens the panel there; the suggestions and `ai-look-again` are disabled too) |
| `ai-look-again` | `Look at the drawing again` (LAYOUT-4): renders the current view as the share image in the channel's default format with its starting switches (*Share*), at 1×, as PNG, and starts a `revise` run for the current choice, channel and view (`choice`, `channel`, `view`) with that image (api contract, *The second look*). Disabled during a run, on a channel with no view and without an engine |

Sending first waits until every edit is saved (else fails with
`Your last edit is not saved yet; the instruction was not sent`). With an
engine it starts `POST /api/runs` for the current choice, channel and view
(`choice`, `channel`, `view`), the scope `{"kind":"view"}`,
`{"kind":"parts","ids":[…]}` or `{"kind":"all"}`, and the chosen engine and
model (`null` for `Default`); `ai-input` is then cleared. Without an engine it
posts to `/api/diagrams/:id/requests` for the current choice, channel and view
(`choice`, `channel`, `view`). If the run's event stream closes for good, the
run is cancelled and fails with
`Lost the connection to the instruction, so it was stopped`. Only one run at a
time; the AI panel, the channel stages, the LinkedIn panel and the share
dialog share it.

**Choosing the engine**: the one last chosen in this browser if available;
else the document's `engine` if available and not the test engine; else the
first available real engine; else the test engine. The test engine is named
`Test engine (no AI)` everywhere.

### The conversation

`ai-thread` holds one `ai-turn` per run started on the open drawing, and per
request saved without an engine, oldest first, whichever control started it
(`ai-send`, a suggestion, `ai-look-again`, `channel-draw`, `channel-redraw`,
`design-post`, `explain-feed`). It lives in the browser's memory for the open
drawing: reloading or opening another drawing starts it empty, and nothing
of it is written to the file. Each turn has:

- `ai-turn-text`: the instruction as sent, or for a control without one its
  name (`Look at the drawing again`, `Draw it`, `Redraw it`, `Design the
  post`, `Rewrite it in plain words`, a suggestion's label);
- `ai-turn-where`: `<channel name> · <scope>` (`Overview · This view`,
  `README · Selected parts (2)`, …);
- `data-state`: `running`, `failed`, `cancelled`, `preview`, `accepted`,
  `undone`, `unchanged` (succeeded with `Nothing changed`) or `saved`
  (without an engine), and `data-run-id` when it was a run.

Only the latest turn holds these, each while its state calls for it:

| Test id | Element and behaviour |
|---|---|
| `ai-progress` | while running: `ai-progress-line` per message (last 12) and `ai-cancel` |
| `ai-error` | after a failed or cancelled run: the error (`Cancelled`) and `ai-retry` (`Try again`, the same request again as a new turn); a typed instruction is back in `ai-input`, unless the user typed another meanwhile |
| `ai-summary` | after success: e.g. `1 part added · 2 connections changed · 3 parts moved` (zeros left out; `Nothing changed`), with `data-added`, `data-removed`, `data-changed`, `data-moved`, `data-edges-added`, `data-edges-removed`, `data-edges-changed` |
| `ai-route` | after a refine succeeded: which way the instruction went (api contract, Routing), `data-route` `facts` or `story`: `Changed the facts: every channel that shows them shows it` or `Redrew this channel from the facts, without reading the code`. A run of another kind shows none |
| `layout-report` | after success, the run's report (below) |
| `ai-saved` | without an engine, after saving the request: `Saved in the file for your next archdrawer session` |

An earlier turn keeps `ai-turn-text`, `ai-turn-where`, its final
`data-state`, and `ai-turn-result`: its summary, its error, or the
`ai-saved` text.

### Preview, Accept and Undo

Every run on the open drawing but a `draw` arrives as a preview (AI-3): the
editor shows the saved result, and `ai-preview` appears over the stage, in
every channel, until the user chooses:

| Test id | Element and behaviour |
|---|---|
| `ai-preview` | `The drawing was updated: <summary>`, plus the route sentence after a refine |
| `ai-accept` | `Accept`: keeps the result. The turn becomes `accepted`; `tool-undo` then returns to the drawing before the run, as one step |
| `ai-undo` | `Undo`: returns to the drawing before the run, exactly as `tool-undo` would, and saves it; `tool-redo` brings the result back. The turn becomes `undone` |

When a preview starts, the editor goes once to the run's channel and view.
While it is shown, every component the run added, changed or moved has
`data-changed="true"`; edits are refused with the toast `Accept or undo the
AI's change first`, and `tool-undo` and `tool-redo` are disabled (their keys
show the same toast). Going to other views and channels, search, zoom and
the share dialog still work. Starting another run (any control in *The
conversation*) accepts the preview first. When the stored file changes
outside the editor during a preview, the preview ends as accepted and the
change is shown as in *External changes*. A reload ends it as accepted (the
file holds the result). A run whose summary is `Nothing changed` shows no
preview. A failed save of an Undo shows in `save-status`, never `Saved`.

### Suggestions

`ai-suggestions` shows the current channel's buttons (AI-4). Each starts a
run as `ai-send` would, with its instruction, the scope `This view` and the
chosen engine and model, and leaves `ai-input` as it is. A preview is
accepted first; every suggestion is disabled during a run and on a channel with no view. Without an engine
each saves its instruction as a request.

| Channel | Test id | Label | Run |
|---|---|---|---|
| overview | `ai-suggest-simpler` | `Simpler` | a `simplify` run on the overview's first view (the editor goes there first) with `Simplify the overview: keep every component in a detail view or a merged part` |
| overview | `ai-suggest-loop` | `Show the loop` | a refine: `Show the loop: draw the agent's loop and the checks around it as parts with numbered connections` |
| linkedin | `ai-suggest-shorter` | `Shorter for LinkedIn` | a refine: `Make it shorter for LinkedIn: fewer parts and shorter names` |
| readme | `ai-suggest-fewer-details` | `Fewer details` | a refine: `Show fewer details: hold mechanisms only where the story is about them` |
| presentation | `ai-suggest-fewer-steps` | `Fewer steps` | a refine: `Use fewer steps: merge steps that say the same thing` |

There is no `overview-suggestion` and no `simplify-overview` any more
(ADR 0007, ADR 0008).

## External changes

When the stored file changes outside the editor and the editor has no
unsaved edit and no run going, it shows the new document within 2 s with the
toast `Updated from the file`, except while `present` is open (*Presenting and
the tour*). With an unsaved edit, the next save gets 409 and `save-status`
says so.

Showing the file's version, after `Updated from the file` or `save-reload`,
starts a new history: `tool-undo` and `tool-redo` have nothing to step to until
the next edit, so undo never writes the editor's older version over a change a
session or the CLI made.

## Presenting and the tour

`present` is a layer over the whole window (`role="dialog"`, `aria-modal`)
with `data-mode` `present` or `tour`, `data-index` the slide shown and
`data-fullscreen` `true` while the layer is the browser's full-screen
element, else `false`. It shows the slides of *The slide image*: index 0 is
the opening slide, index *i* the *i*-th of the *n* steps. Nothing in it edits
the drawing, and the editor under it takes no key or pointer input while it
is open.

| Test id | Element and behaviour |
|---|---|
| `present-slide` | the slide's SVG, scaled to fit the space it has, keeping 16:9, centred on the canvas colour. In `present` mode it fills the layer; in `tour` mode it shares the layer with `tour-panel` |
| `present-status` | a polite live region, visually hidden, independent of the toggles: `Step <i> of <n>: <text>` on a step, the presentation view's `caption.title` on the opening slide |
| `present-hint` | `present` mode only: `← → to move · Esc to exit`, shown until `data-index` first changes |
| `present-note-toggle` | `present` mode only, hidden on the opening slide: `Speaker note` (`aria-expanded`, closed when the layer opens, and kept open or closed from slide to slide); open, it shows `present-note`: the step's `note` with its newlines, or `No note for this step` |
| `present-exit` | `Exit`; leaves as Escape does |
| `tour-panel` | `tour` mode only: beside the slide when the window is at least 900 px wide, else under it. Holds `tour-note` (the step's `note` with its newlines, or `No note for this step`) and one `tour-part` per part in the step's `parts`, in the order of the view's `nodes` (`data-node-id`, the part's label) |
| `tour-file` | in a `tour-part`: its files, each path once. They are gathered from the part's `facts` in order, then its `held` facts in order; for each fact its `files` first, then its `evidence` files not already listed. Text: the path, then for each evidence range on that path in that order `:<from>–<to>` (`:<from>` when `from` = `to`), joined by `, `. A part with no file shows `No files recorded` instead |
| `tour-copy` | one per `tour-file`: `Copy path`; copies the path alone; toast `Copied the path`, or `Copying is not allowed here` |

Entering:

- `present-start` opens `present` mode on the opening slide and asks the
  browser for full screen on the layer. A refused or unsupported full screen
  leaves the layer open, filling the window, with `data-fullscreen="false"`.
- `tour-start` opens `tour` mode on the first step, never full screen.
- Focus moves to the layer itself (`tabindex="-1"`); Tab and Shift+Tab cycle
  inside it. The theme is the drawing's `theme`. The share toggles are the
  slide format's starting toggles (*Share*), except that the opening slide
  always shows the caption's title and, when not empty, its lede.

Keys, while the layer is open. Space and Enter on a focused button activate
it and do not move; no other key acts on a focused button.

| Key | `present` | `tour` |
|---|---|---|
| Right, Down, Space, PageDown | next slide | next step |
| Left, Up, PageUp | previous slide | previous step |
| Home | the opening slide | the first step |
| End | the last step | the last step |
| N | toggles `present-note` on a step; nothing on the opening slide | nothing |
| Escape | leaves | leaves |

A click on `present-slide` is the next slide. Moving past either end does
nothing. In `present` mode, once the layer has been full screen, the browser
leaving full screen (its own Escape, or F11) leaves the layer as well.

Leaving returns focus to the button that opened the layer and makes the step
shown current in `steps-panel` (no step current after the opening slide).

While the layer is open, an outside change to the file (*External changes*)
re-renders the slide shown, with no toast. A step is followed by its `id`:
the step shown stays shown wherever it moved; when it was removed the last
step is shown; the opening slide stays the opening slide. When no step is
left the layer closes with the toast `The presentation has no steps any
more`.

## Share

`share-dialog` is a modal (`role="dialog"`): focus moves into it, Tab and
Shift+Tab cycle inside it, closing returns focus to `share-button`. It shows
`share-preview` — the actual export SVG with `data-view`, `data-width`,
`data-height`, scaled to fit — and `share-size` (`1600 × 900`). The dialog
packages the view as it is: it offers no simplifying and no sharing of one
part (SHARE-2).

| Test id | Element and behaviour |
|---|---|
| `format-feed`, `format-readme`, `format-slide`, `format-square` | `Where will you share it?` (`aria-pressed`): `LinkedIn` 1080×1350, `README` 1600×900, `Slide` 1920×1080, `Square post` 1080×1080. `format-feed` is also pressed for the wide post. Default `format-feed` on the LinkedIn channel, `format-slide` on the presentation, else `format-readme` |
| `share-theme-light`, `share-theme-dark` | the image theme (default the drawing's) |
| `share-advanced-toggle` | `Advanced options` (`aria-expanded`); shows `share-advanced`: `format-linkedin` (`Landscape LinkedIn post`, 1620×1080) and checkboxes `show-title`, `show-lede`, `show-sub` (`Sub-lines`), `show-steps`, `show-labels`, `show-legend`, `show-texts`. Starting toggles (reset when the format changes): on the LinkedIn channel, or with `format-feed`, title, description, numbered path, labels and texts on, colour key off; Square: title, description, numbered path and texts on, labels and colour key off; otherwise title, numbered path, labels, colour key and texts on, description off; in every format `show-sub` starts as the view's sub-line switch (`tool-sublines`). There is no `show-items`: no part draws rows |
| `share-actions` | always visible: `readability`, `layout-report`, `download-png`, `download-svg`, `copy-image`; on the presentation channel also `download-slides-pdf` and `download-slides-png` |
| `readability` | `data-level` `good`/`ok`/`warn`; one plain sentence for the chosen destination with at most one suggestion, and no numbers (Readability, below); `readability-details-toggle` (`Details`, `aria-expanded`, closed when the dialog opens) shows `readability-details`: `Names <a> px and text <b> px <where>, <c> px opened.` |
| `share-clipped` | when component text is shortened with `…`: `Shortened in this image:` and `share-clipped-item` per text (`<label>: <full text>`) |
| `download-png` | `<slug>-<view>-<format>.png`, at twice the image size |
| `download-svg` | the same name with `.svg`; fonts embedded |
| `download-slides-pdf` | `Slides as PDF`: `<slug>-slides.pdf`, one page per slide (*The slide image*), the opening slide first. Disabled, with the title `Add a step first`, without a step |
| `download-slides-png` | `Slides as PNG`: `<slug>-slides.zip` holding `<slug>-slide-00.png` (the opening slide) to `<slug>-slide-<nn>.png`, two digits, each at twice the slide size. Disabled like `download-slides-pdf` |
| `copy-image` | copies the PNG; toast `Copied the image` or `Copying images is not allowed here — use Download PNG` |
| `share-close` | closes; also Escape or a click on the backdrop |

Both slide downloads use the dialog's theme and its toggles as they are when
pressed — they follow the format chosen, as always, and `format-slide` is the
default on the presentation channel — with title and description on the
opening slide only. The format sets nothing else: a slide is always
1920 × 1080. While the slides are being made both buttons are
disabled and the one pressed says `Making slides…`; a failure shows the toast
`The slides could not be made` and no file.

`<slug>`: the title lower-cased, accents removed, non-alphanumerics → `-`,
trimmed (`diagram` when empty).

Suggestion: none at `good`; with sub-lines shown,
`hiding the sub-lines would help`; else on a LinkedIn or Square format
and not on the LinkedIn channel, `the LinkedIn version would help`; else
`a larger format would help`.

### The LinkedIn flow

The LinkedIn channel is drawn and redrawn on its own tab; the share dialog
only packages what the current channel shows (SHARE-2) and holds none of the
controls below.

- On the LinkedIn channel's `channel-empty` stage, `linkedin-flow`: with an
  engine, `channel-draw` (`Draw it`) starts a `post` run from the facts
  alone (`readCode: false`: the engine is asked to read no file, and Claude
  Code runs with no tools; STORY-1) and
  `design-post` (`Design the post`) one that may also read the code (the
  chosen engine and model, format `feed`); without one, `linkedin-prepare`
  (`Prepare the simple version`) and `post-engine-note`
  (`No engine available — prepared without AI`). Choosing a channel never
  starts a run.
- With an engine, `linkedin-flow` also holds `stage-engine` (a `<select>` of
  the available engines, value id and text label, as `ai-engine`) and
  `stage-model` (a `<select>`, `""` `Default` then the engine's models, as
  `ai-model`). They show and change the engine and model `channel-draw` and
  `design-post` use. Their choice is the one `ai-engine` and `ai-model` store
  (*Choosing the engine*): a change in either place shows in the other at
  once, and in `start-engine`. They are disabled during a run and absent
  without an engine. The rest of the empty stage stays as `channel-empty`
  says: drawing tools, `ai-send` and `share-button` stay disabled.
- Beside the drawn LinkedIn channel, `linkedin-panel` (`LinkedIn post`):
  `share-caption-title` and `share-caption-lede` edit its caption
  (undoable); `arrange-feed` (`Re-arrange`) places its parts again by their
  lanes for the portrait feed (an undoable edit, no engine); `design-post`
  (with an engine) redesigns it; `explain-feed` (`Rewrite it in plain words`)
  starts a `post` run with the instruction `Rewrite this post in plain words
  for someone who has never seen the project`; without an engine
  `post-engine-note` shows, and a rewrite is saved as a request
  (`share-run-saved` with the `ai-saved` text).
- During a post run started there: `share-run` with the latest line and
  `share-run-cancel`; caption, design, rewrite and re-arrange are disabled.
  On failure or cancel `share-run-error` with `share-run-retry`
  (`Try again`, same request). On success the LinkedIn tab shows the saved
  post.
- In the share dialog on the LinkedIn channel, switching between the portrait
  and the wide format previews the post placed by its lanes for that
  orientation without writing anything.

**Without an engine**, `linkedin-prepare` draws the LinkedIn channel's view
from the overview channel's first view (for a `system` choice the map and its detail views in `views-panel` order, skipping parts with a `detail`) as one undoable edit, replacing what
the channel held and emptying its `outdated`. The view's id is kept when the
channel already has a view, else it is named as a story's new view is
(drawing contract, *The view*: `linkedin`, or `<choice id>-linkedin` outside
the file's first choice, `-2`, … when taken); its title `LinkedIn`, its caption copied from the overview's first view:

- groups fold into one part each (members not drawn); texts are left out;
  connections inside one group disappear; two connections between the same
  parts become one (two-way when opposite), keeping the earlier step and its
  label; steps are renumbered 1, 2, 3 …;
- importance per part: 4 if it ends a numbered connection, +1 per connection
  (at most 4), +2 if it holds something (items, or a folded group's
  members), +1 if its description is not `No description yet.`; ties by
  main-path order, then view order;
- the open parts — score ≥ 5, at most 4 — are panels whose own `items` are
  up to 5 entries (a longer list ends `+ <n> more`), shown in the callout, or
  cards when they hold nothing; other main-path parts are cards; the rest
  compact; a card whose sub-line would be shortened becomes compact;
- the main path runs along a grid of three columns (two when that reads more
  than 8 % larger), turning back at each row; other parts sit beside what they
  connect to; columns use their own widest part;
- a part keeps its overview part's id and points to the same facts (a folded
  group to the group's facts and its members', each once), with no own text
  unless the folding needs one (a folded group that shows several facts or
  none keeps its group's drawn label, kind and description as its own); a
  connection shows the relations its overview connections showed; connection
  ids are `li-e`, `li-e-2`, …

### Layout report

`layout-report` presents the API's layout report in one line, e.g.
`0 crossings · 0 connections over parts · nothing cut · 9.5 px in place ·
8 parts / 12 · 2 zones / 0–4 · 10 connections / 14 · longest 0.42`, with
`data-crossings`, `data-over-parts`, `data-cut`, `data-over-limit`,
`data-in-place`, `data-opened`, `data-level`, `data-parts`, `data-zones`,
`data-connections`, `data-longest`, `data-view`, `data-format` (unrounded).
`layout-report-warning` lists one line per over-limit text, cut text and
missed count target, naming the part and a fitting change. In the share
dialog it is recomputed for the preview's format, toggles and caption;
in the AI panel it is the finished run's.

### The share image

The same image comes from the preview, the downloads, `archdrawer svg` and
`export.svg`.

- Exactly the format's size: root `<svg>` with `xmlns`, `width`, `height`,
  `viewBox`, `data-theme`, `data-format`; a canvas-colour background; the
  drawing fitted inside the margins (wide post and square 24 px, README and
  feed 32, slide 40). No editor chrome, no `<foreignObject>`, no `<script>`,
  and no product mark: the text `archdrawer` appears nowhere.
- One `<g data-node-id>` per drawn component (`data-kind`, `data-form`), one
  `<g data-edge-id>` per drawn connection holding its line, label and badge
  (`data-tone`; a connection a hub hides has none), one `<g data-trunk>` per
  trunk, one `<g data-group-head>` per group, `<g data-text-id>` per text;
  labels as real `<text>` (drawing contract, *Connections*).
- `show-title` draws `caption.title`, `show-lede` `caption.lede`,
  `show-legend` one key entry (dot and kind label) per kind present. README,
  slide and square place caption and key in a free corner (together if they
  fit), else in a strip under the drawing (title left, key right). Both post
  formats put title and description across the top and nothing under the
  drawing; a key goes in a free corner or is left out.
- Caption text wraps and is never shortened. `show-sub` off draws every
  part without its sub-line, measured without it (drawing contract,
  *Sub-lines*) and shrunk around its own centre, and on draws every part with
  it, grown around its centre, when the view's switch is off; matching the
  view's switch, parts are drawn as the view places them. `show-steps` draws
  badges; `show-labels` off hides connection labels; `show-texts` off hides
  texts.
- Caption sizes in image px (title / description / key): wide post 36/28/27,
  README 32/20/18, slide 38/24/21, square 30/19/18, feed 36/22/21.

### The slide image

The presenter, the tour and the slide downloads show one image per slide,
made from the presentation view. It is the share image of the `slide` format
(*The share image*) with these differences:

- Root `<svg>` 1920 × 1080 with `data-format="slide"`, `data-slide` (the
  index) and `data-theme`.
- **Opening slide** (index 0): the caption as the toggles say and the whole
  view; nothing dimmed; no band.
- **Step slide** (index *i*, 1 ≤ *i* ≤ *n*, *n* the number of steps): no
  caption. Dimmed, with `data-dim="true"` and `opacity="0.25"` on its group:
  - every `<g data-node-id>` whose part is not in the step's `parts` — a
    group part too, even when parts inside it are lit; a lit group does not
    light its children;
  - every `<g data-edge-id>` unless both its `from` and its `to` are in the
    step's `parts` (its label and badge are inside the group and dim with it);
  - every `<g data-text-id>`.

  A dimmed part keeps its box. Along the bottom, `<g data-slide-band>` holds
  the step's `text` (`data-slide-text`, weight 500, at most 1640 px wide,
  never shortened: 34 px on up to two lines, else 28 px on up to three, else
  22 px on as many as it needs) and the counter `<i> / <n>` (`data-slide-count`, mono 24 px,
  right-aligned on the last line's baseline). The drawing is fitted into the
  margins above the band.
- Badges, labels, sub-lines, texts and the key follow the toggles given.

### Readability

From the text actually drawn: `opened` is the smallest font size in image px
(drawing text scaled with the drawing; caption text as is), also for
component and group names alone. With `seen` the width the image is shown at
(552 px for both LinkedIn formats and square, 880 README, 1280 slide),
`inPlace = opened × seen / imageWidth`. Level `good` when names' `inPlace ≥ 9`
and all text's `inPlace ≥ 6.5`; else `ok` when `opened ≥ 8`; else `warn`.

The `readability` line says the level in one plain sentence (SHARE-3), with
`<where>` the destination — `in the LinkedIn feed` (both LinkedIn formats),
`in a GitHub README`, `on a projected slide`, `in a feed` (square) — and the
suggestion, when there is one, after a semicolon:

| Level | Sentence |
|---|---|
| `good` | `The text is readable <where> as it is.` |
| `ok` | `The text is too small to read <where> until the image is opened[; <suggestion>].` |
| `warn` | `The text will be too small to read <where>, even when the image is opened[; <suggestion>].` |
| no text drawn (`warn`) | `The image has no text to read.` |

The sentence holds no numbers; `readability-details` holds them, with one
decimal.
