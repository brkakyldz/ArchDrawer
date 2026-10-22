---
id: 0011
title: "Connections pass behind parts: one cubic each, never bent around anything"
date: 2026-10-22
status: accepted
deciders: [brkakyldz]
supersedes: []
---

## Context

Every connection whose plain curve met a part or a group's name was rerouted
by a search for the cheapest arc through one or two bend points around it,
polished by many trial curves, with a freely optimised fallback when none
fitted. The editor routes every connection again on each pointer move of a
drag. On this repository's own overview (19 parts, 24 connections) one
routing pass took 33–50 ms, with spikes near 100 ms, so dragging stuttered;
and lines bent and jumped around parts as they moved, which the owner found
unnatural and asked to have removed: connections should simply pass behind
parts.

## Decision

1. **One cubic per connection.** Facing sides, ports spread as before,
   handles along the sides' normals. No arc, no bend point, no chain, no
   fallback search.
2. **Behind, not around.** Connections are drawn under parts, so a curve
   that meets a part passes behind it. Group names are cut out of the
   connection layer with a clip, so a curve passes behind a group's name
   the same way, in the editor and every export.
3. **Reported, and room where the layout owns the position.** A curve
   behind a part is still listed in the layout report's `edgesOverParts`.
   For a part the layout placed, it widens the gaps beside it as before and
   takes the room back when that does not clear the curve; stored positions
   never move.
4. **One exception: a post's spine.** In a post, a line straight down or up
   that would be hidden behind the parts between its ends turns out on one
   side as a single cubic. A step of the story hidden end to end is not a
   look the post can afford, and the rule costs a few sampled curves.
5. **Labels stay on their line.** A label's box lies within 10 px of its
   curve, not its centre within half its width + 10 px.

## Consequences

- A routing pass on the same overview takes about 2 ms (7 ms at worst).
- Drawings with stored positions may show lines behind parts where an arc
  went around before; the layout report says so.
- The diagram contract's Connections section is rewritten; held-out
  scenarios written against the arc rule are re-run by their author.
