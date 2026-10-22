---
id: 0007
title: "The staged pipeline's interfaces: a scan resource, one draw run, facts with evidence, one story shape"
date: 2026-10-21
status: accepted
deciders: [brkakyldz]
supersedes: []
---

## Context

ADR 0002 decides the stages: scan, focus, deep read, a story per channel,
layout by code, check. ADR 0006 decides the file's shape: facts, four
channels, parts that point to facts. Neither fixes what each stage takes and
answers, which endpoints start them, where a first drawing is written, or how
an instruction finds its stage. Today a first drawing comes only from the
plugin skill. Every run works on an existing drawing. Facts carry files but no
lines, and there is no fact for a mechanism or a limit. One rulebook with the
overview's caps serves every prompt.

## Decision

Exact shapes are in `docs/contracts/` (api, diagram, ui, testing).

- **The scan is its own resource**, `POST /api/scans {folder}`. It has the
  same progress events, cancel and timeout as a run. It writes no drawing, so
  "a succeeded run has a drawing" stays true for runs.
  - Code gathers the inputs within a size budget: the README, the folder
    listing, dependency files and entry-point candidates. Choosing them from
    the listing is pure (`src/core`).
  - The engine gets them in the prompt as quoted data, with no tools: Claude
    Code `--tools ""`, Codex in its read-only sandbox.
  - It answers a repository card and focus options. Code drops an option
    naming a file that does not exist.
  - A scan is cached per repository root, folder and `HEAD` commit, read with
    `git rev-parse HEAD` as an argument array. A folder outside git is never
    cached.
- **A first drawing is one run**, `POST /api/runs {kind: "draw", scan, focus,
  channel}`. It makes three engine calls:
  1. the deep read, with read tools, into facts;
  2. the overview's story, from the facts alone;
  3. the chosen channel's story, from the facts alone.

  It succeeds only once the file is written and registered. Any failure,
  cancel or timeout writes nothing.
- **The new file** is `<folder>/docs/architecture.archdraw.json`, or the next
  free `architecture-<n>.archdraw.json`. The app never overwrites a file it
  did not open. When the folder already has the first name, the home screen
  offers to open it.
- **The folder** is typed or pasted as an absolute path, or picked from the
  folders of the drawings already in the library. It must exist and be a
  directory. Its repository root is the nearest ancestor holding `.git`, else
  the folder itself. That root is the engine's working directory and Codex's
  `-C`, and AGENTS.md invariant 1 names it as a third input.
- **Facts with evidence.** The format stays `archdraw/diagram@3` and every
  existing file stays valid.
  - Component and relation facts gain optional `evidence`:
    `[{file, lines}]`, where `lines` is `[from, to]` or null.
  - A **mechanism** is a component fact with `within`, naming the component
    that holds it.
  - A **limit** is a new fact in `facts.limits`, `{id, on, text, evidence}`.
    It explains a guarantee of the component it is on.
  - Evidence is required in a read answer and optional in a file.
  - Code checks every evidence file exists and its lines fall inside it.
    It drops a fact left without evidence, and what depended on it: a
    relation to it, a mechanism within it, a limit on it. Each drop adds one
    warning.
- **Parts can draw mechanisms and limits.** A part may `hold` mechanism facts
  within the facts it shows, drawn as its panel's rows, and show `limits` on
  them. The overview rule becomes: every component fact is shown or held by a
  part of the overview channel.
- **One story shape for every channel.** The post intent becomes the story of
  every channel, with:
  - `inside`, for a part drawn within another part;
  - `held` and `limits`;
  - `steps`, for the presentation.

  The model gives what is drawn and its rough place (spine, above, below,
  inside); code places every part.
- **One brief per channel** replaces the shared rulebook's caps:
  - **Overview:** complete, with no caps.
  - **LinkedIn:** about 8–12 parts, no held items, no limits, no tuning
    numbers.
  - **README:** detailed, with one-line sub-lines; held items only where a
    mechanism matters; limits allowed.
  - **Presentation:** one drawing and 3–8 ordered steps.

  The overview's zone and connection targets, their warning and the
  `overview-suggestion` go away.
- **README and presentation hold one view each.** The presentation channel
  adds `steps: [{id, parts, text, note}]`. Steps are appearance: they change
  only that channel.
- **An agent project's loop** is asked for when the card says the repository
  is an agent project. The loop's stages (model call, tool proposal,
  execution, result) become mechanisms within the agent, and the checks
  around execution become `gate` mechanisms. No new marker is added.
- **An instruction is routed** (option (a) of issue #45). A small tool-free
  call answers `facts` or `story`:
  - **facts** runs today's refine, which may read the code; other channels
    are marked;
  - **story** redraws the current channel from the facts with no code.

  A `parts` scope skips the call and goes to facts. The result names the
  route.
- **The plugin skill** keeps writing files as today, with `evidence` optional,
  until 0.6 retires it (#15). The home screen's folder start replaces its
  empty-library help.

The owner accepted every recommended option of issue #45 on 2026-10-21.

## Rationale

A scan that writes nothing is a different resource from a run that must write
a drawing. Making it a run would weaken the check that a succeeded run has a
readable file. Gathering the scan's inputs in code keeps it near a minute and
tool-free, so the engine can neither wander nor run anything.

Drawing the overview with its own story call keeps what is true (the read)
apart from what is told (every story). The cost is one extra call on a first
drawing. In return, any channel, the overview included, can be redrawn without
touching the facts.

Extending `@3` instead of making `@4` keeps the skill, every file and every
conversion path as they are, because every new field is optional.

## Alternatives considered

| Alternative | Why not |
|---|---|
| The scan as a run kind | A succeeded scan has no drawing; the run invariant would need an exception |
| The engine reads the repository for the scan | Slower, and a read-capable call for what code can gather |
| One read answer holding the facts and an overview draft | One call fewer, but mixes what is true with what is told, and the overview then cannot be redrawn from the facts |
| `archdraw/diagram@4` | Every file and the skill would need a conversion for fields that are all optional |
| Mechanisms as held item strings with evidence | A string cannot be renamed once for every channel, linked by relations or checked as a fact |
| Routing by field (#32) or by the user in the ask box | A content fix and a "make it shorter" still take one read-capable call over the whole draft, or the user must know the pipeline |
| Writing the new file at the repository root | Two projects of a monorepo would share it; under the folder's `docs/` it sits with the code it draws |

## Consequences

- **Upside:**
  - a first drawing from the home screen;
  - scans are cached, so a second look is instant;
  - every fact can say where it comes from;
  - every channel, the overview included, redraws without a read.
- **Cost:**
  - three engine calls for a first drawing;
  - two for a refine (the routing question, then the change), one with a
    `parts` scope;
  - amended by ADR 0009: each story answer may take one more call, a repair
    turn;
  - the server spawns `git` (argument arrays only);
  - a third user input reaches an engine's working directory;
  - evidence, mechanisms, limits and steps in `src/core` validation, joining
    and splitting;
  - held-out scenarios naming the overview caps change.
- **Cost to reverse:** high — new endpoints, new file fields and new prompts.
