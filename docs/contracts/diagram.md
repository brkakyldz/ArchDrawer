# Contract — the drawing document

A drawing is one UTF-8 JSON file, usually inside the repository it describes
(`docs/architecture.archdraw.json` by convention). Agent sessions, the editor
and the instruction engine write it; the CLI, the server and the editor read
it. This file defines its shape, the rules that make it valid, how an edit is
split between the facts and a channel, the warnings it can carry, how it is
normalised, measured and laid out, and what an engine answers when it changes
a drawing. Why the file is shaped this way: ADR 0003, ADR 0006 and ADR 0007.

Implemented by: `src/core/file3.ts` (the `@3` shape, validation, defaults),
`src/core/channels.ts` (joining a channel view, splitting an edit, `outdated`,
warnings, normalisation), `src/core/convert.ts` (reading `@2`),
`src/core/model.ts` (the view shape and the `@2` rules),
`src/core/normalize.ts`, `src/core/geometry.ts`, `src/core/layout.ts`,
`src/core/repair.ts` (engine answers), `src/core/intent.ts` (story answers),
`src/core/evidence.ts` (read answers and the evidence check),
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
    "relations": [ /* relation facts, at most 3600; optional, default [] */ ],
    "limits": [ /* limit facts, at most 600; optional, default [] */ ]
  },
  "channels": {
    "overview":     { "views": [ /* 1–30 views; views[0] is the overview */ ], "showSteps": false, "outdated": [] },
    "linkedin":     { "views": [ /* 0 or 1 view */ ], "showSteps": false, "outdated": [] },
    "readme":       { "views": [ /* 0 or 1 view */ ], "showSteps": false, "outdated": [] },
    "presentation": { "views": [ /* 0 or 1 view */ ], "showSteps": false, "outdated": [],
                      "steps": [ /* the presentation's ordered steps; optional, default [] */ ] }
  },
  "requests": [],               // optional; instructions waiting for the next session
  "warnings": []                // optional; one line per repair or conversion of the
                                //   last change: a run that saves replaces the list
                                //   with its own, so a clean run leaves it empty
}
```

**Facts** say what is true about the system; **channels** say how it is told.
A channel is one of four fixed names. `showSteps` (optional, default false)
draws numbered step badges in that channel. `outdated` (optional, default
`[]`) lists the facts changed since the channel was drawn that it has not
taken up (*Edits: facts or channel*). A channel other than `overview` may be
written as `{}` or left out; it is then empty. Every field ADR 0007 added
(`limits`, `evidence`, `within`, a part's `held` and `limits`, the
presentation's `steps`) is optional, so a file written before it stays valid.

### Component fact

```jsonc
{
  "id": "gateway",
  "label": "Tool gateway",            // 1–48 chars
  "kind": "gate",                     // one of the ten kinds
  "sub": "every call passes here",    // 0–60 chars, one line under the label
  "description": "The only way …",    // 1–400 chars
  "files": ["src/tools/gateway.py"],  // 0–20 repository-relative paths
  "items": ["Schema validation"],     // 0–12 strings of 1–44 chars: what it holds inside
  "within": null,                     // optional, default null: the component fact that holds this mechanism
  "evidence": [{ "file": "src/tools/gateway.py", "lines": [12, 48] }]  // optional, default []
}
```

A component fact with `within` is a **mechanism**: a part of how the
component it names works (an agent's tool loop, a retry policy, a cache
lookup). A story holds it in that component's part (`held`, listed in the
part's callout, never drawn as a row) or draws it as a part of its own, often
inside the component's part. Mechanisms and their holders are ordinary
component facts for every other rule.

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
dependency). `both`: the relation runs both ways. `evidence` (optional,
default `[]`) as for a component fact.

### Limit fact

```jsonc
{ "id": "turn-limit", "on": "agent", "text": "Stops after 12 turns", "evidence": [{ "file": "src/agent.ts", "lines": [30, 31] }] }
```

A limit says a guarantee of the component fact `on` in one line: a deadline,
a turn limit, a size cap, a retry count. `text` 1–60 chars; numbers belong
here (STORY-5). `evidence` optional, default `[]`.

### Evidence

```jsonc
[{ "file": "src/agent.ts", "lines": [30, 31] }, { "file": "README.md", "lines": null }]
```

0–8 entries. `file` is repository-relative as `files` are (rule 14); `lines`
is null (the whole file) or `[from, to]`, integers with `1 ≤ from ≤ to`.
Evidence says where a fact comes from; `files` stay what a part offers to
open. A read answer must give evidence and code checks it (*Read answers*);
in a file it is optional, and only its paths are checked, as `files` are.

### View

```jsonc
{
  "id": "overview",
  "title": "Overview",                       // breadcrumb name, 1–60 chars
  "caption": { "title": "How an order flows", "lede": "" },  // title 1–120, lede 0–240
  "subLines": false,                         // optional, absent = true: parts draw their sub-line
  "nodes": [ /* parts, at most 60 */ ],
  "edges": [ /* connections */ ],
  "texts": [ /* free texts; optional, default [] */ ]
}
```

`subLines` is the view's sub-line switch (LOOK-3): absent or `true`, every
part of the view draws its sub-line; `false`, none does, and every part is
measured without it (*Geometry*). Any other value is invalid (rule 4). It is
appearance: changing it changes only its channel (*Edits*). The editor writes
`false` and removes the field when the switch is turned on again, and
normalisation never adds it, so a file without it is valid and unchanged; the
format stays `archdraw/diagram@3`. A redraw or a simple version that replaces
a channel's view keeps that view's `subLines`; engine answers neither see nor
change it.

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
  "held": ["approval-check"],         // optional, default []: mechanisms within its facts, listed in its callout
  "limits": ["call-timeout"],         // optional, default []: limit facts on its facts or held facts, listed in its callout
  // optional, absent or null = taken from the fact; a value = this channel's own text
  "label": null, "kind": null, "sub": null, "description": null, "items": null
}
```

Icons: `user users clipboard monitor window zap timer spark cloud shield scale
layers bell db chat loop book pen receipt inbox box cpu cog globe key lock mail
file folder terminal code server queue search chart eye git plug`.

Forms: `card` (icon, label, sub-line); `compact` (one row: icon, label,
sub-line); `panel` (a part that holds rows: held mechanisms, shown items and
limits — only a panel holds them; it is drawn exactly like a `card` of its
kind, and its rows are listed in its callout, never drawn); `group` (a header
and the parts whose `parent` it is — only a group may be a parent).

Shapes: every `card`, `compact` and `panel` part draws the outline of its
kind (*Geometry*, Shapes); a group draws its frame. The shape comes from the
kind alone; there is no shape field.

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

### Presentation steps

```jsonc
{ "id": "s1", "parts": ["intake", "loop"], "text": "A request is checked first", "note": "The intake refuses …" }
```

The presentation channel's `steps` (0–20) are the order it is told in. A step
highlights the parts of the presentation view it names (1–60 distinct part
ids), shows `text` on screen (1–120 chars) and carries a speaker `note`
(0–1000 chars, newlines allowed). Step ids are unique in the channel. Steps
are appearance (*Edits*).

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
- A panel's rows are, in this order: the labels of its `held` mechanisms,
  its shown items (the part's `items` when not null, else its single fact's
  `items`), then the texts of its `limits`. No form draws a row, on the
  canvas or in any export, and geometry ignores them: the rows are listed in
  the part's callout (ui contract, *Callout*). Any other form holds no row.
  In the joined view shape `items` holds every row's text, and `heldIds`
  and `limitIds` name the mechanisms of its first rows and the limits of its
  last. Each row keeps its own fact's length: a held row up
  to a label's 48 chars, a limit row up to a limit's 60, a shown item up to 44.
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
   fact's. View ids are unique across the file. Limit ids share the facts'
   id space.
   Part, connection, text and step ids are unique within their channel.
   Request ids are unique.
3. Every component-fact and relation-fact property above is present. Every
   part property is present except `x`/`y`, `lane`, `held`, `limits` and
   the five own texts;
   every connection property except `id`, `relations` and the three own
   values. `x` and `y` are both present or both absent, and finite.
4. Lengths, list sizes and enumerations as stated above, for facts and for a
   part's or connection's own values alike. Required strings are non-empty
   after trimming.
5. `channels` holds `overview` and may hold `linkedin`, `readme` and
   `presentation`, no other key; each is an object with at most `views`,
   `showSteps` and `outdated` (`views` required in the overview), and the
   presentation also `steps`. The overview holds 1–30 views; each other
   channel at most one.
6. A part's `facts` are distinct component facts. A fact is shown or held by
   at most one part of a view.
7. A part with no fact or with several gives its own `label`, `kind` and
   `description`.
8. A panel shows at least one row; a part that is not a panel has `items`
   null and no `held` or `limits`.
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
    symlinks resolved. Where the command line opens a drawing (`archdrawer
    open` and `svg`) a missing path is a warning instead, `<json path>:
    "<path>" does not exist in the repository`, so a file deleted or renamed
    later never locks a drawing. The server registers and saves such a file
    without a warning; `check-files` names its missing paths (api contract)
    and the editor marks them (ui contract, `callout-files`). The repository root
    is the nearest ancestor of the file's folder holding `.git` (as the api
    contract's *Folders* counts one), else the file's folder. A file in a
    folder named `docs` (any case where the disk ignores case) whose `source`
    is that folder's parent, as a `draw` run writes it, is rooted at that
    parent when the parent is a repository's root or lies outside git, even
    when `docs` holds a `.git` of its own. A registered drawing's
    `source` is always that root.
15. At most 60 parts per view.
16. Every component fact is shown or held by at least one part of the
    overview channel.
17. `outdated` lists distinct ids (any id syntax; a removed fact's id stays
    listed). An empty channel's `outdated` is `[]`.
18. A request names an existing channel and one of its views.
19. `lane` follows *Lane* below.
20. A component fact's `within` names another component fact, never itself;
    the fact it names has no `within` (one level).
21. A limit's `on` names a component fact.
22. A part's `held` are distinct mechanisms whose `within` is one of the
    part's facts; its `limits` are distinct limit facts on one of its facts
    or held mechanisms. Together they and the shown items make at most 12
    rows.
23. Evidence follows *Evidence*: at most 8 entries, each path as in rule 14,
    `lines` null or `[from, to]` with `1 ≤ from ≤ to`.
24. A presentation step names 1–60 distinct parts of the presentation view;
    a channel without a view has no steps.

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
the part's own `items`), which mechanisms it holds and which limits it shows
(`held`, `limits`), a connection's step, texts, captions, view titles, a
view's `subLines`, `showSteps`, the presentation's steps (adding, removing,
reordering, a step's parts, text and note), and any of a part's or
connection's own texts.

**Content** changes the facts:

- **Where a text edit goes.** A part's field is edited in its own text when
  the part already has one for that field or has no single fact. Otherwise:
  in the overview, every field edits the fact, and every channel shows the
  new text at once; outside the overview, the **label** and **sub-line**
  become the part's own text (a shorter name for that channel), while kind,
  description and items edit the fact. An own text that ends up equal to the
  single fact's is cleared to null. A connection's label, style and two-way
  flag follow the same rule with its single relation: outside the overview
  its label and two-way flag become its own, while its style edits the
  relation.
- **Items.** A panel with null `items` shows its fact's items, and editing,
  adding, moving or removing one edits the fact. When a fact is left with no
  items, every panel that showed them through null `items`, in every channel,
  becomes a card. Choosing the form panel shows the fact's items, or adds
  `New item` to the fact when it has none (to the part's own items when it
  has no single fact); leaving panel sets the part's `items` to null and
  removes no item from the fact (held mechanisms follow *Mechanisms and
  limits*). Showing fewer items than the fact holds is the part's own `items`.
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
  A deleted component fact takes its mechanisms (`within` it) and its limits
  with it, and every part stops holding or showing them; a side part whose
  anchor is removed keeps no lane.
- **Mechanisms and limits.** A held mechanism's row is its label: renaming
  the row renames the mechanism fact, in every channel, wherever the edit is
  made. A limit row's text edits the limit fact the same way. Removing a held
  row or a limit row only stops the part showing it (appearance); the fact
  stays. In the overview, where every fact is shown or held (rule 16), a
  mechanism that no overview part holds or shows any more is deleted with its
  limits: removing its last held row, or turning its panel into another form,
  deletes it. When an engine's answer does it, each deletion adds one warning:
  `View "<view>": "<part>" no longer holds "<m>"; the mechanism and its limits
  were deleted`. An answer that names no held or no limit ids keeps each drawn
  held or limit row whose exact text it repeats, wherever the row now is (a
  reordering only reorders them). When the rows it has left over are as many
  as the drawn rows left over, they are taken in order, so a changed text edits
  that mechanism or limit; any other row is an item of the part.
- **Steps.** Deleting a part of the presentation view removes it from every
  step that names it; a step left with no part is removed, one warning each
  (`Step "<id>" had no part left and was removed`).

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
  facts;
- a new limit on a fact it shows or holds; a deleted limit it showed; a limit
  whose text changed, on a fact it shows or holds, when it does not show that
  limit.

A change the channel shows directly adds nothing: a rename through the fact,
a held mechanism renamed, a limit's text it shows, a longer label, new files,
new or changed evidence. Undo restores `outdated` with everything else.
Redrawing a channel, or "Keep as it is", empties its `outdated`.

## Warnings

`archdrawer validate` also prints warnings; they never make a file invalid.
They are checked on every channel view; *Flat* skips the LinkedIn channel.
A drawing without held items is not warned about (LOOK-3).

- **Flat** — six or more top-level parts that all have a `place` on the same
  row, or none has a `place` and every one is an end of a numbered
  connection.
- **Tuning number** (LinkedIn channel only) — a drawn label, sub-line or item
  with a number and a unit of time, count or size (`6 turns`, `90 s`,
  `2 retries`, `5 MB`, `30%`). Elsewhere a number that explains a guarantee
  may show (STORY-5), best as a limit.
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

A text is measured as the sum of its characters' advance widths in the font
plus its letter-spacing: Geist with a 2 % margin, Geist Mono with none. A
character the font does not draw counts as wide as a fallback font draws it,
rounded up: 1.4 em for an emoji, 1 em for CJK and other wide scripts, 0.85 em
for a capital letter (Greek, say) and 0.62 em for anything else; a joiner or
variation selector counts nothing. The
editor and every export draw text with `text-rendering: geometricPrecision`
(the export as an attribute of its root `svg`), so each glyph is painted at
the font's own advance and no text is painted wider than it was measured.
Without it, Chromium on Linux rounds every advance to a whole pixel, and a
label measured to fit its part exactly can overrun it.

- **card** as wide as the plain card (196) plus its shape's extra width; as
  tall as its shape's content box needs (*Shapes*): 108 for the plain card
  with one label line and its sub-line row, each extra label line adding 18.
  The label wraps to at most 3 lines within the content box's width.
- **compact** one row: icon, label and sub-line; 46 tall for most shapes; as
  wide as its shape's insets and the row need, 140–320 plus the shape's extra
  width (*Shapes*).
- **panel** measures and draws exactly as a `card` of its kind. Its rows are
  never drawn, so they change no size.
- **group** its children's bounding box plus 18 px at the sides and bottom
  and a 46 px header, at least as wide as its header text; a group with no
  children is 260 (or its header width) × 140 at its position.
- Step badge radius 10.5; connection label box 22 tall.

**Sub-lines.** With the view's `subLines` on (*View*), a card keeps its
sub-line row whether or not its sub-line is empty, so its height never
depends on that text. With it off, no part draws a sub-line and none is
measured with one: a card loses its 18 px sub-line row (the plain card is 90
tall), a compact part its sub-line text, and a group header its sub-line.

**Shapes** (LOOK-2, ADR 0014). The outline of a part is the element with
class `body`; it carries `data-shape`, the same in the editor's `node-<id>`
and the export's `g[data-node-id]`. The kind alone gives it; a `panel` takes
its kind's shape as a card does, and a `group` is `group`, whatever its kind.

| Kind | `data-shape` | Card outline | Compact outline |
|---|---|---|---|
| `actor` (Person) | `person` | an avatar circle, 40 px across (post 36), centred on the box's width with its top on the box's top; the body is a rounded rectangle whose top edge passes through the avatar's centre. The avatar holds the icon (22 px; post 20) | the left end is a circle as tall as the part (46 px) holding the icon (18 px); the body runs right from its centre |
| `client` (Client app) | `window` | a rounded rectangle with a title bar across its top, 14 px tall (post 10), tinted in the kind colour, holding three dots (radius 2, 6 px apart, the first 10 px from the left) and an address capsule (6 px tall, 40 % of the width, centred) | a 6 px title bar across the top, no dots |
| `api` (API) | `port` | a hexagon: straight top and bottom edges, the left and right ends coming to a point at the side midpoints, 14 px deep (post 12); a dot of radius 3 in the kind colour at each point | the same, 10 px deep, dots of radius 2.5 |
| `service` (Service) | `card` | the rounded rectangle (radius 12) with a 3 px rule in the kind colour along the inside of its top edge, from 12 px to the width − 12 | the rule runs along the inside of the left edge, from 10 px to the height − 10 |
| `worker` (Background job) | `stack` | the front card is the box less 8 px at the top and right; two outlines behind it, each 4 px right and 4 px up from the one in front | the same with 6 px and 3 px |
| `llm` (AI agent) | `agent` | a rounded rectangle whose 1.5 px stroke is a gradient from the kind colour at the top left to the agent end colour at the bottom right; an inner outline 4 px inside at opacity 0.35; a spark (the `spark` icon, 10 px) 8 px inside the top-right corner | the same, inner outline 3 px inside, spark 8 px, 4 px inside the corner |
| `external` (External) | `external` | a dashed outline (`6 4`) whose top edge is three cloud bumps 10 px tall (post 8); the rest is the rounded rectangle | the same, bumps 6 px tall |
| `ops` (Monitoring) | `pulse` | the rounded rectangle with a pulse line in the kind colour inside its bottom inset: flat, with one spike up at 60 % of the width that stops 2 px short of the content box, and a faint kind fill (the tint opacity) between it and the bottom edge | the same within the 8 px bottom inset |
| `gate` (Check) | `check` | a shield: a flat top with rounded corners, straight sides, and a bottom that curves from both sides to a point at the bottom middle; the sides end 18 px (post 14) above the box's bottom | the same with a shallow point: the sides end 8 px above the bottom |
| `data` (Data store) | `store` | a cylinder of stacked disks: a lid ellipse (ry 8; post 6) tinted in the kind colour, three slabs of equal height, every second one a shade deeper (twice the tint), a 3 px notch in each side at every slab boundary, slab rims that fade out over the middle third of the width so no line crosses the text, and a bottom that is the lower half of an ellipse with the same ry | two slabs, lid ry 4 |

The theme gives every colour: the kind colours (and the tint, glow and
surface tokens) in light and dark. The one extra colour is the agent
gradient's end, `agentEnd`: `#8b5cf6` light, `#c4b5fd` dark.

**Content box.** Each shape has a content box, the area its icon, label and
sub-line stay inside: the box less the insets below. A card's content is, top
to bottom and centred across the content box, the icon (26 px) and an 8 px
gap — not for `person`, whose icon is in its avatar —, its label lines (18 px
each; post 20) and, with sub-lines on, the sub-line row (18 px). Its height is
the top inset + that content + the bottom inset. Its width is the plain
card's (196; in the post style 176, widening up to 204 for its sub-line) plus
the shape's extra width. A compact part's content is one row centred
vertically in the content box: the icon (18 px; not for `person`), 10 px, the
label, then 10 px and the sub-line, right-aligned at the content box's right
end. Its width is the left and right insets plus that row + 2, between 140
and 320, plus the shape's extra width.

| `data-shape` | Card insets: top / right / bottom / left (post style) | Card extra width | Compact height | Compact insets: top / right / bottom / left | Compact extra width |
|---|---|---|---|---|---|
| `card` | 19 / 12 / 19 / 12 (6 / 12 / 6 / 12) | 0 | 46 | 0 / 12 / 0 / 12 | 0 |
| `person` | 48 / 12 / 24 / 12 (42 / 12 / 6 / 12) | 0 | 46 | 0 / 12 / 0 / 54 | 0 |
| `window` | 19 / 12 / 19 / 12 (14 / 12 / 6 / 12) | 0 | 46 | 6 / 12 / 0 / 12 | 0 |
| `port` | 19 / 26 / 19 / 26 (6 / 24 / 6 / 24) | 28 (24) | 46 | 0 / 22 / 0 / 22 | 20 |
| `stack` | 27 / 20 / 19 / 12 (14 / 20 / 6 / 12) | 8 | 52 | 6 / 18 / 0 / 12 | 6 |
| `agent` | 19 / 12 / 19 / 12 (6 / 12 / 6 / 12) | 0 | 46 | 0 / 12 / 0 / 12 | 0 |
| `external` | 29 / 12 / 19 / 12 (14 / 12 / 6 / 12) | 0 | 52 | 6 / 12 / 0 / 12 | 0 |
| `pulse` | 19 / 12 / 19 / 12 (6 / 12 / 16 / 12) | 0 | 46 | 0 / 12 / 8 / 12 | 0 |
| `check` | 19 / 12 / 37 / 12 (6 / 12 / 20 / 12) | 0 | 54 | 0 / 12 / 8 / 12 | 0 |
| `store` | 27 / 15 / 27 / 15 (12 / 15 / 12 / 15) | 0 | 54 | 8 / 12 / 4 / 12 | 0 |

So a card with one label line and its sub-line is 108 tall as `card`,
`person`, `window`, `port`, `agent` and `pulse`, 116 as `stack`, 118 as
`external`, 124 as `store` and 126 as `check`; in the post style 84 as `card`,
`port` and `agent`, 86 as `person`, 92 as `window`, `stack` and `external`, 94
as `pulse`, 96 as `store` and 98 as `check`. The shield, the cylinder, the
cloud top and the stack make a part taller than a plain card with the same
text.

- Every shape lies inside the part's box. The first `rect.box` stays the
  part's box (parity check); selection, search and drop-target rings stay
  box-shaped. The editor and every export draw from the same numbers
  (invariant 5).
- The detail mark (14 px) sits 8 px inside the top-right corner of the
  outline's front body: the body under the avatar for `person`, the front
  card for `stack`, the part below the bumps for `external`, the part between
  the points for `port`, the box for the others. An agent's spark then moves
  6 px left of it. In a compact part it ends the row, as before.
- Connections take their sides and spread their ends on the box, as
  *Connections* says. On the left and right sides of a `port`, every end
  attaches at the point: those ends are not spread. Anywhere else, where the
  outline lies inside the box at an end's place (beside the avatar, under a
  cloud's dip, along the shield's curve, the cylinder's lid and bottom, the
  stack's offset), the end moves straight in along its side's normal until it
  meets the outline, so the arrowhead touches the part.
- The post style draws the same shapes, with the numbers in parentheses.

**Post style.** The LinkedIn channel's view measures and draws denser, in the
editor and in exports alike: part and group names 16.5 px (compact names
15 px), every other text at least 12.5 px; card 176 wide, widening up to 204
for its sub-line, 84 tall as the plain card with one label line and its
sub-line row, each extra label line adding 20; a panel measures as a card of
its kind; badge radius 11.5.

**Connections** are smooth curves: one cubic (`M … C …`, no `L`, `H` or
`V`), its handles along the end sides' outward normals, each 0.42 × the
distance between the ends, between 24 and 160 px, and never longer than the
gap when the two ends face each other across a short one (below). A
connection in a trunk ends where its trunk starts (*Trunks*).

*Sides.* The *facing pair* is, as before, the pair of sides that face each
other across the larger of the horizontal and vertical gaps between the two
parts. Between a part and a group holding it, both ends use the side where
the part lies nearest the group's border. When the facing pair's curve would
have no length or go inside one of its own two parts (parts that touch or
overlap), both ends use the like sides whose curve stays out of both, the
shortest, right first on a tie. Otherwise each end takes the cheapest side of
its part that faces the other end (LAYOUT-5):

- a side *faces* the other end when its outward normal points towards the
  other part's centre (a positive dot product with the vector between the two
  centres); a part has one or two facing sides;
- a side's cost is `1 − cos θ`, θ the angle between its outward normal and
  the vector from its part's centre to the other part's centre, plus 0.25 for
  every end of another connection the side holds;
- every connection first takes its facing pair; then, in the view's order,
  each connection takes for each end its cheapest facing side, counting the
  ends the other connections hold at that moment. One pass. A tie (within
  0.001) keeps the facing pair's side. A pair's cost is the sum of its two
  sides' costs.

This is stateless: one view always gives the same sides, in the editor and
every export.

*While dragging* (editor only, ADR 0013). While a pointer is down on a drag,
a connection with an end among the dragged parts keeps the sides it had at
the previous move unless the cheapest pair costs less than 0.8 × the kept
pair's cost (both counted as above at this move), or a kept side no longer
faces the other end. When an end's side or place changes during the drag, it
glides there over 120 ms instead of jumping. On release every route is the
stateless one the export draws, and an end may glide there once (120 ms).
Exports, the layout report and every stored state never use held sides.

*Ends.* Several connections on one side are spread up to 16 px apart,
ordered by where the other end is; a trunk counts as one end. Connections
entering a member in a group's first row from above come in right of the
group's name when the part leaves room, at least 10 px apart. Shapes move
some ends onto the outline (*Shapes*).

*Short gaps.* When the two ends' sides face each other — a right side and a
left side, or a bottom and a top — across a gap `g` (the distance between the
two ends along the sides' normal), a handle is never longer than the larger
of `g` and 8 px. So between close parts the curve never leaves the gap, and
two ends in line give a straight line. The post's spine turn-out
below keeps its own rule.

A connection is never bent around anything (ADR 0011, ADR 0013). Groups are
drawn first, then connections, then parts. A curve that meets a part other
than its ends passes behind it, and the layout report lists it in
`edgesOverParts`. A connection that crosses a group's frame or header band
passes over it. One exception keeps a post's spine visible: in a post, a
line straight down or up whose plain curve passes behind parts between its
ends leaves and enters by the same side instead, as one cubic whose handles
are the shortest (24 px upward in 8 px steps, at most 160) that clear every
part by 8 px, on the side that stays within the parts' extent with its
badge, right on a tie; with no such curve it stays straight. When a curve
passes behind a part placed automatically, the layout widens the gaps
beside that part and routes again, at most three times, undoing a widening
that does not clear it; stored positions never move.

*A group's name* (ADR 0013). A group is drawn in two layers: its frame
(outline, fill and glow) under the connections, and its head — icon, name,
sub-line and detail mark — over the connections and under the parts. The
name and the sub-line carry a halo: `stroke` in the header's colour,
`stroke-width="4"`, `stroke-linejoin="round"`, `paint-order="stroke"`, so a
line that crosses the header is hidden only under the letters and 2 px
round them. The header's colour is the group's fill as painted, made solid:
the kind colour at 5 % over the surface at 60 % over the canvas. Nothing is
cut out of a line: there is no clip. In an export the head is
`<g data-group-head="<group id>">`, after every connection and trunk and
before the first non-group `<g data-node-id>`. Labels and badges keep off a
group's name box as before.

*Traces* (LOOK-4). Where a drawn connection passes behind a part it does not
join (a part the layout report lists it over in `edgesOverParts`), the same
path is drawn again over that part: `<path class="trace"
data-edge-of="<connection id>">` inside the part's `<g data-node-id>`, after
its outline and before its icon and text, clipped to the part's box, in
the line's colour (*Colour*) at opacity 0.25, 1 px wide, with its style's
dash, no glow and no arrowhead. A connection that passes behind nothing has
no trace; a hidden connection (*Parts many parts use*) has none while it is
hidden.

*Colour* (LOOK-4, ADR 0013). A connection is drawn in the theme's neutral
colour `edge` — `#848b98` light, `#636a77` dark — line and arrowheads alike,
with no glow. It is drawn in its kind colours — a gradient from its `from`
part's kind colour to its `to` part's, each arrowhead in the kind colour of
the part it points at, and the glow (opacity `edgeGlow`, never on `dep`) —
when it has a step, in the editor and every export, and in the editor while
it is in focus (ui contract, *Connections in focus*). Exports colour only
connections with a step. Every `<g data-edge-id>`, and the editor's
`edge-<id>`, carries `data-tone`: `kind` when coloured, else `neutral`.

- One arrowhead at the `to` end; a two-way connection has one at each end. A
  one-way connection draws nothing at its start: its `<g data-edge-id>`
  holds no `circle` other than its step badge's.
- `call` is solid and `async` dashed (`6 5`), both 1.75 px; `dep` is dotted,
  1.9 px, `stroke-dasharray="2 5"` with round caps.

*Labels.* Labels are placed once every route is known. A label takes the free
spot nearest the middle of its curve, 4 px clear of parts, group names, the
`used by` marks, texts and earlier labels, with its box no further than 10 px
from the curve. Among those spots it takes the nearest whose box, grown by
2 px, touches no other drawn connection's line or trunk, when there is one,
else the nearest free one; with no free spot it is left out. Its box's border
is the `line` colour on a neutral connection and its `to` part's kind colour
on a coloured one. A step badge takes the free spot nearest the middle, its
radius + 3 px clear of all of those and of every label.

*Trunks* (LAYOUT-5). Connections share a trunk when they arrive (their `to`
end) on the same side of the same part with the same style, and come from the
same direction: sorted by the angle from that side's middle to the centre of
each one's other part, a trunk is a run whose first and last angles are at most 30°
apart, taken greedily from the smallest angle; a run of one is no trunk. A
hidden connection is in no trunk. A trunk is one end of its side, ordered
among the others by the mean position of its members' other ends. Its split
point lies 32 px (post 24) out from the
port along the side's normal, or a third of the shortest distance from the
port to a member's start when that is less. Each member's curve runs from its
start to the split point, its handle there along the side's normal (lengths
as above, the distance being from its start to the split point). The trunk is
one straight cubic from the split point to the port, drawn once, with one
arrowhead: `<g data-trunk="<part id>:<side>" data-edges="<ids in view
order, space-separated>">` after the connections' groups, holding a `path`
(two trunks on one side differ by `data-edges`).
It is coloured (in its part's kind colour) while any member is, else
neutral. Labels and badges stay on the members' own stretches. Two members
that meet only at their split point do not cross.

*Parts many parts use* (LOOK-4, ADR 0013). A part other than a group is a
*hub* when four or more other parts use it: each has a connection into it
(its `to` is the hub) or a two-way connection with it. In every view, in the
editor and every export:

- A hub's connections from its users that have no step are *hidden*: not
  drawn, with no label, badge or trace, and no port, label spot or room of
  their own. The view is routed as if they were not there; they are then
  routed after it by the same rules, so showing one moves nothing.
- A connection with a step is never hidden.
- The hub carries the mark `used by <n>`, `n` its users, step connections
  included: a pill 18 px tall, its text 11 px, weight 500, in the muted
  colour, 7 px padding each side, filled with `surface2` and edged with
  `line`, centred on the box's bottom edge. It is `<g data-used-by="<n>">`
  inside the hub's `<g data-node-id>`, drawn after its text. The drawing's
  bounds include it and labels and badges keep 4 px clear of it.
- In the editor a hidden connection shows while one of its ends is hovered,
  selected or dragged (ui contract). An export never draws it, and the layout
  report never counts it.

The facts are unchanged: this is appearance only.

*The layout report counts what is drawn.* Its crossings and connections over
parts are measured on the drawn lines: each connection's own stretch and each
trunk, never a hidden connection (api contract, *Layout report*).

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
- Hidden connection labels, and hidden connections (*Parts many parts
  use*), reserve no gap. Parts that already have a position keep it; new
  ones are placed beside them on an 8 px grid without overlapping anything.

**Fewer crossings** (LAYOUT-6, ADR 0013). After the cells are assigned and
before cells become pixels, the order of parts within rows and columns is
improved, with and without lanes, in each grid (the top level, and each
group's own) separately:

1. *Movable parts* are those this layout places (no stored position) that
   have no `place`, are not an end of a numbered connection and are not a
   spine part. A side part moves only among side parts of the same anchor and
   side. Every other part keeps its cell.
2. *Barycentre sweeps.* A row sweep visits the grid's rows in order and sorts
   the movable parts of each row by the mean column of the parts they connect
   to in the same grid (a part inside a group of that grid counts as the
   group's cell; connections leaving the grid and hidden connections do not
   count); a part with none keeps its column, and ties keep the current order.
   The sorted parts take the cells the movable parts of that row held. A
   column sweep does the same for columns, by mean row. One round is: rows
   top to bottom, rows bottom to top, columns left to right, columns right to
   left.
3. After each round the crossings of the straight segments between connected
   parts' cell centres are counted. A round that does not lower the count is
   undone and ends the sweeps; there are at most 4 rounds.
4. *Compaction.* Rows and columns left holding no part are removed, keeping
   the order of the rest, and a group reserves only the cells its box needs.
   A `place` value is never rewritten; only the pixels it leads to move.
5. The reordered layout is kept only when the view's layout report counts no
   more crossings with it than without steps 2–4; otherwise the layout
   without them is used.

It is pure and deterministic. Only parts without a stored position move
(LAYOUT-2); the main path keeps its step order.

## Engine answers (refine and simplify)

The engine receives a **draft** of the run's channel: `title` and every view
of the channel as channel views (`id`, `title`, `caption`, parts with their
drawn content, connections with their drawn label, style and two-way flag)
without document metadata, texts, requests, warnings, connection ids or
relation ids, with each part's `facts`, `held`, `limits` and current `box`
`{x, y, w, h}` instead of `x`/`y`. It answers the whole draft in the strict schema dialect
(every property required, no extra properties, absence as `null`, `""` or
`[]`) without `box`, plus `at` (`{x, y}` or null) on every part and
`relayout` (part ids) on every view; `lane`, `facts`, `held` and `limits`
are required on every part. A refine adds no mechanism or limit fact: an id
in `held` or `limits` that is not a fact the part may draw is dropped, one
warning each.

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

## Read answers (facts)

The deep read of a `draw` run (api contract) answers the facts in the strict
schema dialect, with no layout:

```json
{ "components": [{ "id": "", "label": "", "kind": "service", "sub": "", "description": "",
                   "within": null, "evidence": [{ "file": "", "lines": [1, 1] }] }],
  "relations":  [{ "from": "", "to": "", "label": "", "style": "call", "both": false,
                   "evidence": [{ "file": "", "lines": null }] }],
  "limits":     [{ "id": "", "on": "", "text": "", "evidence": [{ "file": "", "lines": null }] }] }
```

`lines` is `[from, to]` or null; `within` is a component id or null.

**Repair** adds one warning per change, as for engine answers where the rule
is the same:

- ids are cleaned and made unique (a duplicate is renamed `<id>-2`);
- an unknown kind becomes `service`, an unknown style `call`;
- an empty label becomes the id, an empty description `No description yet.`;
- over-long text is shortened with `…`;
- more than 120 components or 60 limits are cut, the last first;
- a `within` that names no component or the fact itself is cleared; then a
  `within` naming a fact that still has its own `within` is cleared;
- an evidence entry whose `lines` are neither null nor two whole numbers is
  dropped: `<fact>: dropped the evidence <file>: its lines are not [from, to]`;
- a relation joining a fact to itself or to an unknown id is dropped, a second
  relation on a pair is dropped, and a reverse pair becomes one two-way
  relation.

Relation ids are `r1`, `r2`, … in answer order.

**The evidence check** (`src/core/evidence.ts`) is pure: it is given a
file-exists and a line-count function. It runs on the repaired answer, in
this order:

1. An evidence entry is dropped when its file does not exist under the
   repository root, is outside it, or its `lines` are not
   `1 ≤ from ≤ to ≤` the file's line count. One warning:
   `<fact>: dropped the evidence <file>[:<from>-<to>]: <reason>`, the reason
   being `not found`, `outside the repository` or `the file has <n> lines`.
   A path listed twice in one fact is kept once (its first supported
   entry), silently, and a missing one is warned about once.
2. A component, relation or limit fact left with no evidence is dropped:
   `Dropped "<id>": no evidence left`.
3. What depended on a dropped component is dropped too: a relation to it, a
   mechanism within it, a limit on it. One warning each:
   `Dropped "<id>": its component "<c>" was dropped`.

A component fact's `files` are its evidence files, each once, in order, at
most 20. Its `items` are `[]`, since mechanisms are facts. An answer with no
component fact left fails the run with
`The read found no fact the code supports. Nothing was written.`

## Story answers (story intent)

Every story call answers this one schema exactly: a post, the overview of a
first drawing, and the LinkedIn, README and presentation channels. Every
property is required and there are no others. It carries no pixels, forms or
document fields:

```json
{ "title": "", "lede": "",
  "zones": [{ "id": "", "label": "" }],
  "parts": [{ "id": "", "label": "", "sub": "", "kind": "service", "chips": [""],
              "zone": null, "inside": null, "spine": 0, "anchor": null, "side": null,
              "facts": [], "held": [], "limits": [] }],
  "edges": [{ "from": "", "to": "", "label": "", "style": "call", "step": 1 }],
  "steps": [{ "parts": [""], "text": "", "note": "" }] }
```

- `kind` is one of the ten kinds; `style` is call, async or dep.
- `zone`, `inside` and `anchor` are a string or null; `spine` and `step` an
  integer or null; `side` `"above"`, `"below"` or null.
- `facts` names component facts, `held` mechanism facts, `limits` limit facts.

**Problems and the repair turn** (ADR 0009). Code checks a story answer for
every relation below and every hard limit below at once, and lists each
problem it finds. An answer that does not match the schema's shape (*Story
answers* above) fails the run at once, and gets no repair turn. With none, the answer is converted. With any, the engine
gets one more call, the *repair turn*: the same schema, and a prompt holding
its answer and the list, both quoted as data. Claude Code gets no tool; Codex,
which has no tool-free mode, stays in its read-only sandbox and is told to
read nothing. A revise's story answer gets it too, with no image. Its answer
replaces the first and is checked again in full; there is never a second
repair turn. The repair turn is one more call within the run's one deadline,
with no time added, and cancel stops it as any call. It adds no warning: the
engine wrote the answer.

After the repair turn, the second answer:

- fails the run, and nothing is saved, when it violates any relation, whether
  or not the first answer did:
  `The engine's <overview | LinkedIn post | README drawing | presentation>
  cannot be drawn: <every violation, joined by "; ">`;
- otherwise has every hard limit still over repaired as the hard limits below
  say.

A relation is never repaired by code: a part over the 60 fails the run here,
while the repair of a full-drawing answer cuts it with a warning, because
cutting a part of a story would break the spine, zones and holders the story
built around it.

**Relations.**

- Zone ids are unique, and so are part ids. A part's zone exists.
- A part's `inside` names another part, never itself or one inside it.
  Zones and holders together nest at most three levels. A part inside another
  takes no zone of its own: its zone is the holder's.
- Within each zone, holder or top level, a spine part has a unique
  non-negative `spine` and null `anchor`/`side`. A side part has null `spine`,
  a `side`, and as `anchor` a spine part of the same level.
- A zone's spine parts are consecutive on the spine and its side parts'
  anchors are inside it, or it holds only side parts of one anchor.
- Connections join two parts, never a part to itself.
- There is at least one part, and parts and zones together are at most 60.

A step's parts are not a relation: a wrong one is dropped with a warning
(see the presentation's row below).

**Hard limits.** The prompt states each one, from the constants code checks
with. The schema gives each text field its limit as `maxLength`, except in the
schema written for Codex, which would cut a text at the limit with no `…` and
no warning (ADR 0009). A text over its limit after the repair
turn is shortened to the limit, ending with `…`: `Shortened <what> to <n>
characters`, one warning per text. `<what>` is `the title`, `the description`,
`the label of zone "<id>"`, `the label of "<id>"`, `the sub-line of "<id>"`,
`a chip of "<id>"`, `the label of <from> → <to>`, `the text of step <i>` or
`the note of step <i>` (ids as the answer gave them, steps counted from 1).

- title 120 chars; lede 240;
- zone and part labels 48, sub-lines 60;
- chips 44 each, except a holder's, which are dropped (below) and never
  checked or shortened;
- connection labels 40;
- in the presentation, step texts 120, notes 1000.

These are problems for the repair turn too, and are then repaired so:

- an empty title: the drawing's title, `The <channel> has no title, kept
  "<title>"`;
- in the presentation, a step with an empty text is dropped, `Step <i> has no
  text and was dropped`, one warning per step, and it then gets no warning for
  its parts;
- in the presentation, more than 20 steps keep the first 20, `Kept the first
  20 of the <n> steps`, one warning for the cut.

More than 12 chips is no problem: the rows (held, chips, limits) are cut to
12 in the conversion below.

**Briefs and targets per channel.** Each story call has its own brief
(`src/server/engines/prompt.ts`). The checks in the last column are what code
does.

| Channel | Brief | Code checks |
|---|---|---|
| overview | The complete map: every fact shown or held. A one-line sub-line on every part. Merged parts where many facts are alike. Zones as the system's real boundaries. Every mechanism held by its part; limits where they explain a part. No count target, within the 60 parts a view holds, each zone counted as a part | Every fact drawn (below) |
| linkedin | One image for a phone: about 8–12 parts. A title of at most 9 words and one plain sentence. No held items or limits, no tuning numbers | The post targets below. A non-empty `held`, `limits` or `steps` is dropped, one warning each |
| readme | A detailed drawing that renders on GitHub. A one-line sub-line on every part, the default description. Held mechanisms only on a part whose working the story is about; elsewhere none. Limits where they explain a guarantee | — |
| presentation | One drawing and 3–8 ordered steps that tell it. A one-line sub-line on every part; held mechanisms as in the README. Each step highlights the parts it is about, says it on screen in one short sentence, and gives the speaker one to three sentences | Each step's parts exist. A wrong one is dropped with one warning; a step none of whose parts exist is dropped instead, with one warning |

A non-empty `steps` outside the presentation is ignored, with one warning.

No brief asks for panels or rows (LOOK-3): a prompt names `held`, `limits`
and `chips` as what a part holds, listed in its callout, never as rows drawn
on the part. The post brief asks for `chips: []` on every part; chips it
still gives are converted as below.

**Post targets** (LinkedIn only) are kept whole, with one warning each:

- title 9 words, lede 140 chars;
- label and sub-line 28, chip 22;
- side-connection label 2 words;
- a numbered connection with a label is kept and warned about.

**Conversion** into the channel's one view (for the overview, its first
view):

- **Zones** become group parts (`zone-<id>`) with no facts. Each takes its
  zone's label, kind `service` and description `A group of components.`
  A zone id that already starts with `zone-`, or that a group of the view
  being redrawn already has, is kept as it is, so a redraw that echoes the
  current view keeps its groups.
- **Holders:** a part that another part is `inside` becomes a group showing
  its own facts. `zone` and `inside` become `parent`; `spine`, `anchor` and
  `side` become `lane`. A holder draws no chips: its chips are dropped,
  `"<id>" holds parts, so it draws no chips`, one warning.
- **Forms:** a part with chips, held mechanisms or limits becomes a panel,
  any other part a card. Chips become its own items.
- **Facts.** Each step below drops with one warning per id:
  - `facts` keeps only existing component facts, lists each once, and drops
    a fact an earlier part already shows or holds;
  - `held` keeps only mechanisms within the part's facts, and drops one an
    earlier part already holds or shows;
  - `limits` keeps only limits on its facts or held mechanisms.

  The rows (held, chips, limits) are then cut to 12, with one warning.
- **Text.** A part showing exactly one fact keeps a label, sub-line or kind
  as its own only where it differs from the fact's. Any other part gives its
  own label and kind. Its description is its first fact's, else its
  sub-line, else its label.
- **Part ids** are unique in the channel. An invalid id is sanitised, with one
  warning. A taken one is suffixed `-2` without a warning, since the intent's
  ids only tie the intent together.
- **Connections.**
  - Between two parts that each show one fact, a connection shows the
    relation joining those facts, if there is one; its ends are swapped when
    the relation runs the other way. It keeps its label and style as its own
    only where they differ.
  - Connection ids are `<from>-<to>`.
  - Each of these adds one warning: a reverse pair becomes one two-way
    connection, keeping the first label (else the second) and the earlier
    step; a same-direction duplicate is dropped; steps are renumbered 1, 2,
    3 …
- **Steps:** the presentation's steps become the channel's `steps`, with ids
  `s1`, `s2`, …, their part ids mapped as the parts' were.

**The view.**

- Its id is kept when the channel already has a view. Otherwise it is the
  channel's name (`linkedin`, `readme`, `presentation`; for the overview,
  `overview`), or `<name>-2`, `-3`, … when another view has that id.
- Its title is `LinkedIn`, `README`, `Presentation` or `Overview`, and its
  caption is the intent's title and lede. It has no texts.
- It is laid out by its lanes: portrait for the LinkedIn feed format, wide
  otherwise.
- It replaces the channel's view; for the overview, the whole channel, and
  only for a first drawing. The channel's `outdated` is emptied. The facts and
  every other channel stay unchanged.

**Every fact drawn (overview).** Code fills in what the overview story left
out, one warning each:

- A component fact it neither shows nor holds is added as a card of its own
  at a free spot. It goes inside the zone or holder of the part it has the
  most relations with: `Added "<id>", which the overview left out`.
- When those cards would take the view past 60 parts (rule 15), the facts that
  do not fit are drawn in one part, `more-components` (`More components`); when
  the story already drew 60 parts, in its last part that holds no parts. One
  warning: `Drew the <n> facts the overview left out beyond its 60
  parts in one part "<id>"`.
- A relation between two parts that each show one fact, which no connection
  shows, is added as a connection.

The result must pass validation before it is saved.

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
