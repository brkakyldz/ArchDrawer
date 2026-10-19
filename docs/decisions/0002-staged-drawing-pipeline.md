---
id: 0002
title: A drawing is made in stages; the model decides content, code decides geometry
date: 2026-10-19
status: accepted
deciders: [brkakyldz]
supersedes: []
---

## Context

Today one engine call reads the repository, understands it, decides what to
tell and builds the whole drawing, under one long rulebook with hard caps
(4–6 zones, about 15 connections, no numbers). Asking for another format means
reading everything again. The caps pushed the inside of the important parts
into other views, and the model had little attention left for the story.

## Decision

A drawing is produced in stages:

1. **Scan** (about a minute): README, folder tree, dependency files, entry
   points. Output: a short repository card and 3–5 **focus** suggestions — a
   flow ("how an order is processed"), an inner mechanism ("the agent loop"),
   or the overview — each backed by files that exist. Cached per commit.
2. **Focus**, chosen by the user (or typed freely); then the **channel**.
   Focus comes first because it decides what is read; the channel can change
   later without reading again.
3. **Deep read** of the files the focus needs. Output: a **facts list** —
   components, the mechanisms inside them, who calls whom, limits — each with
   file evidence that code checks.
4. **Story design per channel**, from the facts only: LinkedIn sparse (about
   8–12 parts, no held items), README detailed, presentation as ordered steps
   that highlight parts with a short text. Held items are used only where a
   part needs them, never on every part. Numbers that explain a guarantee
   (a deadline, a turn limit) are allowed outside LinkedIn.
5. **Layout by code**: coordinates, routes and sizes, as today.
6. **Check**: the layout report always; a visual review round by the model
   only when the user asks for it.

The model decides what is drawn and roughly where (beside, above, below,
inside); code decides every pixel.

## Rationale

Separating "what is true" (stage 3) from "what is told" (stage 4) lets the
story be redone cheaply without risking correctness, and keeps the three
channels consistent. Models are weak at geometry, so placement stays in code,
where the editor and the export already share one measurement.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Keep one call, fix the rulebook | The call still does four jobs at once; every channel re-reads the repository |
| Separate scan, then one call for the rest | Keeps facts and story tangled; channel changes still re-read |
| Let the model place pixels | Overlaps, crossings and cut text; editor/export drift |
| A visual review round on every drawing | Adds a turn and minutes to every run before we know it helps |

## Consequences

- **Upside:** drawings follow a chosen focus and channel; channel switches are
  fast; correctness is checked once.
- **Cost:** more engine calls per first drawing; a new facts format; the
  instruction box must route a change to the facts or to the story.
- **Cost to reverse:** high.
