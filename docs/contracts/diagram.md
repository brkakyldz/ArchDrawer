# Contract — the drawing document

A drawing is one UTF-8 JSON file, usually inside the repository it describes
(`docs/architecture.archdraw.json` by convention). Agent sessions, the editor
and the instruction engine write it; the CLI, the server and the editor read
it. This file defines its shape, the rules that make it valid, how an edit is
split between the facts and a channel, the warnings it can carry, how it is
normalised, measured and laid out, and what an engine answers when it changes
a drawing. Why the file is shaped this way: ADR 0003 and ADR 0006.

Implemented by: `src/core/model.ts` (shape, validation, warnings),
`src/core/channels.ts` (joining a channel view, splitting an edit, `outdated`),
`src/core/normalize.ts`, `src/core/geometry.ts`, `src/core/layout.ts`,
`src/core/repair.ts` (engine answers), `src/core/intent.ts` (post answers),
`src/core/simplify.ts`, `src/core/migrate.ts`, `src/server/files.ts`.

## Format identifier

Every file carries `"schema": "archdraw/diagram@3"`. The string identifies
the file format and is checked exactly; it is not the product's version.
Files with `archdraw/diagram@2` are converted when read (*Reading
`archdraw/diagram@2`*); `archdraw/diagram@1` needs `archdrawer migrate`.

## Shape

```jsonc
{
  "schema": "archdraw/diagram@3",
  "id": "d_k3j9x2ab",          // optional in a written file; ^d_[a-z0-9]{6,}$; `open` assigns one
  "title": "Sample Shop",       // the system's name, 1–120 chars
  "theme": "light",             // optional: "light" (default) | "dark"
  "source": { "kind": "local", "path": "C:/code/shop" },  // optional; the repository root, or null
  "engine": { "id": "claude", "model": null },            // optional; last instruction engine, or null
  "createdAt": "…", "updatedAt": "…",                     // optional ISO strings; the server keeps them
  "facts": {
    "components": [ /* component facts, at most 1800 */ ],
    "relations": [ /* relation facts, at most 3600; optional, default [] */ ]
  },
  "channels": {
    "overview":     { "views": [ /* 1–30 views; views[0] is the overview */ ], "showSteps": false, "outdated": [] },
    "linkedin":     { "views": [ /* 0 or 1 view */ ], "showSteps": false, "outdated": [] },
    "readme":       { "views": [], "showSteps": false, "outdated": [] },
    "presentation": { "views": [], "showSteps": false, "outdated": [] }
  },
  "requests": [],               // optional; instructions waiting for the next session
  "warnings": []                // optional; one line per repair or conversion
}
```

**Facts** say what is true about the system; **channels** say how it is told.
A channel is one of four fixed names. `showSteps` (optional, default false)
draws numbered step badges in that channel. `outdated` (optional, default
`[]`) lists the facts changed since the channel was drawn that it has not
taken up (*Edits: facts or channel*). A channel other than `overview` may be
written as `{}` or left out; it is then empty. In this format version the
`readme` and `presentation` channels hold no view.

### Component fact

```jsonc
{
  "id": "gateway",
  "label": "Tool gateway",            // 1–48 chars
  "kind": "gate",                     // one of the ten kinds
  "sub": "every call passes here",    // 0–60 chars, one line under the label
  "description": "The only way …",    // 1–400 chars
  "files": ["src/tools/gateway.py"],  // 0–20 repository-relative paths
  "items": ["Schema validation"]      // 0–12 strings of 1–44 chars: what it holds inside
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

### Relation fact

```jsonc
{ "id": "r4", "from": "runtime", "to": "gateway", "label": "", "style": "call", "both": true }
```

`from`/`to` are component facts. `label` 0–40 chars. `style`: `call` (solid),
`async` (dashed: event, queue, emit) or `dep` (dotted: telemetry, read-only
dependency). `both`: the relation runs both ways.

### View

```jsonc
{
  "id": "overview",
  "title": "Overview",                       // breadcrumb name, 1–60 chars
  "caption": { "title": "How an order flows", "lede": "" },  // title 1–120, lede 0–240
  "nodes": [ /* parts, at most 60 */ ],
  "edges": [ /* connections */ ],
  "texts": [ /* free texts; optional, default [] */ ]
}
```

### Part (node)

```jsonc
{
  "id": "gateway",
  "facts": ["gateway"],               // the component facts it shows: one, several (a merged part) or none
  "form": "panel",                    // "card" | "compact" | "panel" | "group"
  "icon": "shield",                   // null = the kind's icon, or one of the icon names
  "parent": null,                     // id of a group part in the same view, or null
  "detail": null,                     // overview only: id of another overview view that draws its inside, or null
  "place": { "row": 0, "col": 4 },    // grid hint, or null
  "lane": { "spine": 2 },             // optional, default null: relational layout hint
  "x": 1052, "y": 272,                // optional pair: top-left in canvas px; absent = lay it out
  // optional, absent or null = taken from the fact; a value = this channel's own text
  "label": null, "kind": null, "sub": null, "description": null, "items": null
}
```

Icons: `user users clipboard monitor window zap timer spark cloud shield scale
layers bell db chat loop book pen receipt inbox box cpu cog globe key lock mail
file folder terminal code server queue search chart eye git plug`.

Forms: `card` (icon, label, sub-line); `compact` (one row: icon, label,
sub-line); `panel` (a card plus one row per shown item — only a panel shows
items); `group` (a header and the parts whose `parent` it is — only a group
may be a parent).

### Connection (edge)

```jsonc
{ "id": "e4", "from": "runtime", "to": "gateway", "relations": ["r4"], "step": 4,
  // optional, absent or null = taken from the relation; a value = this channel's own
  "label": null, "style": null, "both": null }
```

`id` is optional in a written file (`open` assigns `e1`, `e2`, …). `from`/`to`
are parts of the same view. `relations` (optional, default `[]`) lists the
relation facts it shows. `step`: a positive integer on the main path, or null.

### Text

```jsonc
{ "id": "t1", "text": "How an order flows", "x": 40, "y": 24, "size": 40 }
```

Free text placed by the user. `text` 1–500 chars, newlines allowed, never
wrapped. `size` is the font size in drawing px, 8–200 (default 20); weight
500; line height 1.25 × size. `x`/`y` is the top-left corner. Its box is as
wide as its widest drawn line (at least 8 px, rounded up) and 1.25 × size tall
per line. Drawn in the ink colour with no frame.

### Requests

```jsonc
{ "id": "q1", "text": "Add the hotel board", "channel": "overview", "view": "overview", "at": "2026-10-13T12:00:00.000Z" }
```

An instruction typed in the editor when no engine could run it (1–4000 chars,
an existing channel and one of its views). The next agent session that edits
the file applies and removes it.

## What a channel draws

Layout, geometry, the editor and every export draw a **channel view**: a view
joined with its facts into the shape below. The join is pure and the same
everywhere, so the editor and the image never disagree (AGENTS.md
invariant 5).

- A part's `label`, `kind`, `sub` and `description` are its own when not
  null, else its single fact's. Its `files` are the union of its facts'
  files in fact order, without repeats, at most 20.
- A panel's shown items are the part's `items` when not null, else its single
  fact's `items`; any other form shows none.
- A connection's `label`, `style` and `both` are its own when not null, else
  its single relation's (`""`, `call`, `false` without one).
- A part with no fact, or with several, has no single fact: it gives its own
  `label`, `kind` and `description` (rule 7), and `sub` `""` and `items` `[]`
  when it gives none.

## Validity rules

A file breaking any rule is **invalid**. `archdrawer validate` lists every
violation as `<json path>: <message>`; the server refuses an invalid document
with 400 and the first violation. Invalid files are never repaired.

1. `schema` is exactly `archdraw/diagram@3`. A file with
   `archdraw/diagram@1` gets the single error
   `schema: this is archdraw/diagram@1; run "archdrawer migrate <file>"`.
   A file with `archdraw/diagram@2` is converted first and the result is
   checked.
2. Ids match `^[A-Za-z0-9_-]{1,64}$`. Fact ids (components and relations
   together, one id space) are unique among facts; a part's id may equal a
   fact's. View ids are unique across the file.
   Part, connection and text ids are unique within their channel. Request ids
   are unique.
3. Every component-fact and relation-fact property above is present. Every
   part property is present except `x`/`y`, `lane` and the five own texts;
   every connection property except `id`, `relations` and the three own
   values. `x` and `y` are both present or both absent, and finite.
4. Lengths, list sizes and enumerations as stated above, for facts and for a
   part's or connection's own values alike. Required strings are non-empty
   after trimming.
5. `channels` holds `overview` and may hold `linkedin`, `readme` and
   `presentation`, no other key; each is an object with at most `views`,
   `showSteps` and `outdated` (`views` required in the overview). The
   overview holds 1–30 views; `linkedin` at most one; `readme` and
   `presentation` none.
6. A part's `facts` are distinct component facts. A fact is shown by at most
   one part of a view.
7. A part with no fact or with several gives its own `label`, `kind` and
   `description`.
8. A panel shows at least one item; a part that is not a panel has `items`
   null.
9. `parent` names a group part in the same view; no part is its own
   ancestor; nesting is at most three groups deep.
10. `detail` is null outside the overview channel; in it, it names another
    overview view.
11. A relation's ends exist and differ. At most one relation per ordered
    pair; a pair joined both ways is one relation with `both: true`.
12. A connection's ends exist in its view and differ. At most one connection
    per ordered pair; a pair joined both ways is one connection with
    `both` true. Its `relations` are distinct relation facts, each joining a
    fact of one end with a fact of the other; a relation is shown by at most
    one connection of a view. A connection with exactly one relation and no
    own `both` follows that relation's direction (or the relation is
    two-way): wherever this contract has a connection show a relation that
    runs the other way, the connection's `from` and `to` are swapped (keeping
    its step), which changes nothing it means.
13. `place` is null or `{row, col}` with integers in −20…20.
14. `files` are repository-relative: no leading `/` or `\`, no drive letter,
    no `..` segment. When a file is checked against its repository
    (`archdrawer validate`), each path must exist under the repository root,
    symlinks resolved. Wherever a drawing is opened or saved (`archdrawer
    open` and `svg`, and the server for a registered file) a missing path is
    a warning instead, `<json path>: "<path>" does not exist in the
    repository`, so a file deleted or renamed later never locks a drawing;
    the editor marks it (ui contract, `callout-files`). The repository root
    is the nearest ancestor of the file's folder holding `.git`, else the
    file's folder; a registered drawing's `source` is always that root.
15. At most 60 parts per view.
16. Every component fact is shown by at least one part of the overview
    channel.
17. `outdated` lists distinct ids (any id syntax; a removed fact's id stays
    listed). An empty channel's `outdated` is `[]`.
18. A request names an existing channel and one of its views.
19. `lane` follows *Lane* below.

### Lane

```jsonc
null
{ "spine": 0 }                            // non-negative integer: order along the main path
{ "anchor": "runtime", "side": "above" }  // or "below"; no other keys
```

Spine orders are unique among siblings (parts with the same `parent`) and
need not be consecutive. An anchor names a part of the same view that has a
spine lane, never the part itself or one inside it. Lanes are allowed inside
groups. For placement a non-null lane wins over `place`; a part with a stored
position moves only when an engine asks for it (`at` or `relayout`), never
because it has a lane.

## Edits: facts or channel

Every change to a document — an editor edit, a run's answer, a file written
from outside — is the same pure split (`src/core/channels.ts`): content goes
to the facts, appearance to the channel it was made in.

**Appearance** changes only the channel it is made in: moving, a part's form,
icon, `place`, `lane`, `parent` and `detail`, which items a panel shows (as
the part's own `items`), a connection's step, texts, captions, view titles,
`showSteps`, and any of a part's or connection's own texts.

**Content** changes the facts:

- **Where a text edit goes.** A part's field is edited in its own text when
  the part already has one for that field or has no single fact. Otherwise:
  in the overview, every field edits the fact, and every channel shows the
  new text at once; outside the overview, the **label** and **sub-line**
  become the part's own text (a shorter name for that channel), while kind,
  description and items edit the fact. An own text that ends up equal to the
  single fact's is cleared to null. A connection's label, style and two-way
  flag follow the same rule with its single relation (label as a label,
  style and two-way as facts).
- **Items.** A panel with null `items` shows its fact's items, and editing,
  adding, moving or removing one edits the fact. When a fact is left with no
  items, every panel that showed them through null `items`, in every channel,
  becomes a card. Choosing the form panel shows the fact's items, or adds
  `New item` to the fact when it has none (to the part's own items when it
  has no single fact); leaving panel sets the part's `items` to null and
  removes nothing from the fact. Showing fewer items than the fact holds is
  the part's own `items`.
- **Files** always belong to the facts. Adding one on a part with several
  facts adds it to its first fact; removing one removes it from every fact of
  the part that lists it. A part with no fact has no files and offers none.
- **Adding a part** adds a component fact and a part pointing to it. The
  fact's id is the part's id when no fact has it, else `<id>-2`, `-3`, … A
  copy of an existing part (`callout-create-inside`) points to the same facts
  and adds none. Outside the overview a new fact also gets a part in the
  overview's first view, laid out at a free spot (rule 16); when that view
  already holds 60 parts the edit is refused (`The overview is full: make
  room there first`).
- **Deleting a part** in the overview deletes the part, and the facts it
  shows that no other overview part shows, with their relations. In any
  other channel it deletes only the part. A group's members move to its
  parent.
- **Connecting** two parts that each show exactly one fact adds a relation
  fact between them, id `r<n>` (the first free), or shows the one that joins
  them, and a connection pointing to it; between other parts it adds a
  connection of that channel only. Connecting onto a part already connected
  the other way makes the connection two-way: in the overview its relation
  becomes two-way (`both: true`); elsewhere the connection gets its own
  `both: true`.
- **Deleting a connection** in the overview deletes the relations it shows
  that no other overview connection shows; elsewhere only the connection.
- When a fact or relation is deleted, every part and connection that showed
  it stops pointing to it. A part or connection that pointed to facts and is
  left with none is removed (a removed group's members move to its parent).

**`outdated`.** For every channel the change was *not* made in (an editor
edit or run: every channel but the current one; an outside write: every
channel whose views did not change in it) that holds a view, the change adds
the id of:

- a new component fact;
- a deleted fact or relation it showed;
- a new or deleted relation whose two ends it shows;
- a fact or relation whose label, kind, sub-line, description, items, style
  or two-way flag changed, when the channel does not show that field
  directly: its part or connection has its own value for it, or shows several
  facts.

A change the channel shows directly adds nothing: a rename through the fact,
a longer label, new files. Undo restores `outdated` with everything else.
Redrawing a channel, or "Keep as it is", empties its `outdated`.

## Warnings

`archdrawer validate` also prints warnings; they never make a file invalid.
They are checked on every channel view; *Flat* and *No held items* skip the
LinkedIn channel.

- **Overview** — the overview channel's first view has fewer than 4 or more
  than 6 top-level groups, or more than 15 connections (all of the view's
  connections count). The message gives both counts. Nothing is merged,
  moved or removed because of it.
- **Flat** — six or more top-level parts that all have a `place` on the same
  row, or none has a `place` and every one is an end of a numbered
  connection.
- **No held items** — six or more parts and no panel.
- **Tuning number** — a drawn label, sub-line or item with a number and a
  unit of time, count or size (`6 turns`, `90 s`, `2 retries`, `5 MB`,
  `30%`).
- **No main path** — three or more connections and none has a step.
- **Repeated label** — the same non-empty drawn label (trimmed,
  case-insensitive) on three or more connections of a view.

## Normalisation

Applied only to a valid file, by `archdrawer open`, by the server whenever it
reads a file, and on import:

- a missing document `id` is assigned (`d_` + 10 lower-case letters/digits);
- `source` becomes `{"kind": "local", "path": <repository root>}` for a file
  in a repository; an imported document keeps its own `source`;
- missing `theme`, `requests`, `warnings`, `facts.relations`, channels,
  `showSteps`, `outdated`, `lane`, connection `relations`, `texts` and text
  `size` get their defaults; `createdAt`/`updatedAt` are set when missing; a
  part's or connection's own text that is null is left out;
- every connection without an id gets the next free `e<n>` of its channel;
- every part without a position is laid out (*Layout*), and every group's
  `x`/`y` becomes its computed box.

The result is written pretty-printed with two spaces and a final newline,
only when it differs from the file's text; `updatedAt` moves only then.

## Geometry

Sizes are a function of a channel view's content, measured with the bundled
Geist metrics. The editor and every export draw from the same numbers.

- **card** 196 × 108; the label wraps to at most 3 lines, each extra line
  adding 18.
- **compact** 46 tall; as wide as icon, label and sub-line need, 140–320.
- **panel** as wide as its widest row needs, 184–320; height
  `24 + 22 + (sub ? 17 : 0) + (k ? 10 + 26k + 4(k − 1) : 0)` for `k` items.
- **group** its children's bounding box plus 18 px at the sides and bottom
  and a 46 px header, at least as wide as its header text; a group with no
  children is 260 (or its header width) × 140 at its position.
- Step badge radius 10.5; connection label box 22 tall.

**Post style.** The LinkedIn channel's view measures and draws denser, in the
editor and in exports alike: part and group names 16.5 px (compact names
15 px), every other text at least 12.5 px; card 176 × 84, widening up to 204
for its sub-line, each extra label line adding 20; panel 150–300 wide, height
`14 + 22 + (sub ? 16 : 0) + (k ? 6 + 19k + (k − 1) : 0)`; badge radius 11.5.

**Connections** are smooth curves: one cubic or a chain of up to three
(`M … C …`, no `L`, `H` or `V`), joined without a corner (directions equal
within 1°), the end handles along the end sides' normals and every handle at
least 24 px long. A connection leaves from the side of each part that faces
the other end; several on one side are spread up to 16 px apart, ordered by
where the other end is. A group's name box (from the group's left edge to
2 px past its name, sub-line or detail mark, 46 px tall) is never crossed;
connections entering a member in the group's first row from above come in
right of the name, at least 10 px apart.

A connection whose plain curve would enter a part other than its ends or a
group name (or, in a post, cross more earlier lines than an arc would) takes
an arc through one or two bend points: never into a group name, at least 8 px
clear of every non-group part, never into its own two ends. The cheapest arc
wins: cost = length ÷ distance between the two centres + 0.25 per earlier
line crossed (ties: fewer bends, shorter, further right). No arc is longer
than max(1.8 × distance, distance + 120). When no arc fits around
automatically placed parts, the layout widens the gap the arc needs and
routes again, at most three times, undoing a widening that does not help;
stored positions never move. If there is still no arc, the shortest curve
that stays out of group names is drawn and the layout report lists it in
`edgesOverParts`.

A label takes the free spot nearest the middle of its curve, 4 px clear of
parts, group names, texts and earlier labels and no further from the curve
than half its width + 10 px; with no such spot it is left out. A step badge
takes the free spot nearest the middle, its radius + 3 px clear of all of
those and of every label.

## Layout

Parts without a position are placed on a grid, then cells become pixels by
the widest part of each column and the tallest of each row.

- Without lanes: `place` puts a part in that cell (row 0 is the main row;
  negative rows are above). Others go next to what they connect to, the main
  path (connections with steps, in step order) along one row; inside a group
  the main path wraps back and forth over two or three columns. Gaps are
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
- Hidden connection labels reserve no gap. Parts that already have a
  position keep it; new ones are placed beside them on an 8 px grid without
  overlapping anything.

## Engine answers (refine and simplify)

The engine receives a **draft** of the run's channel: `title` and every view
of the channel as channel views (`id`, `title`, `caption`, parts with their
drawn content, connections with their drawn label, style and two-way flag)
without document metadata, texts, requests, warnings, connection ids or
relation ids, with each part's `facts` and current `box` `{x, y, w, h}`
instead of `x`/`y`. It answers the whole draft in the strict schema dialect
(every property required, no extra properties, absence as `null`, `""` or
`[]`) without `box`, plus `at` (`{x, y}` or null) on every part and
`relayout` (part ids) on every view; `lane` and `facts` are required on every
part.

The answer is repaired. Every repair that changes what the engine said adds
exactly one warning: an unknown kind becomes `service`; an unknown form
`card`; a panel without items `card`; items on a non-panel are dropped; a
panel's empty items are dropped and more than 12 are cut; an unknown icon or
style becomes the default; a part or view id is cleaned to letters, digits,
`-` and `_`, an empty one becomes `component-<n>` or `view-<n>`, an invalid
one is replaced and a duplicate is renamed `<id>-2` (one warning per id); a
second copy of a view is ignored; an empty label becomes the id, an empty
description `No description yet.`, and an empty view title, caption title or
drawing title the stored one; a `place` beyond ±20 is clamped and one that is
not two integers is dropped; a `step` that is not a positive integer is
dropped; a dangling `parent` or `detail` is cleared; parent loops and
over-deep nesting move to top level; an invalid lane, a taken spine order or a
bad anchor is dropped; unknown `facts` ids are dropped, and a fact an
earlier part of the view already shows is dropped from a later part (a part
left with no fact keeps its drawn text as its own); empty file paths,
files outside the repository or not found are removed and more than 20 are
cut; over-long text is shortened with `…`; parts over 60 in a view are cut,
the last ones first, never one the run may not change (one warning per view);
connections to missing parts, self-connections and second connections on a
pair are dropped; a reverse connection merges into the first as two-way; an
`at` on a new group is ignored; unknown `relayout` ids and anything outside
the run's scope (parts, connections, views, and in a `parts` scope the view's
title and caption and the drawing's title) are ignored. A view with no parts
fails the run.

Normalisation is silent, because it changes nothing the engine said: runs of
whitespace in text become one space and text and ids are trimmed (an id that
differs only by surrounding spaces still matches its references); in file
paths `\` becomes `/`, a leading `./` goes and a path listed twice is kept
once; a fact listed twice in one part's `facts` is kept once; an empty icon
becomes null; an absent `place`, `step` or `at` is null.

**Writing the answer back.** The repaired answer is a new state of the
channel's views and goes through *Edits: facts or channel* as one change made
in the run's channel. A part that keeps its id is compared field by field
with what it drew before; each field that differs is edited as an editor
edit of that field would be (a card's items, which it never draws, are never
written). A new part with no `facts` adds a fact; one with `facts` points to
them. A part the answer leaves out is deleted as an editor deletion in that
channel is. Connections match by their ends (either direction when two-way)
and keep their `relations`; one whose ends changed is a deletion and an
addition. Other channels get `outdated` marks by the same rules.

Positions: a kept part keeps its position unless it has an `at` (more than
1 px from its current top-left; snapped to the 8 px grid) or is in
`relayout`. An `at` on a group moves everything inside it. A moved part that
would overlap one that did not move goes to the nearest free spot (one
warning). Parts in `relayout` and new ones without `at` are laid out. Texts,
requests and existing connection ids are kept.

**Simplify coverage.** A simplify run changes only the overview channel's
appearance: it may merge parts (a part with several `facts` and its own
label, kind and description), move parts into detail views and add views. The
facts never change: a content change in its answer is ignored, one warning
each. Every component fact must still be shown by a part of
the overview, of a view reached from it through `detail`, or of a view left
exactly as it was. Views not reached from the overview are restored as they
were (one warning each); a new view nothing links to is left out. A fact
shown by no part fails the run with
`The simplified drawing loses <n> components: <ids>. Nothing was changed.`

## Post answers (story intent)

A post run's engine answers this schema exactly (every property required, no
others); it carries no pixels, forms or document fields:

```json
{ "title": "", "lede": "",
  "zones": [{ "id": "", "label": "" }],
  "parts": [{ "id": "", "label": "", "sub": "", "kind": "service", "chips": [""],
              "zone": null, "spine": 0, "anchor": null, "side": null, "facts": [] }],
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

**Conversion** into the LinkedIn channel's one view: zones become group parts
(`zone-<id>`) with no facts, their label, kind `service` and description
`A group of components.`; parts become panels (chips as their own items) or
cards; `zone` becomes `parent`, `spine`/`anchor`/`side` become `lane`;
`facts` keeps only existing component facts (one warning per dropped id),
lists each once, and drops a fact an earlier part already shows (one warning
each). A
part showing exactly one fact keeps a label, sub-line or kind as its own only
where it differs from the fact's; any other part gives its own label and
kind, and its description is its first fact's, else its sub-line, else its
label. Part ids are unique in the channel: an invalid id is sanitised with
one warning; a taken one is suffixed `-2` without one, since the intent's ids
only tie the intent together. A connection between two parts that each show
one fact shows the relation joining those facts when there is one (its ends
swapped when the relation runs the other way), keeping its label and style as
its own only where they differ; connection ids are
`<from>-<to>`. A reverse pair becomes one two-way connection (keeping the
first label, else the second, and the earlier step), a same-direction
duplicate is dropped, steps are renumbered 1, 2, 3 … — one warning each. The
view's id is kept when the channel already has a view, else `linkedin`, or
`linkedin-2`, `-3`, … when another view has that id; its title
`LinkedIn`, its caption the intent's title and lede, no texts, laid out by
its lanes. It replaces the channel's view and empties the channel's
`outdated`; the facts and every other channel are unchanged. The result must
pass validation before it is saved.

## Reading `archdraw/diagram@2`

Opening, importing, following an outside change and `archdrawer migrate`
convert a file with `"schema": "archdraw/diagram@2"` and the server writes it
back as `@3`. The conversion adds the warning `Converted from
archdraw/diagram@2` and one warning per change of meaning below; a file that
is invalid as `@2` is invalid and not converted.

- **Overview.** Every view without `postOf` becomes, in file order, a view of
  the overview channel with the same id, title, caption and texts. A view's
  `@2` `notes` (`{id, text, x, y}`) become 16 px texts, one warning per view.
- **Facts.** Every component of those views becomes a component fact with its
  id, label, kind, sub-line, description, files and items, and a part with the
  same id pointing to it, keeping form, icon, parent, detail, place, lane and
  position, with no own text. A component whose `from` names other components
  of those views is a merged part instead: it points to their facts and keeps
  its label, kind, sub-line, description and, when it is a panel, items as
  its own text (one warning for it when its files are not all among theirs,
  which are dropped). `from` ids that name no such component are dropped,
  with one warning per file. A fact an earlier part of the same view already
  shows is dropped from a later merged part, one warning each.
- **Ids.** A relation fact takes the connection's id when no component fact
  has it, else the first free `r<n>`; the connection keeps its own id.
- **Links.** A `detail` that names a view which does not become an overview
  view is cleared, one warning each.
- **Relations.** Every connection between two components that became facts
  becomes a relation fact with its id, ends, label, style and two-way flag,
  and a connection with the same id pointing to it and keeping its step.
  A connection touching a merged part points to no relation and keeps its
  label, style and two-way flag as its own.
- **The post.** A view with `postOf` becomes the LinkedIn channel's view,
  keeping its id: its parts point to the facts their `from` names (those that
  exist, each once, none an earlier part already shows), keeping as their
  own text what differs from a single fact, or all of it when they show none
  or several; `items` only on a panel, as its own when they differ from its
  fact's, and null on every other form; `detail` cleared. Its connections
  show the relation between their ends' single facts when there is one, ends
  swapped when the relation runs the other way. Only one post can move
  there: the first view's post, else the first post in file order. Every
  other post becomes an overview view, converted the same way (one warning
  each: `The post "<id>" is now a view of the overview; the LinkedIn channel
  holds one drawing`).
- `showSteps` is copied to every channel that holds a view; every
  `outdated` is empty. A request on a view without `postOf` gets channel
  `overview`; one on the post that moved, `linkedin`; one on another post,
  `overview`.
- The `@2` validity rules about `postOf` and `from` and the `-linkedin` id
  convention are gone; nothing in `@3` depends on an id's ending.

## Reading `archdraw/diagram@1`

`archdrawer migrate` and import convert a file with
`"schema": "archdraw/diagram@1"` to `@2`, then to `@3` as above: one view
`overview` (title `Overview`, caption from the old title and subtitle); nodes
keep id, label, files and position, `tech` becomes `sub`, kind `ui` becomes
`client`, a missing description becomes `No description yet.`, form `card`;
each old group becomes a `service` group with icon `layers` and description
`A group of components.`; `call`/`async` edges keep their style, a `result`
edge merges into its reverse `call` as two-way or becomes a `call`; notes
become 16 px texts; over-long text is shortened. Every change other than a
plain rename adds one warning.
