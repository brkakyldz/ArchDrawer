---
id: 0015
title: "Choices: tick sections and flows, one file holds them all (format 4), the whole system is a map"
date: 2026-10-22
status: accepted
deciders: [brkakyldz]
supersedes: []
---

## Context

ADR 0007 gives a draw one focus and one channel, and briefs the overview as
"complete, with no caps". The scan offers 3–5 options of three kinds (`flow`,
`mechanism`, `overview`), and the home screen takes one of them, the whole
system or a typed focus, as a radio. ADR 0006 holds one facts list per file.

On a real repository that gives one crowded picture: the hotel overview drew
19 parts and 32 connections. Users want to pick the slices they care about —
the back-end, the front-end, one workflow — and see the whole system as a
short map they can open up. The way between views is a small icon beside the
crumbs (`views-button`) that users do not find, and a part's inside opens
only through its callout or a small mark.

This ADR supersedes ADR 0007 **in part**: its one focus per draw, its scan
option kinds and count, its "The format stays `archdraw/diagram@3`", and its
overview brief "complete, with no caps" for the whole system. Everything else
in ADR 0007 stands. It extends ADR 0006 (the file holds several choices) and
ADR 0010 (what a failed draw keeps, per choice), and raises ADR 0002's 3–5
suggestions to 3–8.

## Decision

Exact shapes are in `docs/contracts/` (api, diagram, ui, testing, cli). The owner
took the recommended option, (a), of each of the seven questions of issue
#178 on 2026-10-22.

1. **Option kinds.** The scan offers two kinds: `section`, a layer or part of
   the system (the back-end, the front-end, an API layer), and `flow`, a
   workflow. `mechanism` folds into `section`; `overview` goes, since "The
   whole system" is always offered. An unknown kind becomes `flow`, with one
   warning.
2. **How many options.** 3–8, so a larger project can offer both its sections
   and its flows. Options over 8 are cut, one warning each. Fewer than three
   is still a success.
3. **Where several choices live.** One drawing file holds every choice
   (`archdraw/diagram@4`). A **choice** has an id, a title, a kind (`system`,
   `section`, `flow` or `custom`, the last for "Something else"), its own
   facts and its own four channels. Format 3 files open as one `system`
   choice and are written back as format 4 with nothing lost. Validation,
   normalisation, edits and exports work per choice: an edit never changes
   another choice. A draw always writes a new file; adding a choice to an
   existing drawing is not part of this decision.
4. **Reads.** One `draw` run takes a list of choices and the one channel the
   user chose, and draws each choice in the order given: its read, its
   overview, its channel. A choice that fails or is cancelled keeps the
   choices that finished, in memory, as ADR 0010 keeps a read: nothing is
   written until every choice is drawn, and `Try again` starts from the first
   choice that did not finish. `succeeded` implies a readable file holding
   every choice of the request.
5. **Clicking a group on the map.** A part with an inside (`detail`) shows a
   visible open mark, the same in the editor and the export. A click on it
   without movement goes into its inside; a drag moves it; Enter on it goes
   in.
6. **Moving between views.** A views panel beside the canvas lists the whole
   system, each section and each flow, with their detail views under them,
   and marks the current one; one click goes to any of them. The crumbs stay.
   `views-button` and `views-menu` are removed. Below 900 px the panel folds
   into the header menu.
7. **The whole-system map's size.** The overview of the `system` choice is a
   map of about 5–9 top-level parts; every other component is inside one of
   them, in a detail view the draw writes at once. The completeness rule
   moves from one view to the channel: the map and its detail views together
   show or hold every component fact. The 5–9 is a brief and a layout-report
   target, not a cap code enforces. A section, flow or custom choice keeps
   ADR 0007's overview brief: a slice is small enough to be told complete in
   one view.

## Rationale

One file per drawing keeps what ADR 0003 bought: one thing in git, opened,
shared and followed for outside changes as today. Choices in one file can
link to each other and move together, and the views panel can list them
without a library lookup. Keeping a choice's facts and channels exactly in
format 3's shape makes the format 3 → 4 conversion a wrapper, so no file loses
anything and the editor, layout and exports keep their per-channel code.

One read per choice keeps each read focused, within the size the read was
built for, and lets a failure cost only the choice it hit. Keeping finished
choices in memory, not writing a partial file, keeps "a draw that fails
writes nothing" (START-6) and "a succeeded run has its file" both true.

A map with a few groups is what fits one image; the detail views keep every
component one click away, so nothing the read found is lost. Splitting the
story's own groups into detail views in code needs no change to the story
schema every channel shares.

## Alternatives considered

| Alternative | Why not |
|---|---|
| (1b) Keep `mechanism` as a third kind | Users name slices by layer or workflow; a mechanism is a part of a section |
| (2b) 3–5 options as today | Too few for a project with both its sections and its flows |
| (3b) One file per choice, no format change, the library groups them by repository | The map and its choices could not link to each other; several files to keep in step and to share |
| (4b) One read of all choices together | One longer read for several slices; a failure loses all of them |
| (5b) Clicking a group expands it in place | The image grows on the canvas and the export differs from the map |
| (6b) Tabs along the top, one per choice | Tabs already show the channels; detail views would not fit under them |
| (7b) No cap on the map, as today | The crowded picture this change is for |
| Write a file with the finished choices when a later one fails | A failed run would write a drawing; `Try again` would then have to add choices to a file the user may already have edited |

## Consequences

- **Upside:**
  - the user draws the slices they want in one run;
  - the whole system reads at a glance, with its detail one click away;
  - every view is in a panel users can see;
  - a failure costs only the choice it hit.
- **Cost:**
  - a new file format and a conversion from format 3 (`src/core`);
  - a draw makes three to five calls per choice, so a draw of several choices
    takes that much longer; each choice has its own deadline;
  - the run manager keeps a record per choice;
  - held-out scenarios naming the radios, the scan's option kinds, the
    `views-button` or the overview's one view change.
- **Cost to reverse:** high — a new file format, new run shapes and new
  prompts.
