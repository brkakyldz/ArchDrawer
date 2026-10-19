---
id: 0005
title: Develop in the open from a fresh public repository; maintainer records stay private
date: 2026-10-19
status: accepted
deciders: [brkakyldz]
supersedes: []
---

## Context

The project was built in a private repository whose history and documents
record a long series of experiments and process notes. The owner wants to
develop in the open, through issues, under the name Archdrawer.

## Decision

- Archdrawer lives in a new public repository that starts from a single
  commit. The earlier private repository is kept, frozen, as history.
- Public documents start from this date: these ADRs, `docs/spec.md` and
  `docs/contracts/`. Code comments do not point at the earlier documents.
- Work items are GitHub issues.
- Maintainer-only records (status, plans, run reports, evidence, reviews,
  research, lessons) live in a separate private repository; maintainer
  tooling reaches them through a git-ignored local file.
- The version starts at 0.1.0: the product is not finished.

## Rationale

A clean start makes the repository readable to a newcomer; the private history
stays available to the maintainer without being published.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Rewrite the history of the existing repository | Irreversible; a new repository reaches the same result and keeps the old one |
| Publish everything | Process notes and local paths are noise to users |
| Keep internal records in an ignored folder of the public repository | No backup and no history for them |

## Consequences

- **Upside:** a public repository that reads as the product, not its process.
- **Cost:** two repositories to keep in step; references to earlier decisions
  are gone from the code.
- **Cost to reverse:** low.
