---
id: 0003
title: One file holds the facts and a drawing per channel; edits go where they belong
date: 2026-10-19
status: accepted
deciders: [brkakyldz]
supersedes: []
---

## Context

With the staged pipeline (ADR 0002) there is no longer one drawing: there is a
facts list and, on top of it, a drawing per channel. A user edit in one channel
must have a defined effect on the others.

## Decision

- One file in the user's repository holds the facts list and every channel's
  drawing, as today's single drawing file does.
- **Appearance edits** (moving, resizing, hiding a part in a channel) change
  only that channel's drawing.
- **Content edits** (a wrong description, a renamed component, a new
  connection) change the facts; other channels show a small "needs update"
  mark until they are redrawn or accepted.

## Rationale

A fact corrected once must not stay wrong in two other images, while a layout
tuned for a phone screen must not disturb the README. One file keeps the
drawing reviewable in git and easy to share.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Every channel fully independent | The same mistake must be fixed three times |
| Everything shared | Channels have different layouts; a move in one breaks another |
| Separate files per channel | Tidier, but scattered in the repository and harder to keep consistent |

## Consequences

- **Upside:** corrections propagate; layouts stay independent.
- **Cost:** a new file format and a migration of existing drawing files; every
  edit must be classified as appearance or content.
- **Cost to reverse:** high.
