---
id: 0006
title: "archdraw/diagram@3: a facts list, four fixed channels, parts that point to facts"
date: 2026-10-21
status: accepted (extended by 0007: evidence, mechanisms, limits, one README and one presentation view; amended by 0014: held mechanisms are listed in the callout, not drawn as rows; extended by 0015: several choices per file, format 4)
deciders: [brkakyldz]
supersedes: []
---

Amended by ADR 0014: the overview still holds every fact, but a held
mechanism is listed in its part's callout, not drawn as a row.

## Context

ADR 0003 decides that one file holds the facts and a drawing per channel, and
that appearance edits stay in their channel while content edits change the
facts. It does not fix the shape. In `archdraw/diagram@2` every component
belongs to exactly one view and carries its content (label, description,
files) next to its layout (position, form, lane). A part drawn in two views is
two objects tied together only by `from`, and a LinkedIn post is a view with
`postOf`.

## Decision

The file format becomes `archdraw/diagram@3` (exact shape in
`docs/contracts/diagram.md`).

- **Facts** are what is true about the system. A *component fact* has id,
  label, kind, sub-line, description, files and held items. A *relation fact*
  has from, to, label, style and two-way. Facts carry no layout.
- **Channels** are fixed: `overview`, `linkedin`, `readme`, `presentation`.
  Only the overview has several views (the map with detail views, NAV-1). Each
  of the others holds at most one; in this format version README and
  presentation hold none (they come in 0.3).
- **Parts** are what a channel draws. A part points to the facts it shows
  (`facts`: one, several for a merged part, none for a frame the story adds)
  and owns form, icon, position, `place`, `lane`, `parent` and `detail`.
  Group membership is a channel choice, so a LinkedIn post can fold a group
  that the overview keeps. A **connection** points to the relation facts it
  shows and owns its step.
- **A part may keep its own text.** `label`, `kind`, `sub`, `description` and
  `items` on a part are null (taken from its fact) or its own value; a
  connection's `label`, `style` and `both` likewise. A part with zero or
  several facts must give its own label, kind and description. Renaming in
  the overview corrects the fact; renaming a part elsewhere gives it that
  channel's own shorter name. Kind, description, items and files are edited
  in the facts from any channel.
- **The overview is the complete map.** Every component fact is drawn by at
  least one part of the overview channel. Adding a part anywhere adds a fact,
  and outside the overview it also adds a part to the overview's first view.
  Deleting a part in the overview deletes the facts no other overview part
  shows; deleting a part in another channel only leaves it out of that
  channel. Simplify becomes an appearance change of the overview, and its
  coverage rule is "every fact is still drawn".
- **"Needs update" is a list.** Each channel keeps `outdated`: the ids of the
  facts changed since it was drawn that it has not taken up. A new fact, a
  removed fact it drew, a new or removed relation between facts it draws, and
  a change to a fact or relation it does not show directly (its part keeps its
  own text, or merges several facts) add the id. A change it does show
  directly, such as a rename shown through the fact, adds nothing. The
  channels the change was made in are never marked. Redrawing a channel, or
  "Keep as it is", empties the list.
- **`@2` files keep opening.** A `diagram@2` file is converted on read with
  one warning (plus one per change of meaning) and written back as `@3`;
  `archdrawer migrate` does the same. `@1` still needs `migrate` and converts
  through `@2`.
- `theme` stays on the document; `showSteps` moves into each channel;
  `postOf`, `from` and the `-linkedin` id rule go away; a request names its
  channel and view.

Rendering does not change: layout, geometry and export draw a channel view
joined with its facts, in today's view shape, so the editor and the export
keep sharing one set of numbers (AGENTS.md invariant 5).

The owner settled the open questions of issue #25 on 2026-10-21 by accepting
the options recommended there (overview edits change facts, other channels
only themselves; a part may keep its own text; `@2` converted on read;
`outdated` as a list of fact ids).

## Rationale

Pointing parts at facts makes a correction show everywhere at once without a
redraw, so "needs update" is left for what a redraw is really needed for: a
fact the channel does not show yet, or a text the channel chose to tell its
own way. Keeping the overview complete gives the map and simplify one rule
and means a fact can never exist that no drawing shows. Converting `@2` on
read keeps the plugin skill and every existing file working while they move.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Facts with a revision number, channels storing the revision they were drawn from | A rename and a new fact both move the revision; the mark cannot tell which needs a redraw |
| A boolean "needs update" per channel | Says nothing about what changed, so a redraw or the tab cannot show it |
| Parts never keep their own text | LinkedIn needs shorter names than the README, and a merged part has no single fact to take a name from |
| Deleting a part anywhere deletes its fact | A post could never leave out a part without losing it from the map |
| Facts allowed outside every drawing | A fact nobody sees cannot be checked or corrected |
| `@2` only through `archdrawer migrate`, like `@1` | Breaks the plugin skill and every helper that writes `@2` until each moves |

## Consequences

- **Upside:** one rename fixes every channel; posts and overviews lay out
  independently; simplify cannot lose a fact.
- **Cost:** every edit and every run answer is split into a facts part and a
  channel part (`src/core`); a part's drawn content is a join; conversion code
  for `@2` stays until `@2` files are gone.
- **Cost to reverse:** high — a new file format.
