---
id: 0013
title: "Calm connections and a steady drag: neutral lines, a trace over parts, a halo for group names, marked hubs, sides held only while dragging"
date: 2026-10-22
status: accepted
deciders: [brkakyldz]
supersedes: []
---

Amends ADR 0011: decision 2's clip is superseded by a halo; decisions 1, 3, 4
and 5 stand.

## Context

ADR 0011 made every connection one cubic that passes behind what it meets,
and cut group names out of the connection layer with a clip. On this
repository's own overview (19 parts, 24 connections, 8 kinds) the result
reads as a tangle:

- Every connection is a gradient between its two parts' kind colours, so no
  line stands out, and every one-way line starts with a ring.
- A line into a group's first-row member stops at the group's frame and is
  missing across the whole header band: the clip removes it there, and a
  member narrower than the name leaves no room to move its port (#176).
- A line behind a part disappears and comes out somewhere else.
- A part four or more parts use (a shared core, the database) draws a line
  from each; in a trial, hiding those lines and marking the part cut the
  layout report's crossings from 8 to 3 on this overview and from 23 to 7 on
  the hotel overview (#186).
- `chooseSides` ignores how busy a side is; every handle is at least 24 px,
  so close parts get hooks; lines arriving at one side from one direction
  cross just before they arrive.
- While dragging, sides flip at a hard threshold, every label in the drawing
  is placed again on each move, group frames move under the pointer, a drop
  can cover another part, and the grid layout never reorders parts to cut
  crossings.

## Decision

1. **Neutral lines, colour on focus.** Connections are drawn in one neutral
   colour. They take their kind colours in the editor while in focus (a
   hovered or selected part's lines, a selected or hovered line or label, a
   dragged part's lines, the current step, search matches). Exports are
   neutral too, except numbered (step) connections, which keep their colour
   everywhere. The start ring of a one-way connection is removed. Dotted
   lines get a little more weight and a longer dash.
2. **A trace over the part.** A line still passes behind a part it meets
   (ADR 0011, decision 2, for parts). Over that part a faint trace of the same
   curve is drawn, under the part's text, in the editor and every export.
3. **A halo for a group's name** (supersedes ADR 0011 decision 2's clip).
   Lines are drawn over a group's header band. The group's icon, name and
   sub-line are drawn over the connections, and the name and sub-line carry
   a tight text halo in the header's colour, so a crossing line is broken
   only by the glyphs. Nothing is cut out of a line. Top ports keep their
   rule.
4. **A part many parts use is marked.** A part four or more parts use has
   the lines from them hidden, unless numbered, and carries a `used by N`
   mark; they show on hover or selection in the editor. The facts are
   unchanged.
5. **Sides count their load; short gaps get short handles; trunks.** A
   side's cost counts the angle to the other end and the ends it already
   holds. A handle between facing sides is never longer than their gap.
   Lines arriving at one side from one direction share a trunk.
6. **Held sides only while a pointer is down.** During a drag the editor may
   keep a connection's previous sides until another pair is clearly
   cheaper, and glide an end that moves. On release every route is the
   stateless one the export draws, so every stored state, every export and
   the layout report stay stateless (AGENTS.md invariant 5).
7. **A drag moves only what it moves.** Other labels, badges and group frames
   hold during a drag; guides and the 8 px snap apply during it, so release
   changes nothing; a drop that would cover another part takes the nearest
   free spot; the drag is saved once.
8. **Fewer crossings in the layout.** After cells are assigned, barycentre
   sweeps reorder parts within rows and columns, keeping the main path's order
   and every `place` hint; empty rows and columns are closed. Only parts
   without a stored position move, as LAYOUT-2 already says for widening, and
   the result is kept only when the layout report's crossings do not go up.

The numbers are in `docs/contracts/diagram.md` (*Connections*, *Layout*) and
`docs/contracts/ui.md` (*Connections in focus*, *Dragging*). The owner took
the recommended option of every question in issue #162 on 2026-10-22.

## Rationale

A drawing reads by its parts and its main path. Colour on every line spends
the eye on all of them at once; colour only on the path and on what the
reader points at leaves the rest legible and still there. Keeping numbered
lines coloured in exports keeps the story's path visible in an image where
nobody can hover.

The clip made a correct rule look like a broken drawing: behind a part a line
is covered by a filled box, behind a name only by empty header. A halo hides
the line only where the letters are, which is all that readability needs.

Hiding the lines into a hub removes the crossings they cause without
touching the facts, and the mark says the lines exist.

Hysteresis is what makes a drag feel steady, but a held state in a stored
route would let the editor and the export disagree for the same file.
Limiting it to the time a pointer is down keeps every stored route a pure
function of the view.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Keep the clip and move a top port right of the name always | A member narrower than its group's name has no room; the line still breaks |
| Draw lines under the whole group frame | Lines between members inside a group would vanish under its fill |
| Colour connections by kind in exports too | The same tangle in the image people share, where nobody can hover |
| Bundle the lines into a hub instead of hiding them | Still one line per user near the hub, and the bundles add their own crossings |
| Store a connection's sides in the file | A new field the engine and the CLI must keep; the export would depend on drag history |
| Move parts with a stored position to cut crossings | The user's placement is theirs; the layout owns only what it placed |
| A drop onto a part is refused, or swaps the parts | A refused drop loses the gesture; a swap moves a part the user did not touch |

## Consequences

- **Upside:** calmer drawings with a visible path; no line looks broken at a
  group's name; fewer crossings in automatic layouts and around hubs; a drag
  that only moves what it moves and saves once.
- **Cost:** two layers per group in the editor and the export (frame, head),
  a second routing pass for hidden lines, trunk geometry, the guide matcher
  and the drop rule in the editor. The held-out scenarios on names cut out of
  lines, edge colours and drag behaviour are re-authored.
- **Cost to reverse:** medium. Nothing in the file format changes; the look
  and the routing do.
