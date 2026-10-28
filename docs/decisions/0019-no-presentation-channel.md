---
id: 0019
title: "No presentation channel: three channels, no presenting, no tour, no slide downloads"
date: 2026-10-28
status: accepted
deciders: [brkakyldz]
supersedes: ["0012"]
---

Supersedes ADR 0012 whole, and the parts of ADR 0001 that name a
step-by-step **presentation** as a channel and a **guided tour** as a side
job. Everything else in ADR 0001 stands. The ADRs that list the presentation
among the channels (ADR 0002, ADR 0006, ADR 0007, ADR 0008, ADR 0009,
ADR 0014) are read without it.

## Context

The quality bar (QUAL-1: for an agent project, a backend/API service and a
full-stack application, each channel's output is shareable without hand
edits) is not met yet for any channel. The presentation is the largest
channel by far: its own story brief, ordered steps with an on-screen text and
a speaker note each, a steps panel, a full-screen presenter and a guided tour
on the same steps (ADR 0012), a PDF and a zip writer for the slide downloads,
and about 50 held-out scenarios. Every change to the drawing file, the story
pipeline or the editor carries it (issue #209).

## Decision

Exact shapes are in `docs/contracts/` (diagram, api, ui, cli, testing). The
owner took the recommended option, (a), of each of the three questions of
issue #209 on 2026-10-28.

1. **Three channels.** A drawing has the overview, LinkedIn and README
   channels. A draw is made for LinkedIn or README (STORY-1): the home screen
   offers two destinations and the editor three tabs. The presentation's
   story brief (STORY-4), its steps (`steps`, their rule and limits) and
   their editor, presenting (PRES-1) and the slide downloads as PDF and PNG
   (PRES-3) go.
   Numbered connections stay in every channel: `showSteps` and a
   connection's `step` are not the presentation's steps.
2. **Files keep `archdraw/diagram@4`** (#209 question 1). A file that holds
   a `presentation` channel is read with that channel dropped and exactly
   one warning, `The presentation channel was removed`, and is written back
   without it (drawing contract, *Reading a `presentation` channel*). A
   presentation channel with no view drew nothing, so dropping it adds no
   warning (AGENTS.md invariant 6).
3. **The tour goes too** (#209 question 2; PRES-2). Its steps came from the
   presentation.
4. **The `slide` size stays** (#209 question 3). Share keeps the
   1920 × 1080 image (SHARE-1) as a plain image size. Only ADR 0012's slide
   image, with its dimmed parts and its band holding a step's text, goes with
   the presenter and the downloads.

## Rationale

The work goes where the bar is closest to being met: a LinkedIn image and a
README drawing are what most users share, and neither is shareable without
hand edits yet. Removing the presentation takes a brief, an editor panel, a
presenter, a tour and two writers out of every change made to reach that bar.

Keeping `@4` costs one reading rule. A new `@5` would cost a converter and a
format change in the plugin skill for a shape that only lost a key. The
tour fed by the README's numbered connections instead would be new work, not
a removal, and gets its own issue if it is wanted. The `slide` share size is
one entry in a table of sizes and costs nothing to keep; a 16:9 image still
serves a slide the user makes elsewhere.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Keep the presentation and improve it later | Every change to the pipeline and the editor keeps carrying the largest channel while no channel meets the bar |
| (#209 1b) A new format `archdraw/diagram@5` | A converter and a format change for a shape that only lost a key |
| (#209 2b) Keep the tour, fed by the README's numbered connections | New work, not a removal |
| (#209 3b) Drop the `slide` share size too | It costs nothing to keep |

## Consequences

- **Upside:** one brief, one editor panel, the presenter, the tour and two
  writers fewer; the work stays on LinkedIn and README.
- **Cost:**
  - a user who presented from Archdrawer shares a `slide`-sized image
    instead, with no steps, notes or presenter;
  - a file's presentation, its steps and speaker notes included, is lost the
    first time the file is read; the warning says so;
  - the held-out scenarios about the presentation, presenting, the tour and
    the slide downloads are retired or revised by their author (#209).
- **Cost to reverse:** medium. The channel, its steps and ADR 0012's
  presenter, tour and writers come back from git history, and the format
  gains its fourth channel key again; files read in between have lost their
  presentation.
