---
name: archdrawer
description: Draw the architecture of the current repository as an editable archdraw/diagram@3 file (docs/architecture.archdraw.json) and open it in the local archdrawer editor. Use when the user asks to draw, diagram, map or update the architecture of a codebase, or to apply instructions left in the drawing's requests.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash(archdrawer *), Bash(node *)
---

# archdrawer — draw this repository's architecture

You read the code, write one drawing file, check it with the `archdrawer`
command, and open it in the user's local editor. The user refines it there.

## 0. Find the command

Run `archdrawer --version`. If that fails, try the launcher shipped with this
skill, two folders above this file: `node "${CLAUDE_PLUGIN_ROOT}/bin/archdrawer.mjs" --version`
(in Codex, or when `${CLAUDE_PLUGIN_ROOT}` is not set: `node <this skill's
folder>/../../bin/archdrawer.mjs --version`). Use whichever works as
`archdrawer` below.

If neither works, tell the user, and stop — do not draw anything:

> archdrawer is not installed. Install the plugin (Claude Code:
> `/plugin marketplace add <archdrawer repository>` then
> `/plugin install archdrawer`; Codex: `codex plugin marketplace add
> <archdrawer repository>`), or from a clone run `npm ci` and `npm link`.
> It needs Node.js 20.19 or newer.

## 1. Ask before reading code

The file is `docs/architecture.archdraw.json` in the repository root unless
the user names another path.

- **If the file already exists**, skip the questions: you are updating it
  (step 4).
- **Otherwise** ask these three questions in one message, each with its
  default, and wait for the answer. "Just draw it" (or any answer that does not
  pick) means all defaults.
  1. **What to draw** — the whole system (default), or one part of it (name it).
  2. **How much detail** — *normal* (default): every component with what it
     holds, inner loops as groups, detail views for parts with many inner
     pieces; *overview*: top-level components only, no detail views.
  3. **Where the image will be shown** — README (default), a slide, or LinkedIn
     (wide, square or feed). This only sets the caption's tone and
     the `place` shape: for LinkedIn prefer at most four columns.

## 2. Read the code

Read entry points, routing, services, workers, data access, external calls,
configuration and deployment files — enough to name every component from the
code, with the file paths that hold it. Do not guess components the code does
not show.

## 3. Write the drawing

Write the file following **`rules.md` in this skill's folder** — read it now,
in full; it is the same rule set the editor's instruction engine uses. It
defines the format (`archdraw/diagram@3`), the depth required (held items,
nested groups, side paths above and below the main path, two-way and async
connections, descriptions and code paths, detail views) and what is not
allowed (tuning numbers, repeated labels, a second reverse connection).

## 4. Updating an existing file

Read the file first. Keep the `id` of every fact and part that still exists
(the user's positions hang on those ids; keep `x`/`y` you find), change the
facts the code changed, remove what is gone, add what is new as a fact and an
overview part with a `place` hint. Keep the other channels as they are (the
editor marks them for an update), `texts` (the user's own titles and
remarks), `theme`, each channel's `showSteps` and the document `id`. An older
file with `"schema": "archdraw/diagram@2"` (one `views` list) is still read;
run `archdrawer migrate <file>` once to turn it into this format first.

If the file has `requests` (instructions the user typed in the editor while no
engine could run them), apply each one to the channel and view it names, then set
`"requests": []`. Tell the user which requests you applied.

## 5. Check and fix until valid

Run `archdrawer validate docs/architecture.archdraw.json`. Every `ERROR` line
names a path and a reason: fix the file and run it again, until it prints
`valid` (exit code 0). Read `WARN` lines and fix the ones about depth (flat
view, no held items, no main path, tuning numbers, repeated labels) unless
the user asked for an overview.

## 6. Open it

Run `archdrawer open docs/architecture.archdraw.json`. It starts (or reuses)
the local editor and prints `Opened <file> → <url>`. Give the user the URL and
two lines on what the drawing shows. Edits in the editor save into the same
file; when you change the file again, the open editor reloads it.

To make an image without the editor: `archdrawer svg <file> --format
linkedin|readme|slide|square|feed`.
