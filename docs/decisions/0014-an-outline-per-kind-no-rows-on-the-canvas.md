---
id: 0014
title: "An outline per kind, no rows on the canvas, a sub-line that can be switched off"
date: 2026-10-22
status: accepted
deciders: [brkakyldz]
supersedes: []
---

Supersedes ADR 0008's decisions *Shapes follow the kind, not a new field*
(in part: the outlines and the fixed box) and *Held items only where needed*
(in part: rows drawn in a part), and amends ADR 0006: the overview still
holds every fact, but a held mechanism is listed in its part's callout, not
drawn as a row. ADR 0008's other decisions stand.

## Context

ADR 0008 gave five kinds their own outline, drawn inside the box a plain card
has, and kept held mechanisms, shown items and limits as rows of a `panel`.
In practice most parts of a story are panels, and a panel always draws the
plain rounded rectangle, so the five shapes are rarely seen and the other
five kinds have none. A drawing reads as a wall of same-looking boxes full of
small text. The rows also set most of a drawing's size and its smallest
text, which is what the readability check most often complains about.

## Decision

Exact shapes are in `docs/contracts/diagram.md` (*Geometry*, *View*) and
`docs/contracts/ui.md` (*Callout*, *Share*).

- **Every kind has its own outline**, in cards and in compact parts:
  `person`, `window`, `port`, `card`, `stack`, `agent`, `external`, `pulse`,
  `check`, `store` (`data-shape`). The kind alone still gives the shape;
  there is no shape field. Silhouettes follow ones the common notations
  already share where one exists (Structurizr's
  [shape list](https://docs.structurizr.com/dsl/language),
  [D2 shapes](https://d2lang.com/tour/shapes/),
  [Mermaid flowchart shapes](https://mermaid.js.org/syntax/flowchart.html)).
- **A shape has a content box, and the part is sized to it.** The icon,
  label and sub-line stay inside the content box, and `measureNode` sizes the
  part so the box holds them: a shield, a cylinder, a cloud top or a stack may
  make a part taller or wider than a plain card. The first `rect.box` is still
  the part's box; rings stay box-shaped; connections take their sides on the
  box. The editor and every export still draw from one set of numbers
  (AGENTS.md invariant 5).
- **No rows on the canvas.** No part draws held mechanisms, items or limits,
  on the canvas or in any export. They stay in the file and in the facts, and
  the part's callout lists them. A `panel` is drawn exactly like a `card` of
  its kind; the form stays, as the part that holds rows. The overview still
  holds every mechanism (ADR 0006: every fact is drawn or held); the README
  and the presentation still hold one only where the story is about how that
  part works. Story briefs stop asking for rows.
- **The sub-line can be switched off.** One line under the label stays the
  default summary. A view stores an optional `subLines` switch (absent means
  on), so older files stay valid and the format stays `archdraw/diagram@3`.
  With it off, cards shrink to icon and label. The share image follows the
  view, and its own `show-sub` switch can override it; `show-items` goes.
- **Colours come from the theme.** Kind colours and the existing tokens, in
  light and dark; the one new colour is the AI agent gradient's end.

The owner took the recommended option of every question in issue #162 on
2026-10-22, with the shape table and mockups of issue #177 as drawn.

## Rationale

A distinct outline per kind lets a reader tell a store from a service from a
check at a glance, which is the job labels and colours were doing alone.
Rows were the one thing keeping most parts on the plain outline and most
drawings large; listing them in the callout keeps the information one click
away and leaves the drawing to show structure.

Letting a shape change a part's size reverses ADR 0008's "inside the box a
plain card has". It costs a layout change, but squeezing a shield or a
cylinder into a card's box leaves text on the outline. Because the size is
still a function of content through one `measureNode`, the parity checks
stay as they are.

Keeping `panel` and the row fields leaves every file valid and every edit
rule of ADR 0006 and ADR 0007 intact: only the drawing changes.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Keep rows and draw the kind's outline around a panel | A tall shield or cylinder with rows inside wastes room and keeps the small text |
| Remove `panel`, `held` and `limits` from the format | A new format version for what is only a change of drawing; the overview would lose where mechanisms are held |
| Shapes inside the plain card's box (ADR 0008) | Text sits on the shield's point, the cylinder's lid or the avatar |
| A per-part sub-line switch | More state for no use seen; a view-wide switch is what a LinkedIn image or a slide needs |
| A `shape` field | Duplicates the kind, as ADR 0008 found |

## Consequences

- **Upside:** drawings whose kinds read at a glance, smaller drawings with
  larger smallest text, and a one-switch way to a labels-only image.
- **Cost:** ten outlines with content boxes and post-style numbers, a
  callout that becomes the only place rows show, one optional view field, and
  share toggles that change. The held-out scenarios on shapes, rows and
  `show-items` are re-authored.
- **Cost to reverse:** medium. Rows could be drawn again from the same file;
  the sizes and layouts drawn meanwhile would move.
