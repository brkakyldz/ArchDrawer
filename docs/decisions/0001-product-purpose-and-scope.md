---
id: 0001
title: Archdrawer helps developers explain their own project with a drawing read from the code
date: 2026-10-19
status: accepted
deciders: [brkakyldz]
supersedes: []
---

## Context

Archdrawer already reads a repository with the user's own coding agent and
draws an editable architecture diagram. The drawings were correct but read like
an inventory of modules: the mechanism that makes a system interesting (an
agent's loop, its limits, its approval gates) was hidden, and the images were
not ones a developer would post or present. One rulebook served every purpose,
so it served none well.

## Decision

Archdrawer is a tool for developers who want to **explain their own project**:
it gives them the architecture of their repository, read correctly from the
code and ready to share.

- **Users:** other developers, using it on their own repositories.
- **Main job:** explaining a project, through three channels — a **LinkedIn**
  image, a **README** drawing, and a step-by-step **presentation** (for
  interviews and talks).
- **Side jobs:** a **map** (drill from the whole system into a part and on to
  its files) and a **guided tour** for learning a repository, which uses the
  same step-by-step mechanism as the presentation.
- **Repository types that must work well:** AI agent projects, backend/API
  services, full-stack web applications.
- **Kept:** everything runs locally; the engine is the user's own Claude Code
  or Codex subscription; no API key, no hosted service; the engine only reads.
- **Not now:** drawing answers to questions, risk audits, a drawing kept up to
  date on every pull request, designing changes on the drawing, blog layouts,
  LinkedIn carousels, CLI/library and monorepo layouts.

**Success** is measured on nine outputs — the three repository types times the
three channels: each must be shareable without hand edits, and pass the
measurable checks (every part backed by real files, no crossing lines, text
readable at the channel's size, an agent's loop visible in agent projects).

## Rationale

Explaining one's project is a job developers do repeatedly and today do by hand
in a drawing tool, so a correct drawing that is also good to look at saves real
time. Neighbouring tools either draw from code without a real editor, or edit
well without reading the code; being right *and* presentable is the gap. The
side jobs reuse the same engine and drawing, so they cost little.

## Alternatives considered

| Alternative | Why not |
|---|---|
| A general "draw any repository" tool | What we had; one rulebook made every output an inventory |
| Lead with risk audits of agent systems | Strong, but a wrong finding destroys trust; harder to do well first |
| A drawing kept current by CI | Valuable for teams, weak for one developer; needs CI and subscription plumbing |
| Let the user design changes on the drawing and have the agent apply them | Needs a write-capable engine; breaks the read-only guarantee |

## Consequences

- **Upside:** one clear promise; every feature is judged by "would someone
  share this?".
- **Cost:** the drawing pipeline and the rules are rebuilt per channel
  (ADR 0002); features outside the scope are not taken in.
- **Cost to reverse:** medium.
