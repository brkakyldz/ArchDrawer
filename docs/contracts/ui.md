# Contract — the web client

What the browser shows and how it behaves: the library, the editor (canvas,
callouts, connections, texts, views), the AI panel, and the share
dialog with its image. Every element named here carries
`data-testid="<id>"`; `<x>` marks a template (`node-api`). Behaviour is
normative for end-to-end tests; styling is not, except where stated.

Implemented by: `src/web/App.tsx`, `src/web/library/Library.tsx`,
`src/web/library/Start.tsx`,
`src/web/editor/*` (Editor, Canvas, Callout, Panels, AiPanel, Find,
Views, LoadError, ops, runner, useAutosave, useDocHistory, viewport),
`src/web/share/ShareDialog.tsx`, `src/web/ui/LayoutReport.tsx`,
`src/core/export/svg.ts`, `src/core/export/share.ts`,
`src/core/export/feed.ts`.

## Routes

- `/` — **Library**. `/d/<id>` — **Editor** on the overview channel's first
  view; `/d/<id>?channel=<channel>&view=<viewId>` opens that channel and view
  (`view` defaults to the channel's first view). Going to a channel or view
  updates the URL. Reloading shows the same thing. An older link with only
  `?view=<viewId>` opens the channel holding that view (view ids are unique
  in the file); an unknown channel or view opens the overview.
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

## Library

| Test id | Element and behaviour |
|---|---|
| `library` | the list, newest `updatedAt` first |
| `library-item` | one per drawing, `data-diagram-id`; holds `library-item-title` and `library-item-path` (the file path, or `Imported`). In both themes the title has contrast ≥ 7:1 and the path ≥ 4.5:1 against the background; the title is larger and bolder |
| `library-open` | opens `/d/<id>` |
| `library-menu` | button `⋯`, accessible name `More actions for <title>`; opens `library-menu-list` (Escape or a click elsewhere closes it) |
| `library-forget` | `Remove from list` (registered file) or `Delete` (imported); asks `confirm()` (`Remove "<title>" from this list? The file stays where it is.` / `Delete the imported drawing "<title>"?`) |
| `import-input` | file input (`.json`): a valid `@3`, `@2` or `@1` document is imported and opened (`@2` and `@1` converted, drawing contract); otherwise `form-error` shows the server's message and up to 8 violations, or `Not a JSON file: <message>` |
| `library-example` | `Open the example drawing`: `POST /api/example`, then opens it; shown when the list is empty, beside the start flow |

### Starting a drawing from a folder

`start` sits above the list, whether the library is empty or full (START-4).
It moves through four choices, each kept while the user goes on: folder,
focus, channel, draw. Every control is reachable by keyboard in that order.
Enter in a field acts as its button.

| Test id | Element and behaviour |
|---|---|
| `start-folder` | text field `Folder of the project`, placeholder `C:\code\my-project` on Windows, else `/home/me/my-project`. Its list (`<datalist>`) offers the folders of the drawings in the library: each registered file's repository root, once each |
| `start-scan` | `Scan`. It first checks the folder (`POST /api/folders/check`); a refused folder shows `start-error` and nothing else happens |
| `start-error` | one plain sentence (`role="alert"`) for the server's refusal: `This folder does not exist.`, `This is a file, not a folder.`, `Give the whole path, starting from the drive or from /.`. For a failed scan, its error (`Could not reach the archdrawer server` when the server went away); a failed draw shows in `draw-error` |
| `start-existing` | when the folder has `docs/architecture.archdraw.json` (`drawing` from the check): `This folder already has a drawing.` with `start-open-existing` (`Open it`: `POST /api/files` with that path, then the editor) and `start-again` (`Start again`: goes on to the scan; the new drawing gets the next free name). Neither scans by itself |
| `start-no-engine` | when no engine is available: `To draw a project, install Claude Code or Codex and sign in to it.` with the commands `npm install -g @anthropic-ai/claude-code` and `npm install -g @openai/codex`. `start-scan` is disabled, and `library-example` shows beside it |
| `start-engine` | the engine and model a scan and a draw use, as `ai-engine` and `ai-model` choose them and sharing their stored choice (*Choosing the engine*) |
| `scan-progress` | while the scan runs: its latest progress line, and `scan-cancel` (`Cancel`). A cancelled scan shows `start-error` `Cancelled` and keeps the folder |
| `scan-card` | the repository card: `scan-card-name`, `scan-card-sentence`, `scan-card-type` (`AI agent project`, `Backend service`, `Full-stack app`, `Other project`, with `data-type`), `scan-card-languages`, `scan-card-entry` (one per entry point). A cached scan adds `scan-cached` (`Scanned before at <short commit>`) and `scan-again` (`Scan again`: `refresh: true`) |
| `focus-option` | one per option, a radio with `data-option` (`o1` …) and `data-kind`. It shows the title, the sentence and `focus-option-files`, one line per file |
| `focus-whole` | radio `The whole system`, always there (SCAN-3) |
| `focus-typed` | radio `Something else`, always there. Choosing it focuses `focus-text`, a text field of at most 300 chars (`What should the drawing explain?`) |
| `channel-choice-linkedin`, `channel-choice-readme`, `channel-choice-presentation` | radios `LinkedIn post`, `README drawing`, `Presentation`, shown once a focus is chosen. None is chosen at first (STORY-1) |
| `draw-start` | `Draw it`, enabled once a focus and a channel are chosen (and `focus-text` is not empty for a typed focus). It starts the `draw` run (api contract, The draw run) |
| `draw-progress` | while the run goes: `draw-stage` per stage, in order, with `data-stage` (`read`, `overview`, `channel`) and `data-state` (`waiting`, `running`, `done`). The texts are `Reading the code`, `Drawing the overview` and `Drawing the <LinkedIn post / README drawing / presentation>`. Also `draw-line` (the latest progress line) and `draw-cancel` |
| `draw-error` | after a failed or cancelled draw: the error, and `draw-retry` (`Try again`, the same choices; it starts from the first stage that did not finish, api contract *What a failed draw keeps*: a reused stage shows `running` with its `Using …` line in `draw-line`, then `done` once the next stage starts). Folder, card, focus and channel stay chosen; nothing was written |

On success the editor opens on the new drawing at the chosen channel
(`/d/<id>?channel=<channel>`), and the drawing is in the list. While a scan or
a draw runs, the folder, focus and channel controls are disabled.


## Editor frame

| Test id | Element and behaviour |
|---|---|
| `editor` | root; `data-theme` `light`/`dark`; `data-channel` the current channel; `data-view` the current view id |
| `repo-name` | the document `title` |
| `channel-tabs` | four tabs in this order: `channel-tab-overview` (`Overview`), `channel-tab-linkedin` (`LinkedIn`), `channel-tab-readme` (`README`), `channel-tab-presentation` (`Presentation`); the current one `aria-current="true"`; a tab whose channel's `outdated` is not empty has `data-outdated="<n>"` and shows `channel-outdated-<channel>`, a dot with the accessible name `Needs update: <n> change(s)`; choosing a tab goes to that channel's first view |
| `crumbs` | overview channel only: the path of views from its first view to the current one, following `detail` links; earlier views are buttons `crumb-<viewId>`, the current one is text. Absent in the other channels |
| `save-status` | `Saved` when the file has the latest edit; `Saving…` while one is pending (edits are saved 350 ms after the last change, one request at a time, always the latest document); on failure the error and `save-retry` (`Retry`), never `Saved`; on 409 `The file changed outside the editor` and `save-reload` (`Load the file's version`), which loads the stored document |
| `canvas` | the drawing surface; `data-detail`, `data-tool`. Wheel zooms around the pointer (Ctrl+wheel and pinch faster); drag pans with the pan tool, or with any tool while Space is held or with the middle or right button; dragging empty canvas with the select tool box-selects; a drag never selects page text |
| `zoom-in`, `zoom-out`, `zoom-fit` | ×1.2 / ÷1.2 around the centre, zoom 15–300 %; fit shows the whole view at most 115 %. `zoom-level` shows the whole percent (`100%`) |
| `toast` | a message for about 2.6 s |
| `warnings` | shown when the document has `warnings`: `<n> warning(s) from the last change` and the list; a run that saves replaces them with its own, so after a clean run the banner is gone; `warnings-dismiss` clears them from the document |
| `views-button` | overview channel only, when it holds more than one view: opens `views-menu`: `view-item-<viewId>` for every overview view in file order (`data-kind` `Overview`/`Detail`), the current one `aria-current="true"`; choosing one goes there |
| `search-button` | also `/` or Ctrl/Cmd+K when no text input has focus: opens `search` with `search-input` focused (`/` or Ctrl/Cmd+K focuses it again when it is already open). A component matches when its label contains the typed text, case-insensitively. As you type, the matches on the current view are lit on the canvas (`node-<id>` `data-match="true"`, a ring drawn around the part) and every other component dims (`data-dim="true"` on `node-<id>`, and on every `edge-<id>` that does not join two matches); nothing moves and no part changes size. `search-count` shows `<n> match(es)`, `<i> of <n>` once stepped, or `No match in this view`; any typing in `search-input`, even of the same text, ends the stepping (no current match). Enter steps to the next match on this view and Shift+Enter to the previous one, wrapping (also `search-next`, `search-prev`): the match becomes `data-match="current"` and the only selected component, and the view moves, at the same zoom, only when that part is not wholly on screen or is behind the search panel (it is then centred below the panel). Matches in other views are listed under `In other views` (at most 50): `search-result` with `data-view` and `data-node-id`, label and view title; a click, or the arrow keys then Enter, goes to that view (fitted, then moved the same way only if the part is still off screen or behind the panel) with that match selected and current; with no match on this view, Enter opens the first listed one. `No component is called that` when no view has a match. Search stays open until Escape (in it, or anywhere outside a text input), which closes it, ends the highlight and dimming and keeps the selection |
| `ai-button` | toggles `ai-panel` |
| `present-start`, `tour-start` | presentation channel only: `Present` and `Tour` open `present` (*Presenting and the tour*). Disabled, with the title `Add a step first`, when the channel has no view or no step. They stay in the header at every width (icon-only, with these accessible names, below 900 px wide); `header-menu` is unchanged |
| `header-menu-button` | only below 900 px wide: opens `header-menu`, which then holds `repo-name`, `channel-tabs`, `crumbs`, `tool-undo`, `tool-redo`, `tool-theme`, `tool-steps` |

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
change with it. In `outline` the text of every `node-item` and the contents of
every `edge-label-<id>` have opacity 0 (the item's row shape stays at 0.5); in
`overview` also every `node-sub`, and connections without a step are at 0.3.
The component whose callout is open, and labels of its connections, stay at
full opacity. Faded elements stay clickable.

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
`channel-redraw` draw a channel from the overview channel's first view in
code. It is one undoable edit that replaces what the channel held and empties
its `outdated`. The view keeps its id when the channel already has one, else
it is named after the channel. It is titled `LinkedIn`, `README` or
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
| `node-<id>` | one per component of the view; `data-kind`, `data-form`, `data-parent` (id or empty), `data-selected`, `data-changed="true"` while a run's result that added, changed or moved it is in preview (*Preview, Accept and Undo*); `data-dim="true"` while dimmed (an open callout or a search); `data-match` while search lights it (`true`, or `current` for the one stepped to); contains the outline with `data-shape` (drawing contract, *Geometry*, Shapes), `node-label`, `node-sub` (when non-empty), `node-item` per held item (`data-index`), `node-inside` (when `detail` is set; a click goes to that view) |
| `port-<id>-<t\|r\|b\|l>` | four ports on the hovered component; dragging from one onto another component connects them |
| `edge-<id>` | `data-style`, `data-both`, `data-step` (number or empty), `data-selected`, `data-dim="true"` while dimmed (an open callout, a search, or numbered steps on and the connection has no step) |
| `edge-label-<id>` | the label when drawn (a label without room is left out, never drawn over a component) |
| `step-badge-<id>` | while steps are on, on each connection with a step; never intersects a drawn label, also in `share-preview` and SVG downloads |
| `text-<id>` | `data-size`, `data-selected`; the text as real `<text>` |

The canvas draws the same markup and numbers as the share image: at 100 %
zoom, a `node-<id>` box has the size of the first `rect` of
`[data-node-id="<id>"]` in the exported SVG.

### Selecting and moving

- A click on a component, text or connection selects it; Shift+click toggles
  it in the selection; a box drag selects what it touches.
- Dragging moves the selection (a group with everything inside); connections
  follow every frame; on release positions snap to 8 px. A moved component
  whose centre lands inside a group becomes its child (as deep as nesting
  allows); outside every group it becomes top level.
- A click on a component also opens its callout, a second click closes it.
  A click on empty canvas clears the selection and callouts.
- After every edit, lanes stay valid: a component whose spine order is taken
  among its new siblings loses its lane, and a side lane whose anchor is gone,
  no longer a spine part, or inside the component is dropped.

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
| `callout-items` | (panel) `callout-item` each: double-click gives `callout-item-input` (Enter/blur commits, Escape cancels, emptied removes it), `callout-item-up`, `callout-item-down`, `callout-item-remove`; `callout-item-add` (`+ Add an item`, hidden at 12) appends `New item` and edits it; removing the last item makes it a card |
| `callout-link-<otherId>` | a chip per connected component, `data-direction` `to`/`from`/`both`; a click selects it and opens its callout |
| `callout-files` | absent for a part that shows no fact; `callout-file` each with `callout-file-remove` (which removes it from every fact of the part that lists it); `callout-file-add` gives `callout-file-input` (Enter adds a repository-relative path, at most 20; a path outside the repository toasts `Use a path inside the repository, like src/app.ts`; Escape or blur cancels). A path that does not exist in the repository (`check-files`, api contract) still saves; its `callout-file` has `data-missing="true"` and shows `callout-file-missing` `not in the repository` |
| `callout-parent` | `<select>`: `""` (`Top level`) and every group of the view except the component and what it holds; choosing one moves it inside that group at a free spot |
| `callout-open-inside` | (`detail` set) `Open inside`: goes to that view |
| `callout-create-inside` | (`detail` null, on the overview: the other channels hold one view each) `Draw its inside`: adds a view titled after the component holding one copy of it (a group copied as a card), pointing to the same facts (a group with no fact copied with its drawn label, kind and description as its own), sets `detail`, goes there |
| `callout-ask` | `Change this part`: selects the component and opens `ai-panel` with `ai-scope-selection` chosen and `ai-input` focused |
| `callout-delete` | deletes the component, its connections, and moves a group's members to its parent; in the overview its facts go too, elsewhere it is only left out of this channel (*Channels*) |
| `callout-close` | closes |

On the canvas: double-click a label → `node-label-input`; a sub-line →
`node-sub-input` (below the label of a component without one adds one); a held
item → `node-item-input`. Enter or blur commits, Escape cancels; an empty label
is refused, an emptied item is removed.

### Adding a component

`tool-component`, then a click on empty canvas opens `component-picker`:
`picker-kind-<kind>` (default `service`), `picker-form-<form>` (default
`card`, each with a `form-thumb` drawn in the chosen kind's shape, with its
`data-shape`), `picker-add` (`Add component`). Adding
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

`node-inside` and `callout-open-inside` go to the component's `detail` view;
`crumbs` lead back; going to a view fits it. A view removed by undo or a run
falls back to the first. With `tool-steps` on, `step-badge-<id>` appear and
connections without a step dim; off, no badges.

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
| `ai-look-again` | `Look at the drawing again` (LAYOUT-4): renders the current view as the share image in the channel's default format with its starting switches (*Share*), at 1×, as PNG, and starts a `revise` run for the current channel and view with that image (api contract, *The second look*). Disabled during a run, on a channel with no view and without an engine |

Sending first waits until every edit is saved (else fails with
`Your last edit is not saved yet; the instruction was not sent`). With an
engine it starts `POST /api/runs` for the current channel and view, the scope
`{"kind":"view"}`, `{"kind":"parts","ids":[…]}` or `{"kind":"all"}`, and the
chosen engine and model (`null` for `Default`); `ai-input` is then cleared.
Without an engine it posts to `/api/diagrams/:id/requests` (current channel
and view). If the run's event stream closes for good, the run is cancelled
and fails with `Lost the connection to the instruction, so it was stopped`.
Only one run at a time; the AI panel, the channel stages, the LinkedIn panel
and the share dialog share it.

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
| `share-advanced-toggle` | `Advanced options` (`aria-expanded`); shows `share-advanced`: `format-linkedin` (`Landscape LinkedIn post`, 1620×1080) and checkboxes `show-title`, `show-lede`, `show-items`, `show-steps`, `show-labels`, `show-legend`, `show-texts`. Starting toggles (reset when the format changes): on the LinkedIn channel, or with `format-feed`, title, description, held items, numbered path, labels and texts on, colour key off; Square: title, description, numbered path and texts on, held items, labels and colour key off; otherwise title, held items, numbered path, labels, colour key and texts on, description off |
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

Suggestion: none at `good`; with held items shown,
`hiding what each part holds would help`; else on a LinkedIn or Square format
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
from the overview channel's first view as one undoable edit, replacing what
the channel held and emptying its `outdated`. The view's id is kept when the
channel already has a view, else `linkedin`; its title `LinkedIn`, its caption copied from the overview's first view:

- groups fold into one part each (members not drawn); texts are left out;
  connections inside one group disappear; two connections between the same
  parts become one (two-way when opposite), keeping the earlier step and its
  label; steps are renumbered 1, 2, 3 …;
- importance per part: 4 if it ends a numbered connection, +1 per connection
  (at most 4), +2 if it holds something (items, or a folded group's
  members), +1 if its description is not `No description yet.`; ties by
  main-path order, then view order;
- the open parts — score ≥ 5, at most 4 — are panels listing up to 5 entries
  (a longer list ends `+ <n> more`), or cards when they hold nothing; other
  main-path parts are cards; the rest compact; a card whose sub-line would be
  shortened becomes compact;
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
  `<g data-edge-id>` per drawn connection holding its line, label and badge,
  `<g data-text-id>` per text; labels as real `<text>`.
- `show-title` draws `caption.title`, `show-lede` `caption.lede`,
  `show-legend` one key entry (dot and kind label) per kind present. README,
  slide and square place caption and key in a free corner (together if they
  fit), else in a strip under the drawing (title left, key right). Both post
  formats put title and description across the top and nothing under the
  drawing; a key goes in a free corner or is left out.
- Caption text wraps and is never shortened. `show-items` off draws panels
  without items (shrunk around their centre); `show-steps` draws badges;
  `show-labels` off hides connection labels; `show-texts` off hides texts.
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
- Badges, labels, held items, texts and the key follow the toggles given.

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
