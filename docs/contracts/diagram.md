# Contract — the drawing document

A drawing is one UTF-8 JSON file, usually inside the repository it describes
(`docs/architecture.archdraw.json` by convention). Agent sessions, the editor
and the instruction engine write it; the CLI, the server and the editor read
it. This file defines its shape, the rules that make it valid, the warnings
it can carry, how it is normalised, measured and laid out, and what an engine
answers when it changes a drawing.

Implemented by: `src/core/model.ts` (shape, validation, warnings),
`src/core/normalize.ts`, `src/core/geometry.ts`, `src/core/layout.ts`,
`src/core/repair.ts` (engine answers), `src/core/intent.ts` (post answers),
`src/core/simplify.ts`, `src/core/migrate.ts`, `src/server/files.ts`.

## Format identifier

Every file carries `"schema": "archdraw/diagram@2"`. The string identifies
the file format and is checked exactly; it is not the product's version.

## Shape

```jsonc
{
  "schema": "archdraw/diagram@2",
  "id": "d_k3j9x2ab",          // optional in a written file; ^d_[a-z0-9]{6,}$; `open` assigns one
  "title": "Sample Shop",       // the system's name, 1–120 chars
  "theme": "light",             // optional: "light" (default) | "dark"
  "showSteps": false,           // optional, default false: draw numbered step badges
  "source": { "kind": "local", "path": "C:/code/shop" },  // optional; the repository root, or null
  "engine": { "id": "claude", "model": null },            // optional; last instruction engine, or null
  "createdAt": "…", "updatedAt": "…",                     // optional ISO strings; the server keeps them
  "views": [ /* 1–30 views; views[0] is the overview */ ],
  "requests": [],               // optional; instructions waiting for the next session
  "warnings": []                // optional; one line per repair or conversion
}
```

### View

```jsonc
{
  "id": "overview",
  "title": "Overview",                       // breadcrumb name, 1–60 chars
  "caption": { "title": "How an order flows", "lede": "" },  // title 1–120, lede 0–240
  "postOf": null,                            // optional, default null: source view of a post (below)
  "nodes": [ /* components, at most 60 */ ],
  "edges": [ /* connections */ ],
  "texts": [ /* free texts; optional, default [] */ ]
}
```

### Component (node)

```jsonc
{
  "id": "gateway",
  "label": "Tool gateway",            // 1–48 chars
  "kind": "gate",                     // one of the ten kinds
  "form": "panel",                    // "card" | "compact" | "panel" | "group"
  "icon": "shield",                   // null = the kind's icon, or one of the icon names
  "sub": "every call passes here",    // 0–60 chars, one line under the label
  "items": ["Schema validation"],     // 0–12 strings of 1–44 chars; non-empty exactly for a panel
  "description": "The only way …",    // 1–400 chars
  "files": ["src/tools/gateway.py"],  // 0–20 repository-relative paths
  "parent": null,                     // id of a group in the same view, or null
  "detail": null,                     // id of another view that draws its inside, or null
  "place": { "row": 0, "col": 4 },    // grid hint, or null
  "lane": { "spine": 2 },             // optional, default null: relational layout hint
  "from": [],                         // optional, default []: original ids a merged part represents
  "x": 1052, "y": 272                 // optional pair: top-left in canvas px; absent = lay it out
}
```

| kind | label | default icon | meaning |
|---|---|---|---|
| `actor` | Person | `user` | a person or role who starts or decides something |
| `client` | Client app | `monitor` | a browser app, mobile app or CLI the user touches |
| `api` | API | `inbox` | an HTTP/RPC surface: routes, request intake |
| `service` | Service | `box` | code this repository owns that decides or does work |
| `worker` | Background job | `zap` | a scheduler, consumer, outbox relay, cron job |
| `llm` | AI agent | `spark` | a model call or an agent loop |
| `external` | External | `cloud` | a third-party API or service |
| `ops` | Monitoring | `timer` | tracing, metrics, logs viewer, evaluation |
| `gate` | Check | `shield` | auth, validation, policy, an approval rule |
| `data` | Data store | `db` | database, cache, queue, file store, event log |

Icons: `user users clipboard monitor window zap timer spark cloud shield scale
layers bell db chat loop book pen receipt inbox box cpu cog globe key lock mail
file folder terminal code server queue search chart eye git plug`.

Forms: `card` (icon, label, sub-line); `compact` (one row: icon, label,
sub-line); `panel` (a card plus one row per held item — only a panel shows
`items`); `group` (a header and the components whose `parent` it is — only a
group may be a parent).

### Connection (edge)

```jsonc
{ "id": "e4", "from": "runtime", "to": "gateway", "label": "", "style": "call", "both": true, "step": 4 }
```

`id` is optional in a written file (`open` assigns `e1`, `e2`, …). `from`/`to`
are components of the same view. `label` 0–40 chars (`""` draws none).
`style`: `call` (solid), `async` (dashed: event, queue, emit) or `dep`
(dotted: telemetry, read-only dependency). `both`: arrowheads at both ends.
`step`: a positive integer on the main path, or null.

### Text

```jsonc
{ "id": "t1", "text": "How an order flows", "x": 40, "y": 24, "size": 40 }
```

Free text placed by the user. `text` 1–500 chars, newlines allowed, never
wrapped. `size` is the font size in drawing px, 8–200 (default 20); weight
500; line height 1.25 × size. `x`/`y` is the top-left corner. Its box is as
wide as its widest drawn line (at least 8 px, rounded up) and 1.25 × size tall
per line. Drawn in the ink colour with no frame.

A view may also carry a `notes` array (`{id, text, x, y}`): each note is read
as a 16 px text at its position, one warning per view, and `open` writes the
file back with `texts` only.

### Requests

```jsonc
{ "id": "q1", "text": "Add the hotel board", "view": "overview", "at": "2026-10-13T12:00:00.000Z" }
```

An instruction typed in the editor when no engine could run it (1–4000 chars,
an existing view). The next agent session that edits the file applies and
removes it.

## Validity rules

A file breaking any rule is **invalid**. `archdrawer validate` lists every
violation as `<json path>: <message>`; the server refuses an invalid document
with 400 and the first violation. Invalid files are never repaired.

1. `schema` is exactly `archdraw/diagram@2`. A file with
   `archdraw/diagram@1` gets the single error
   `schema: this is archdraw/diagram@1; run "archdrawer migrate <file>"`.
2. Ids match `^[A-Za-z0-9_-]{1,64}$`. View ids are unique among views;
   component, connection, text and request ids are unique across the file.
3. Every component property above is present except `x`/`y`, `lane` and
   `from`. `x` and `y` are both present or both absent, and finite.
4. Lengths, list sizes and enumerations as stated above. Required strings
   are non-empty after trimming.
5. `items` is non-empty exactly when `form` is `panel`.
6. `parent` names a group in the same view; no component is its own
   ancestor; nesting is at most three groups deep.
7. `detail` names an existing view other than the component's own.
8. A connection's ends exist in its view and differ. At most one connection
   per ordered pair; a pair joined both ways is one connection with
   `both: true`.
9. `place` is null or `{row, col}` with integers in −20…20.
10. `files` are repository-relative: no leading `/` or `\`, no drive letter,
    no `..` segment. When a file is checked against its repository (the CLI,
    and the server for a registered file), each path must exist under the
    repository root, symlinks resolved. The repository root is the nearest
    ancestor of the file's folder holding `.git`, else the file's folder.
11. At most 60 components per view and 30 views.
12. `lane` and `from` follow *Lane* and *Provenance* below.
13. `postOf` follows *Posts* below.

### Lane

```jsonc
null
{ "spine": 0 }                            // non-negative integer: order along the main path
{ "anchor": "runtime", "side": "above" }  // or "below"; no other keys
```

Spine orders are unique among siblings (components with the same `parent`)
and need not be consecutive. An anchor names a component of the same view
that has a spine lane, never the component itself or one inside it. Lanes are
allowed inside groups. For placement a non-null lane wins over `place`; a
component with a stored position moves only when an engine asks for it
(`at` or `relayout`), never because it has a lane.

### Provenance (`from`)

`from` is a list of distinct original component ids, each matching the id
syntax. A named original need not still exist. A merged component's `from`
records what it represents; provenance carries forward through later merges.

### Posts

`postOf` is null or the id of another view of the file whose own `postOf` is
null. At most one view names a given source. A view with a non-null `postOf`
is a **post** (the LinkedIn version of its source). A post's id is allocated
the first time: `<source>-linkedin` when free (the source part cut to 55
chars), else `<source>-2-linkedin`, `-3-linkedin`, … with the source part
shortened so the whole id stays within 64 chars; "free" means unused by any
id in the file. Redesigning a source replaces its existing post and keeps
that post's id. A request naming a post resolves to its source through
`postOf`. A view whose id merely ends in `-linkedin` and has no `postOf` is
an ordinary view and is used as its own source.

## Warnings

`archdrawer validate` also prints warnings; they never make a file invalid.
*Flat* and *No held items* skip a view whose id ends in `-linkedin`.

- **Overview** — the first view (unless it is a post) has fewer than 4 or
  more than 6 top-level groups, or more than 15 connections (all of the
  view's connections count). The message gives both counts. Nothing is
  merged, moved or removed because of it.
- **Flat** — six or more top-level components that all have a `place` on the
  same row, or none has a `place` and every one is an end of a numbered
  connection.
- **No held items** — six or more components and no panel.
- **Tuning number** — a label, sub-line or item with a number and a unit of
  time, count or size (`6 turns`, `90 s`, `2 retries`, `5 MB`, `30%`).
- **No main path** — three or more connections and none has a step.
- **Repeated label** — the same non-empty label (trimmed, case-insensitive)
  on three or more connections of a view.

## Normalisation

Applied only to a valid file, by `archdrawer open`, by the server whenever it
reads a file, and on import:

- a missing document `id` is assigned (`d_` + 10 lower-case letters/digits);
- `source` becomes `{"kind": "local", "path": <repository root>}` for a file
  in a repository; an imported document keeps its own `source`;
- missing `theme`, `showSteps`, `requests`, `warnings`, `postOf`, `lane`,
  `from`, `texts` and text `size` get their defaults; `createdAt`/`updatedAt`
  are set when missing;
- every connection without an id gets the next free `e<n>`;
- every component without a position is laid out (*Layout*), and every
  group's `x`/`y` becomes its computed box.

The result is written pretty-printed with two spaces and a final newline,
only when it differs from the file's text; `updatedAt` moves only then.

## Geometry

Sizes are a function of content, measured with the bundled Geist metrics. The
editor and every export draw from the same numbers.

- **card** 196 × 108; the label wraps to at most 3 lines, each extra line
  adding 18.
- **compact** 46 tall; as wide as icon, label and sub-line need, 140–320.
- **panel** as wide as its widest row needs, 184–320; height
  `24 + 22 + (sub ? 17 : 0) + (k ? 10 + 26k + 4(k − 1) : 0)` for `k` items.
- **group** its children's bounding box plus 18 px at the sides and bottom
  and a 46 px header, at least as wide as its header text; a group with no
  children is 260 (or its header width) × 140 at its position.
- Step badge radius 10.5; connection label box 22 tall.

**Post style.** A post, or any view whose id ends in `-linkedin`, measures
and draws denser, in the editor and in exports alike: component and group
names 16.5 px (compact names 15 px), every other text at least 12.5 px; card
176 × 84, widening up to 204 for its sub-line, each extra label line adding
20; panel 150–300 wide, height
`14 + 22 + (sub ? 16 : 0) + (k ? 6 + 19k + (k − 1) : 0)`; badge radius 11.5.

**Connections** are smooth curves: one cubic or a chain of up to three
(`M … C …`, no `L`, `H` or `V`), joined without a corner (directions equal
within 1°), the end handles along the end sides' normals and every handle at
least 24 px long. A connection leaves from the side of each component that
faces the other end; several on one side are spread up to 16 px apart,
ordered by where the other end is. A group's name box (from the group's left
edge to 2 px past its name, sub-line or detail mark, 46 px tall) is never
crossed; connections entering a member in the group's first row from above
come in right of the name, at least 10 px apart.

A connection whose plain curve would enter a component other than its ends
or a group name (or, in a post, cross more earlier lines than an arc would)
takes an arc through one or two bend points: never into a group name, at
least 8 px clear of every non-group component, never into its own two ends.
The cheapest arc wins: cost = length ÷ distance between the two centres +
0.25 per earlier line crossed (ties: fewer bends, shorter, further right). No
arc is longer than max(1.8 × distance, distance + 120). When no arc fits
around automatically placed components, the layout widens the gap the arc
needs and routes again, at most three times, undoing a widening that does not
help; stored positions never move. If there is still no arc, the shortest
curve that stays out of group names is drawn and the layout report lists it
in `edgesOverParts`.

A label takes the free spot nearest the middle of its curve, 4 px clear of
components, group names, texts and earlier labels and no further from the
curve than half its width + 10 px; with no such spot it is left out. A step
badge takes the free spot nearest the middle, its radius + 3 px clear of all
of those and of every label.

## Layout

Components without a position are placed on a grid, then cells become pixels
by the widest component of each column and the tallest of each row.

- Without lanes: `place` puts a component in that cell (row 0 is the main
  row; negative rows are above). Others go next to what they connect to, the
  main path (connections with steps, in step order) along one row; inside a
  group the main path wraps back and forth over two or three columns. Gaps are
  88 × 84 px at top level and 36 × 32 px inside groups, widened for drawn
  labels (label width + 28, plus room for a badge on a numbered connection).
- With lanes: spine units in `spine` order; side parts above or below their
  anchor, several of one anchor spreading to the nearest free neighbouring
  columns before going a row further out (ties by input order). A group's
  members take outer-grid cells by their own lanes; the group takes the
  position its earliest spine member gives it, its spine members fill
  consecutive spine positions, and the cells inside its box are reserved for
  it. Rows are 32 px apart (22 in the post style), columns 24; a numbered
  connection between neighbours keeps `2(r + 3) + 28` px for its badge (`r`
  the badge radius); a drawn label keeps its width + 16 (side by side) or
  height + 16 (one above the other). Each column uses its own widest part.
- Portrait posts: more than three spine units form two bands, up to three
  left-to-right, the rest right-to-left. Wide posts keep spine order
  left-to-right.
- Hidden connection labels reserve no gap. Components that already have a
  position keep it; new ones are placed beside them on an 8 px grid without
  overlapping anything.

## Engine answers (refine and simplify)

The engine receives a **draft**: `title` and every view (`id`, `title`,
`caption`, components, connections) without document metadata, texts,
requests, warnings, connection ids or `postOf`, and with each component's
current `box` `{x, y, w, h}` instead of `x`/`y`. It answers the whole draft in
the strict schema dialect (every property required, no extra properties,
absence as `null`, `""` or `[]`) without `box`, plus `at` (`{x, y}` or null)
on every component and `relayout` (component ids) on every view; `lane` and
`from` are required on every component.

The answer is repaired, one warning per repair: an unknown kind becomes
`service`; an unknown form `card`; a panel without items `card`; items on a
non-panel are dropped; an unknown icon or style becomes the default; an
invalid or duplicate id is replaced or renamed `<id>-2`; a dangling `parent`
or `detail` is cleared; parent loops and over-deep nesting move to top level;
an invalid lane, a taken spine order or a bad anchor is dropped; unknown
`from` ids are dropped; files outside the repository or not found are
removed and more than 20 are cut; over-long text is shortened with `…`;
connections to missing components, self-connections and second connections on
a pair are dropped; a reverse connection merges into the first as two-way;
unknown `relayout` ids and anything outside the run's scope are ignored. A
view with no components fails the run.

Positions: a kept component keeps its position unless it has an `at` (more
than 1 px from its current top-left; snapped to the 8 px grid) or is in
`relayout`. An `at` on a group moves everything inside it. A moved component
that would overlap one that did not move goes to the nearest free spot (one
warning). Components in `relayout` and new ones without `at` are laid out.
Texts, requests and existing connection ids are kept; a refined view keeps its
`postOf`, a new view gets null.

**Simplify coverage.** For a simplify run, every component id of the input,
and every id in an input `from`, must appear in the result as a component, or
in a component's `from`, in the overview, a view reached from it through
`detail`, or a view left exactly as it was. Views not reached from the overview
are restored as they were (one warning each); a new view nothing links to is
left out. A missing id fails the run with
`The simplified drawing loses <n> components: <ids>. Nothing was changed.`

## Post answers (story intent)

A post run's engine answers this schema exactly (every property required, no
others); it carries no pixels, forms or document fields:

```json
{ "title": "", "lede": "",
  "zones": [{ "id": "", "label": "" }],
  "parts": [{ "id": "", "label": "", "sub": "", "kind": "service", "chips": [""],
              "zone": null, "spine": 0, "anchor": null, "side": null, "from": [] }],
  "edges": [{ "from": "", "to": "", "label": "", "style": "call", "step": 1 }] }
```

`kind` is one of the ten kinds; `zone`, `anchor` are string or null; `spine`,
`step` integer or null; `side` `"above"`, `"below"` or null; `style` call,
async or dep.

**Relations** (a violation fails the run, nothing saved): zone and part ids
unique; a part's zone exists; a spine part has a unique non-negative `spine`
and null `anchor`/`side`; a side part has null `spine`, a spine part as
`anchor` and a `side`; a zone's spine parts are consecutive on the spine and
its side parts' anchors are inside it, or it holds only side parts of one
anchor; connections join two parts and never a part to itself; at least one
part.

**Hard limits** fail the run, never shortened: title 120, lede 240, labels 48,
sub-lines 60, at most 12 chips of 44, connection labels 40, a non-empty title.

**Targets** are kept whole with one warning each: title 9 words, lede 140
chars, label and sub-line 28, chip 22, side-connection label 2 words; a
numbered connection with a label is kept and warned about.

**Conversion**: zones become groups (`zone-<id>`), parts become panels (chips
as items) or cards, `zone` becomes `parent`, `spine`/`anchor`/`side` become
`lane`, `from` keeps only existing component ids (one warning per dropped
id). A part's description is its first represented component's, else its
sub-line, else its label; its files are the union of the represented
components' (at most 20). Ids are unique across the file (invalid ids
sanitised, collisions suffixed `-2`, one warning each); connection ids are
`<from>-<to>`. A reverse pair becomes one two-way connection (keeping the
first label, else the second, and the earlier step), a same-direction
duplicate is dropped, steps are renumbered 1, 2, 3 … — one warning each. The
post is titled `LinkedIn` (`<source title> · LinkedIn` for a source other than
the overview), has the intent's title and lede as caption, no texts, and is
laid out by its lanes. It replaces the source's post (or is added); every
other view is unchanged. The result must pass validation before it is saved.

## Reading `archdraw/diagram@1`

`archdrawer migrate` and import convert a file with
`"schema": "archdraw/diagram@1"`: one view `overview` (title `Overview`,
caption from the old title and subtitle); nodes keep id, label, files and
position, `tech` becomes `sub`, kind `ui` becomes `client`, a missing
description becomes `No description yet.`, form `card`; each old group becomes
a `service` group with icon `layers` and description `A group of components.`;
`call`/`async` edges keep their style, a `result` edge merges into its reverse
`call` as two-way or becomes a `call`; notes become 16 px texts; over-long
text is shortened. Every change other than a plain rename adds one warning.
