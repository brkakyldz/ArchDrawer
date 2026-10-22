# Archdrawer — requirements

What Archdrawer must do. The why is in `docs/decisions/`; the exact interfaces
are in `docs/contracts/`. Each requirement has an ID that tests and issues
cite, and a status:

- **Today** — the product does this now.
- **To build** — decided, not built yet.
- **To change** — exists, but must change as stated.

## 1. Users and the job

Developers who want to explain their own project. They point Archdrawer at a
repository; their own Claude Code or Codex reads it; they get an architecture
drawing that is correct and ready for one of three channels — a LinkedIn
image, a README drawing, a step-by-step presentation — and adjust it in an
editor before exporting. Side jobs: a map to drill from the system into a part
and its files, and a guided tour for learning a repository (ADR 0001).

## 2. Requirements

### Getting started (START)

- **START-1** (To change) The Claude Code / Codex plugin is the main install
  path; its command opens the app on the session's repository (ADR 0004).
- **START-2** (To build) The first launch shows a ready-made example drawing
  and its presentation before the user starts their own.
- **START-3** (Today) Before a run, the app tells whether `claude` and/or
  `codex` is installed, signed in and recent enough, and says what to do when
  it is not.
- **START-4** (Today) The home screen starts a drawing from a local folder.
- **START-5** (Today) The `archdrawer` command opens, validates and exports
  drawing files.
- **START-6** (Today) A draw that fails after its read keeps what it read,
  and `Try again` starts from the stage that did not finish, with no new
  read (ADR 0010).

### Scan and focus (SCAN)

- **SCAN-1** (Today) A scan of about a minute reads the README, the folder
  tree, dependency files and entry points, and produces a short repository card.
- **SCAN-2** (Today) The scan proposes 3–5 focus options of three kinds —
  a flow, an inner mechanism, the overview — each with a title, one sentence
  and the files that back it. An option whose files do not exist is not shown.
- **SCAN-3** (Today) The user can always pick "the whole system" or type a
  focus in their own words.
- **SCAN-4** (Today) A scan is cached per commit; opening the same commit
  again does not rescan.

### Deep read and facts (READ)

- **READ-1** (Today) After a focus is chosen, the engine reads the files the
  focus needs and returns a facts list: components, the mechanisms inside
  them, who calls whom and how, and limits that explain a guarantee.
- **READ-2** (Today) Every fact names the files (and lines where useful)
  that support it; code checks the files exist and rejects facts without
  evidence.
- **READ-3** (Today) In an AI agent project, the facts include the agent's
  loop (model call, tool proposal, execution, result) and the checks around
  tool execution, whenever the code has them.

### Channels and story (STORY)

- **STORY-1** (Today) The user chooses a channel after the focus — LinkedIn,
  README or presentation — and can switch channel without a new deep read.
- **STORY-2** (Today) LinkedIn: one image, about 8–12 parts, a title and one
  plain sentence, no held items, readable on a phone.
- **STORY-3** (Today) README: a detailed drawing; one-line descriptions;
  held items only on the few parts whose mechanism matters.
- **STORY-4** (Today) Presentation: ordered steps; each highlights some
  parts and carries a short on-screen text and a speaker note.
- **STORY-5** (Today) Numbers that explain a guarantee (a deadline, a turn
  limit) may appear outside LinkedIn.
- **STORY-6** (Today) The model decides what is drawn and its rough place
  (beside, above, below, inside); the fixed caps of one rulebook (zones and
  connection counts for every drawing) are removed.
- **STORY-7** (Today) An engine's story answer over a limit never costs
  the user the run: every prompt states the limits code checks, a broken
  answer gets one repair turn, and a text still too long is shortened with a
  warning (ADR 0009).

### Layout (LAYOUT)

- **LAYOUT-1** (Today) Code places every part, routes every connection as a
  smooth curve and sizes every part from its content; editor and export draw
  from the same numbers.
- **LAYOUT-2** (To change) Connections are never bent around anything: a
  connection that meets a part it does not join passes behind it, and the
  layout report lists every part it passes behind. A connection that crosses
  a group's header passes over it, and the group's name stays readable on a
  tight halo, so the line is broken only by the name's letters (ADR 0013).
  Code places parts without a stored position so connections clear them
  where it can; in a post, a straight line hidden behind parts turns out on
  one side.
- **LAYOUT-3** (Today) A layout report counts crossings, connections over
  parts, cut text and the text size at the channel's display size.
- **LAYOUT-4** (Today) On request, the model looks at the rendered image and
  proposes one round of fixes.
- **LAYOUT-5** (To build) A connection's sides count how many ends each side
  already holds, not only where the other end lies; parts close together get
  short handles, so no curve loops back; connections that arrive at one side
  of a part from one direction share a trunk for their last stretch. While a
  part is dragged its connections keep their sides until another pair is
  clearly better; every stored drawing is routed without that memory
  (ADR 0013).
- **LAYOUT-6** (To build) The automatic layout orders the parts of each row
  and column to cut crossings, keeping the main path's order and every
  `place` hint, then closes the rows and columns left empty. Only parts
  without a stored position move, and the layout report's crossings never go
  up (ADR 0013).

### Drawing appearance (LOOK)

- **LOOK-1** (Today) A clean, modern style in light and dark themes.
- **LOOK-2** (To build) Every kind of part has its own outline, in cards and
  in compact parts: a person's avatar, an app window, an API's pointed ends,
  a service's top rule, a background job's stack, an AI agent's gradient, an
  external service's cloud top, monitoring's pulse line, a check's shield and
  a data store's stacked disks. A part is sized so its text stays inside its
  outline (ADR 0014).
- **LOOK-3** (To build) No part draws rows on the canvas or in an export:
  the mechanisms, items and limits a part holds stay in the file and are
  listed in its callout. Under its label a part shows a one-line sub-line; it
  is on by default and can be switched off per view, and the share image
  follows the view unless its own switch says otherwise (ADR 0014).
- **LOOK-4** (To build) Calm connections: lines are drawn in one neutral
  colour, and take their kind colours when they are numbered or in focus (a
  hovered or selected part's lines, a selected line, the current step, search
  matches). No start ring; dotted lines stay readable at fit zoom. A line
  behind a part leaves a faint trace over it, and a label sits clear of other
  lines. A part that four or more parts use is marked "used by N" and the
  lines into it show on hover or selection (ADR 0013).

### File and editing (FILE, EDIT)

- **FILE-1** (Today) A drawing is one JSON file in the user's repository; the
  editor saves into it and follows outside changes to it.
- **FILE-2** (Today) The file holds the facts list and one drawing per
  channel (ADR 0003).
- **FILE-3** (Today) Appearance edits change only their channel; content
  edits change the facts and mark the other channels "needs update".
- **EDIT-1** (Today) Move, resize by content, rename in place, add parts by
  kind and form, connect by dragging, free text, undo and redo across views.
- **EDIT-2** (Today) A part's callout shows what it is for, its connections and
  its files.
- **EDIT-3** (Today) Saving shows its real state; a failed save never shows
  "Saved".
- **EDIT-4** (Today) While an AI instruction runs, edits to the drawing pause.
- **EDIT-5** (To build) A drag moves only what it moves: the dragged parts
  lift and their connections light up while every other label, badge and
  group frame holds still. Guides show alignment and equal gaps and the part
  snaps to them and to the 8 px grid during the drag, so release changes
  nothing; Alt turns snapping off. The group a part will join is shown while
  dragging, a drop never covers another part, and a drag is saved once, on
  release (ADR 0013).

### Changing with AI (AI)

- **AI-1** (Today) An instruction changes the current view, the selected parts
  or the whole drawing, through the user's chosen engine and model.
- **AI-2** (Today) There is one place to type instructions, shown as a
  conversation of requests and results.
- **AI-3** (Today) A result arrives as a preview — changed parts highlighted
  — with Accept and Undo.
- **AI-4** (Today) One-click suggestions for common changes ("simpler",
  "show the loop", "shorter for LinkedIn").
- **AI-5** (Today) An instruction is routed to the facts or to the channel's
  story depending on whether it changes content or appearance.

### Views and navigation (NAV)

- **NAV-1** (Today) A part can open a detail view of its inside; detail views
  nest.
- **NAV-2** (Today) Tabs show the channels (overview, LinkedIn, README,
  presentation) with a "needs update" mark; a breadcrumb shows the path into
  detail views.
- **NAV-3** (Today) Search highlights matching parts on the canvas as the
  user types, dims the rest, shows the match count and steps through matches
  with Enter; the view moves only when a match is off screen.
- **NAV-4** (To build) A cleaner header with the new Archdrawer logo.

### Presentation and tour (PRES)

- **PRES-1** (Today) A full-screen presentation mode steps through the
  presentation channel with the arrow keys, highlighting each step's parts and
  dimming the rest.
- **PRES-2** (Today) The same steps form the guided tour for learning a
  repository.
- **PRES-3** (Today) The steps export as PDF pages and PNG slides.

### Share (SHARE)

- **SHARE-1** (Today) Export as PNG and SVG, copy as an image, light or dark,
  sized for LinkedIn (1080 × 1350), README (1600 × 900), slide (1920 × 1080)
  and square (1080 × 1080).
- **SHARE-2** (Today) Share only packages what is ready: channel, theme,
  a large full-size preview, a plain-language readability check, download and
  copy. It does not simplify or rearrange; "Simplify" and "Share one part"
  leave the share screen.
- **SHARE-3** (Today) A readability problem is stated in one plain
  sentence ("the text will not be readable on a phone"), never as raw
  measurements.

### Safety and platform (SAFE)

- **SAFE-1** (Today) Nothing the user types reaches a shell; engines and git
  run with argument arrays and validated inputs; values starting with `-` are
  refused.
- **SAFE-2** (Today) Engines only read: Claude Code with read and search tools
  only, Codex in its read-only sandbox.
- **SAFE-3** (Today) The server listens on 127.0.0.1, checks `Host`, rejects
  foreign origins and requires its per-process token on every change.
- **SAFE-4** (Today) No API keys, no hosted service, no telemetry.
- **SAFE-5** (Today) Windows, macOS and Linux; Node 20.19 or newer.

### Quality bar (QUAL)

- **QUAL-1** (To build) For an agent project, a backend/API service and a
  full-stack application, each channel's output is shareable without hand
  edits.
- **QUAL-2** (Today) Each output's layout report shows no crossings, no
  connections over parts and no cut text, and text readable at the channel's
  size.
- **QUAL-3** (To build) In an agent project, the agent's loop is visible in the
  README and presentation outputs.

## 3. Out of scope for now

Drawing answers to free questions; risk audits; keeping a drawing current on
every pull request; designing changes on the drawing; blog layouts; LinkedIn
carousels; CLI/library and monorepo layouts; GitHub URLs as a source (clone
first); hosted mode, accounts, API-key engines.

## 4. Contracts

`docs/contracts/diagram.md` (the drawing file), `api.md` (the local server),
`ui.md` (the editor's test ids and behaviour), `cli.md` (the command),
`testing.md` (environment, fixture engine, suites).
