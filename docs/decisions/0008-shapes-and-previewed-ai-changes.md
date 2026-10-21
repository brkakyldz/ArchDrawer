---
id: 0008
title: "Shapes by kind, held items where needed, one AI conversation whose results are previewed, and a second look at the image"
date: 2026-10-22
status: accepted
deciders: [brkakyldz]
supersedes: []
---

## Context

Milestone 0.4 (#13) builds LOOK-2, LOOK-3, AI-2, AI-3, AI-4 and LAYOUT-4.
Today every part is a rounded rectangle whatever its kind. A lint asks for
held items on every drawing of six or more parts. Instructions are typed in
two places, the ask box and the AI panel, and neither keeps a history. A run's
result is saved and applied at once; the only way back is the ordinary undo.
The only one-click change is `Simplify the overview`. No image ever reaches an
engine, and `revise: true` is refused.

## Decision

Exact shapes are in `docs/contracts/` (diagram, api, ui, testing).

- **Shapes follow the kind, not a new field.** Card and compact parts of five
  kinds draw their own outline: `llm` an agent, `actor` a person, `data` a
  store, `external` an outside service, `gate` a check. Every other kind, and
  every panel and group, keeps today's outline. A shape is drawn inside the
  box the part already has, so sizes, layout and the editor/export parity do
  not change. The outline names its shape in `data-shape`. The file format
  stays `archdraw/diagram@3`.
- **Held items only where needed.** The sub-line is the one-line description
  every story asks for. The overview still holds every mechanism, because it
  must draw every fact (ADR 0006). The README and the presentation hold one
  only where the story is about how that part works, and LinkedIn holds none.
  The *No held items* warning goes.
- **One place to type.** The AI panel is the only input, and the ask box
  goes. The panel shows a conversation: one turn per run on the open drawing,
  whichever control started it, with its request and its result. The
  conversation lives in the browser's memory for the open drawing. Nothing is
  written to the file.
- **A result arrives as a preview.** The server saves the result as it does
  today, so a succeeded run still implies a written file. The editor shows the
  result with the changed parts highlighted, and Accept and Undo controls.
  Undo returns to the drawing before the run, the same step as the ordinary
  undo, and saves it. While a preview is shown, edits pause. A new run accepts
  it first, and so does an outside change to the file. Every run kind but
  `draw` arrives this way: `draw` writes a new file.
- **Suggestions are fixed instructions.** Each channel has a short fixed list
  in the ui contract. A suggestion is sent like a typed instruction, so it is
  routed and its route is shown. `Simpler` on the overview is the `simplify`
  run and replaces `Simplify the overview`. No model chooses the suggestions.
- **A second look is a run of its own.** The browser renders the current
  view's PNG, the same image the share dialog makes, and posts
  `{kind: "revise", image}`. The `revise` flag goes. The server checks that the
  image is a PNG of at most 4 MB and writes it into a folder of its own under
  the data directory, which it removes after the run; a starting server
  removes the folders of servers no longer running, so a killed server leaves
  no picture of the user's system behind. Claude Code gets `--tools Read
  --allowedTools Read --add-dir <that folder>`, and the prompt names the file.
  Codex gets `-i <file>` with its read-only sandbox. The answer is one round,
  shaped like a refine's `story` route: it changes how the channel tells the
  facts, never the facts. It arrives as a preview.

The owner accepted every recommended option of issue #73 on 2026-10-22.

## Rationale

The five kinds that get a shape already exist, with these names in the
picker. A new `shape` field would have to be chosen, validated and converted,
and would duplicate the kind. Keeping each part's box makes the change a
matter of drawing only. Every size rule, layout number and parity check
stays true.

Previewing a saved result, rather than holding it unsaved, keeps a single
truth: the file always holds what the screen shows. "Succeeded means a written
file" holds without exception. Undo is then an ordinary edit that the autosave
already knows how to make safe.

A spike on 2026-10-22 ran Claude Code 2.1.303 with `-p`, `dontAsk`, the read
tools and a PNG outside its working directory. It named the image's labels and
its overlap both with `--add-dir` and without it. So `Read` is not confined
to the working directory or the added folders, and `--add-dir` only declares
the intent. A revise, like every read-capable call, is *asked* to read
nothing but the image; the guarantee is that it cannot write (invariant 2),
not that it reads only one file.

## Alternatives considered

| Alternative | Why not |
|---|---|
| A `shape` field on parts | Duplicates the kind and needs a format change for no new meaning |
| Shapes that change a part's size | Every geometry rule, the layout and the parity checks would move with them |
| The overview holds only where needed too | The overview must draw every fact; a mechanism not held would need a detail view of its own |
| The ask box as the only input | The panel already holds the engine, model, scope and report; one input with all of them is simpler than two |
| The conversation saved in the file | It would grow every file and mix a session's history with the drawing |
| The server holds the result until `POST /api/runs/:id/accept` | A succeeded run would have no written file, and an unaccepted result would sit in memory |
| Suggestions written by a model | One more call before every click, and buttons that change under the user |
| The server renders the PNG | A new rendering dependency, when the browser already renders exactly this image |
| The SVG text and the layout report instead of an image | Cheaper, but the model would not see what the reader sees |

## Consequences

- **Upside:** shaped parts at no layout cost. Drawings without forced held
  items. One input with a visible history. Every AI change is reviewed before
  it stays. A model can check what the reader sees.
- **Cost:** the `ask-*` controls, `simplify-overview` and the `revise` flag
  go, so the held-out scenarios that use them are re-authored. A revise run
  writes a temporary image and must remove it in every outcome. Codex's image
  path has fake-CLI tests only while Codex is paused.
