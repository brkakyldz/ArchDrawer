# Contract — the web client

What the browser shows and how it behaves: the library, the editor (canvas,
callouts, connections, texts, views), the ask box and AI panel, and the share
dialog with its image. Every element named here carries
`data-testid="<id>"`; `<x>` marks a template (`node-api`). Behaviour is
normative for end-to-end tests; styling is not, except where stated.

Implemented by: `src/web/App.tsx`, `src/web/library/Library.tsx`,
`src/web/editor/*` (Editor, Canvas, Callout, Panels, AskBox, AiPanel, Find,
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
| `start-help` | shown when the list is empty: how to start a drawing from Claude Code or Codex; holds `library-example` (`Open the example drawing`: `POST /api/example`, then opens it) |

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
| `warnings` | shown when the document has `warnings`: `<n> warning(s) from the last change` and the list; `warnings-dismiss` clears them from the document |
| `views-button` | overview channel only, when it holds more than one view: opens `views-menu`: `view-item-<viewId>` for every overview view in file order (`data-kind` `Overview`/`Detail`), the current one `aria-current="true"`; choosing one goes there |
| `search-button` | also `/` or Ctrl/Cmd+K when no text input has focus: opens `search` with `search-input` focused (`/` or Ctrl/Cmd+K focuses it again when it is already open). A component matches when its label contains the typed text, case-insensitively. As you type, the matches on the current view are lit on the canvas (`node-<id>` `data-match="true"`, a ring drawn around the part) and every other component dims (`data-dim="true"` on `node-<id>`, and on every `edge-<id>` that does not join two matches); nothing moves and no part changes size. `search-count` shows `<n> match(es)`, `<i> of <n>` once stepped, or `No match in this view`; any typing in `search-input`, even of the same text, ends the stepping (no current match). Enter steps to the next match on this view and Shift+Enter to the previous one, wrapping (also `search-next`, `search-prev`): the match becomes `data-match="current"` and the only selected component, and the view moves, at the same zoom, only when that part is not wholly on screen or is behind the search panel (it is then centred below the panel). Matches in other views are listed under `In other views` (at most 50): `search-result` with `data-view` and `data-node-id`, label and view title; a click, or the arrow keys then Enter, goes to that view (fitted, then moved the same way only if the part is still off screen or behind the panel) with that match selected and current; with no match on this view, Enter opens the first listed one. `No component is called that` when no view has a match. Search stays open until Escape (in it, or anywhere outside a text input), which closes it, ends the highlight and dimming and keeps the selection |
| `ai-button` | toggles `ai-panel` |
| `header-menu-button` | only below 900 px wide: opens `header-menu`, which then holds `repo-name`, `channel-tabs`, `crumbs`, `tool-undo`, `tool-redo`, `tool-theme`, `tool-steps` |

Every icon-only button has an accessible name at every width.

| Test id | Key | Behaviour |
|---|---|---|
| `tool-select` | V | default; click selects, drag moves |
| `tool-pan` | H | drag pans |
| `tool-component` | C | a click opens the component picker there |
| `tool-connect` | E | drag from one component to another connects them |
| `tool-text` | T | a click opens a new text there (or edits the text clicked) |
| `tool-undo`, `tool-redo` | Ctrl/Cmd+Z; Ctrl/Cmd+Shift+Z or Ctrl+Y | disabled when there is nothing to undo/redo, and while a run is going |
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
`Edits are paused while the instruction runs`; the run's result is then one
undo step.

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
| `channel-empty` | the stage of a channel with no view, instead of the canvas. README and presentation: `This channel comes in 0.3`. LinkedIn: `The LinkedIn post is not drawn yet` and `channel-draw` (`Draw it`, drawing it as *The LinkedIn flow* does). Drawing tools, `ai-button`, the ask box and `share-button` are disabled there |
| `channel-outdated` | on the stage of a channel whose `outdated` is not empty: `<n> change(s) in the facts since this was drawn`; `channel-keep` (`Keep as it is`) empties `outdated` as one undoable edit; on the LinkedIn channel also `channel-redraw` (`Redraw it`), which redraws it from the facts as one undoable step |

## Drawing

| Test id | Element |
|---|---|
| `node-<id>` | one per component of the view; `data-kind`, `data-form`, `data-parent` (id or empty), `data-selected`, `data-changed="true"` for 3 s after a run added, changed or moved it; `data-dim="true"` while dimmed (an open callout or a search); `data-match` while search lights it (`true`, or `current` for the one stepped to); contains `node-label`, `node-sub` (when non-empty), `node-item` per held item (`data-index`), `node-inside` (when `detail` is set; a click goes to that view) |
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
| `callout-create-inside` | (`detail` null) `Draw its inside`: adds a view titled after the component holding one copy of it (a group copied as a card), pointing to the same facts (a group with no fact copied with its drawn label, kind and description as its own), sets `detail`, goes there |
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
`card`, each with a `form-thumb`), `picker-add` (`Add component`). Adding
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

## Ask box

| Test id | Element and behaviour |
|---|---|
| `ask-input` | placeholder `Ask <engine label> to change this drawing`; for the test engine `Ask the test engine (no AI) to change this drawing`; with no engine `Ask Claude to change this drawing`. At most 4000 chars |
| `ask-send` | sends (also Enter); empty does nothing |
| `ask-expand` | opens `ai-panel` with the typed text moved into `ai-input` |
| `ask-status` | while a run is going: its latest progress line (`Starting` first); `ask-cancel` cancels |
| `ask-error` | after a failed or cancelled run started here: the error (`Cancelled`) and `ask-retry` (`Try again`, the same request again); the instruction is back in `ask-input` |
| `ask-saved` | `Saved in the file for your next archdrawer session` |

Sending first waits until every edit is saved (else fails with
`Your last edit is not saved yet; the instruction was not sent`). With an
engine it starts `POST /api/runs` for the current channel and view, scope `view`, the
chosen engine and model; on success the editor shows the stored drawing, the
toast `The drawing was updated: <summary>`, marks changed components, and
undo returns to the drawing before the run. Without an engine it posts to
`/api/diagrams/:id/requests` (current channel and view) and shows `ask-saved`. If the run's event stream
closes for good, the run is cancelled and fails with
`Lost the connection to the instruction, so it was stopped`. Only one run at
a time; the ask box, AI panel and share dialog share it.

**Choosing the engine**: the one last chosen in this browser if available;
else the document's `engine` if available and not the test engine; else the
first available real engine; else the test engine. The test engine is named
`Test engine (no AI)` everywhere.

## AI panel

Beside the stage, not modal: the canvas stays usable.

| Test id | Element and behaviour |
|---|---|
| `ai-panel` | the panel; `ai-close` or Escape inside it closes it |
| `ai-input` | textarea, at most 4000 chars; Ctrl/Cmd+Enter sends |
| `ai-engine` | `<select>` of available engines (value id, text label); absent without an engine |
| `ai-model` | `<select>`: `""` `Default`, then the engine's models; each engine remembers its own choice in the browser |
| `ai-engine-note` | `<label> reads the repository (read-only) and changes the drawing`; for the test engine `Test engine (no AI): it understands only add, remove, rename, hold, move and align, gives a canned post and a canned simplification, and changes nothing else`; without engine `No engine is available: the instruction is saved in the file for your next archdrawer session` |
| `ai-scope-view`, `ai-scope-selection`, `ai-scope-all` | radios `This view`, `Selected parts (<n>)`, `The whole channel`; default view; selection disabled (and falls back to view) without a selected component |
| `ai-send` | disabled while `ai-input` is empty or a run is going |
| `ai-progress` | while a run is going: `ai-progress-line` per message (last 12) and `ai-cancel` |
| `ai-error` | after a failed or cancelled run: the error and `ai-retry` (same request); `ai-input` keeps the instruction |
| `ai-summary` | after success: e.g. `1 part added · 2 connections changed · 3 parts moved` (zeros left out; `Nothing changed`), with `data-added`, `data-removed`, `data-changed`, `data-moved`, `data-edges-added`, `data-edges-removed`, `data-edges-changed` |
| `layout-report` | after success, the run's report (below) |
| `ai-saved` | without an engine, after saving the request: the `ask-saved` text |
| `simplify-overview` | `Simplify the overview`: goes to the overview channel's first view, fills `ai-input` with `Simplify the overview: keep every component in a detail view or a merged part` and starts a `simplify` run on the first view with scope view; disabled during a run; without an engine saves the request for the first view |

Sending uses scope `{"kind":"view"}`, `{"kind":"parts","ids":[…]}` or
`{"kind":"all"}`, and the chosen engine and model (`null` for `Default`). On
success the instruction is cleared.

`overview-suggestion`: on the overview channel's first view when it misses the
overview targets, one line such as `This overview has 32 connections —
simplify it?`; `overview-simplify` (`Simplify it`) opens the panel with the
simplify instruction filled in, without starting a run.

## External changes

When the stored file changes outside the editor and the editor has no
unsaved edit and no run going, it shows the new document within 2 s with the
toast `Updated from the file`. With an unsaved edit, the next save gets 409
and `save-status` says so.

## Share

`share-dialog` is a modal (`role="dialog"`): focus moves into it, Tab and
Shift+Tab cycle inside it, closing returns focus to `share-button`. It shows
`share-preview` — the actual export SVG with `data-view`, `data-width`,
`data-height`, scaled to fit — and `share-size` (`1600 × 900`). The dialog
packages the view as it is: it offers no simplifying and no sharing of one
part (SHARE-2).

| Test id | Element and behaviour |
|---|---|
| `format-feed`, `format-readme`, `format-slide`, `format-square` | `Where will you share it?` (`aria-pressed`): `LinkedIn` 1080×1350, `README` 1600×900, `Slide` 1920×1080, `Square post` 1080×1080. `format-feed` is also pressed for the wide post. Default `format-feed` on the LinkedIn channel, else `format-readme` |
| `share-theme-light`, `share-theme-dark` | the image theme (default the drawing's) |
| `share-advanced-toggle` | `Advanced options` (`aria-expanded`); shows `share-advanced`: `format-linkedin` (`Landscape LinkedIn post`, 1620×1080) and checkboxes `show-title`, `show-lede`, `show-items`, `show-steps`, `show-labels`, `show-legend`, `show-texts`. Starting toggles (reset when the format changes): on the LinkedIn channel, or with `format-feed`, title, description, held items, numbered path, labels and texts on, colour key off; Square: title, description, numbered path and texts on, held items, labels and colour key off; otherwise title, held items, numbered path, labels, colour key and texts on, description off |
| `share-actions` | always visible: `readability`, `layout-report`, `download-png`, `download-svg`, `copy-image` |
| `readability` | `data-level` `good`/`ok`/`warn`; one plain sentence for the chosen destination with at most one suggestion, and no numbers (Readability, below); `readability-details-toggle` (`Details`, `aria-expanded`, closed when the dialog opens) shows `readability-details`: `Names <a> px and text <b> px <where>, <c> px opened.` |
| `share-clipped` | when component text is shortened with `…`: `Shortened in this image:` and `share-clipped-item` per text (`<label>: <full text>`) |
| `download-png` | `<slug>-<view>-<format>.png`, at twice the image size |
| `download-svg` | the same name with `.svg`; fonts embedded |
| `copy-image` | copies the PNG; toast `Copied the image` or `Copying images is not allowed here — use Download PNG` |
| `share-close` | closes; also Escape or a click on the backdrop |

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
  engine, `design-post` (`Design the post`) starts a `post` run (the chosen
  engine and model, format `feed`); without one, `linkedin-prepare`
  (`Prepare the simple version`) and `post-engine-note`
  (`No engine available — prepared without AI`).
- Beside the drawn LinkedIn channel, `linkedin-panel` (`LinkedIn post`):
  `share-caption-title` and `share-caption-lede` edit its caption
  (undoable); `arrange-feed` (`Re-arrange`) places its parts again by their
  lanes for the portrait feed (an undoable edit, no engine); `design-post`
  (with an engine) redesigns it; `explain-feed` (`Rewrite it in plain words`)
  starts a `post` run with the instruction `Rewrite this post in plain words
  for someone who has never seen the project`; without an engine
  `post-engine-note` shows, and a rewrite is saved as a request
  (`share-run-saved` with the `ask-saved` text).
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
the channel held and emptying its `outdated`. The view's id is `linkedin`,
its title `LinkedIn`, its caption copied from the overview's first view:

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
