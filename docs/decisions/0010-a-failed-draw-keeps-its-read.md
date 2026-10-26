---
id: 0010
title: "A failed draw keeps its read in memory, and Try again starts where it stopped"
date: 2026-10-22
status: accepted (extended by 0015: kept per choice; extended by 0016: kept for a choice that failed in a draw that wrote its file)
deciders: [brkakyldz]
supersedes: []
---

## Context

A draw is three engine calls: the read, the overview story and the channel
story (api contract, *The draw run*). The file is written only after the
third. A failure at the second or third — a story error, a timeout, an engine
that exits — discarded the read, which is the longest call and the one that
costs the most of the user's subscription. `Try again` read the repository
again (#85).

ADR 0009 makes a story answer's overrun rare as a cause, but an engine that
exits or a run that times out still fails a later stage.

## Decision

Exact shapes are in the api contract (*What a failed draw keeps*) and the
testing contract (`[fixture:flaky:<stage>]`).

- A draw that ends without a drawing after its read answer was checked —
  failed, cancelled or timed out — keeps the read answer and, when the
  overview was converted, the drawing with its overview. They stay in the
  server's memory only; nothing is written.
- A later draw with the same scan, focus, engine and model starts from the
  first stage that did not finish. The channel may differ: the facts and the
  overview do not depend on it. A new scan, another focus or another engine
  reads again.
- The kept read answer goes through the repair and the evidence check again,
  against the folder as it is then, with no engine call: a fact whose file
  went since is dropped as on a first read. The kept overview is used only
  when the facts came out of that check unchanged; otherwise it is drawn
  again.
- Progress says what was reused, in the stage it stands for, so the draw's
  stage list still goes `read`, `overview`, `channel`, and the warnings are
  those one draw that never failed would have.
- Each folder keeps at most one entry, replaced by the folder's next draw
  that ends without a drawing and removed by one that succeeds. It goes one
  hour after the draw that left it (as a finished run), or when the server
  stops.

## Alternatives considered

| Option | Why not |
|---|---|
| Save the drawing with its overview only when the channel stage fails, and say the channel could not be drawn | Writes a file the user did not ask for, half of what they chose; a failed draw would no longer write nothing (START-4), and a failure at the overview stage still loses the read |
| Keep the read on disk, under the data folder | Survives a restart, but leaves a file of repository facts behind every failure, the same kind of leftover the revise folder needs start-up clean-up for; a restart is rare next to `Try again` |
| Reuse the checked facts without checking them again | The folder may change within the hour without a new scan; a fact whose file is gone would be drawn (the *Unchecked evidence* failure), and the check costs no engine call |
| Keep failing the whole draw | The user pays for the longest call again for a fault in a later one |

## Consequences

- **Upside:** `Try again` after a failed overview or channel stage costs one
  or two calls instead of three to five, and is that much faster.
- **Cost:** the run manager holds one kept read per folder, at most an hour;
  the evidence check runs again on reuse; the fixture engine gets two
  markers that fail a call once per server process.
- **Cost to reverse:** low — memory only, and the file format does not change.
