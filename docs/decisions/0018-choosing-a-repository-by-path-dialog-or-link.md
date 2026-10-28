---
id: 0018
title: "Choosing a repository: a pasted path, the system's folder dialog or a link, with no recent or found lists"
date: 2026-10-28
status: accepted
deciders: [brkakyldz]
supersedes: []
---

Supersedes ADR 0017 **decision 1** (*Recent* and *Found on this computer*),
the part of its decision 4 that offers to delete a copy from its entry in
*Recent*, and the paragraph of its rationale about the lists. Everything else
in ADR 0017 stands: the system's folder dialog, links, the copy and its
cache, and the test stand-ins.

## Context

Archdrawer is opened mostly from the plugin, which already knows the
repository (START-1, ADR 0004). For the rarer start on the home screen, ADR
0017 added two lists of repositories: *Recent*, the folders scanned or drawn
before, and *Found on this computer*, the git repositories found by walking
the home folder. They are extra machinery for that case. *Found* walks the
user's disk every five minutes. *Recent* keeps a list in the data folder and
needs its own forget, refresh and copy-deletion rules. Both add server code,
contract text and held-out scenarios that every home-screen change has to
carry (issue #208).

The other ways stay without them: `Choose folder…` gives a path with one
click (ADR 0017 decision 5 covers a machine with no dialog), and a pasted
link reaches its copy, whose newest commit a later scan fetches (SRC-5).

## Decision

Exact shapes are in `docs/contracts/` (api, ui, testing). The owner took the
recommended option, (a), of issue #208 on 2026-10-28.

1. **Three ways to choose a repository.** A pasted path, a folder picked
   with `Choose folder…`, or a pasted link. The home screen keeps its two
   source tabs, *This computer* (the path field and `Choose folder…`) and
   *Link*. The path field is a plain text field with no list under it, and
   `Ctrl K` goes to it.
2. **No lists.** *Recent* and *Found on this computer* (SRC-1, SRC-2) go,
   with `POST /api/sources/forget`, `POST /api/sources/refresh`, the `recent`
   and `found` fields of `GET /api/sources`, the list kept in
   `sources.json`, the walk of the disk and `ARCHDRAW_SEARCH_HOME`, which
   pointed the walk at a test folder. `GET /api/sources` answers only whether the folder dialog is
   available.
3. **A copy without a drawing stays.** A copy is deleted only through its
   drawing: `Remove from list` on it still offers to delete the copy
   (SRC-6). A copy with no drawing in the library stays in archdrawer's data
   folder, and nothing deletes it at start-up. The README says where that
   folder is; pasting the link again uses the copy.

## Rationale

The plugin is the main way in (START-1). A list on the home screen serves
only the user who starts there without a path at hand, and `Choose folder…`
serves that user with one click in the system's own dialog. Walking the disk
on a timer reads folders the user never pointed at. Removing both lists takes
a list's rules on forgetting and deleting, and a walk with its own roots,
bounds, timings and skipped folders, out of every home-screen change.

A copy with no drawing costs disk space only, and a pasted link finds it
again. Deleting such copies at start-up would be new code that deletes
folders the user did not ask to delete.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Keep *Recent*, drop *Found* | Keeps the list in the data folder and its forget and copy-deletion rules, the larger share of the machinery |
| (b) Start-up deletes copies that hold no drawing and that no job uses | New code that deletes folders unasked; a README line costs nothing |

## Consequences

- **Upside:**
  - the home screen chooses a repository in three plain ways;
  - no disk walk, no list in the data folder, two routes and one test
    switch fewer.
- **Cost:**
  - nothing offers a repository by a click before the dialog opens: the user
    needs its path, the dialog or its link;
  - a copy with no drawing in the library is removed only by deleting its
    folder by hand;
  - the held-out scenarios that observe the lists are retired or revised by
    their author (#208 names them).
- A `sources.json` left in the data folder by an earlier version is no longer
  read and does no harm.
- **Cost to reverse:** low. The lists were additions over the path field
  (ADR 0017); bringing them back is ADR 0017 decision 1 again.
