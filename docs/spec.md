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
- **START-4** (To change) The home screen starts a drawing from a repository
  chosen by a click: an entry of *Recent* or *Found on this computer*, a
  folder picked in the operating system's own folder dialog (`Choose
  folder…`), a pasted path, or a pasted link (SRC-1 … SRC-6, ADR 0017).
- **START-5** (Today) The `archdrawer` command opens, validates and exports
  drawing files.
- **START-6** (Today) A draw that fails after its read keeps what it read,
  and `Try again` starts from the stage that did not finish, with no new
  read (ADR 0010).
- **START-7** (To build) A draw of several choices draws them one after
  another, one read each. A choice that fails or is cancelled keeps the
  choices that finished; `Try again` starts from the first choice that did
  not finish. Nothing is written until every choice is drawn (ADR 0015).

### Sources (SRC)

A repository comes from one of two sources: *This computer* (a local folder)
or *Link* (a repository copied from a link). Exact shapes and texts are in
the api contract, *Sources* (ADR 0017).

- **SRC-1** (To build) *Recent* lists the folders scanned or drawn before,
  most recently used first, at most 20; a folder that no longer exists is
  left out. Each entry has its name, its path, its branch, the time of its
  last commit and, for a copy, its link (`github.com/owner/repo`). An entry
  without a drawing in the library can be removed from the list.
- **SRC-2** (To build) *Found on this computer* lists the git repositories
  found below the home folder, below `code`, `src`, `projects`, `repos`,
  `dev` and `Documents/GitHub` under it, and below the parent folder of each
  drawing's repository in the library: at most two levels deep, at most 50,
  newest last commit first, none already in *Recent*, with the same fields as
  SRC-1. The list is made again at most every five minutes, or at once on
  request.
- **SRC-3** (To build) `Choose folder…` opens the operating system's own
  folder dialog in front of the browser: the modern Explorer folder picker on
  Windows, Finder's `choose folder` on macOS, `zenity` or `kdialog` on Linux.
  The folder picked is checked as a pasted one; closing the dialog changes
  nothing. Where no dialog is available, `Choose folder…` is not shown and
  pasting a path stays.
- **SRC-4** (To build) A pasted `https` link of a repository on github.com,
  gitlab.com or bitbucket.org, optionally naming a branch, is copied (its
  newest commit only) into archdrawer's own data folder and scanned and drawn
  like a folder; its drawing file is written into the copy. A private
  repository works when the user's own git already holds a sign-in for it;
  archdrawer never asks for or keeps a password. A link it cannot take, a
  host it cannot reach and a repository it cannot see each fail with one
  plain sentence.
- **SRC-5** (To build) A later scan of a copy fetches the newest commit
  first: of the branch a link names, of the repository's default branch when
  a link names none, or of the copy's own branch when the copy is chosen as
  a folder. When the fetch fails, the scan goes on with the copy it has and
  says so, naming its branch. While a drawing or an instruction uses the
  copy, it is not updated, and a link asking for another branch fails with
  one plain sentence. The drawing files in the copy are never removed or
  overwritten by an update.
- **SRC-6** (To build) The library names a copy's drawing by its link instead
  of its path. `Remove from list` on that drawing, or on a copy's entry in
  *Recent*, offers to delete the copy too; the copy is deleted only when no
  other drawing in the library is in it and nothing runs on it.

### Scan and choices (SCAN)

- **SCAN-1** (Today) A scan of about a minute reads the README, the folder
  tree, dependency files and entry points, and produces a short repository card.
- **SCAN-2** (To change) The scan proposes 3–8 options of two kinds — a
  section (a layer or part of the system: the back-end, the front-end, an API
  layer) and a flow (a workflow) — each with a title, one sentence and the
  files that back it. An option whose files do not exist is not shown
  (ADR 0015).
- **SCAN-3** (To change) The user ticks one or several choices: any of the
  options, "The whole system", and "Something else" in their own words. One
  draw makes every choice ticked, into one drawing file.
- **SCAN-4** (Today) A scan is cached per commit; opening the same commit
  again does not rescan.

### Deep read and facts (READ)

- **READ-1** (Today) For each choice, the engine reads the files the
  choice needs and returns a facts list: components, the mechanisms inside
  them, who calls whom and how, and limits that explain a guarantee.
- **READ-2** (Today) Every fact names the files (and lines where useful)
  that support it; code checks the files exist and rejects facts without
  evidence.
- **READ-3** (Today) In an AI agent project, the facts include the agent's
  loop (model call, tool proposal, execution, result) and the checks around
  tool execution, whenever the code has them.

### Channels and story (STORY)

- **STORY-1** (To change) The user chooses one channel after the choices —
  LinkedIn, README or presentation — and it is drawn for every choice. Each
  choice has its own set of channels (overview, LinkedIn, README,
  presentation) and can switch channel without a new deep read.
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
- **STORY-8** (To build) The whole system is drawn as a map of about 5–9
  top-level parts; every other component is inside one of them, in a detail
  view the draw writes at once. The map and its detail views together show
  or hold every component fact (ADR 0015).

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
- **FILE-2** (To change) The file holds one or more choices, each with its
  own facts list and one drawing per channel; an edit changes only its own
  choice (ADR 0003, ADR 0015).
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

- **NAV-1** (To change) A part can open a detail view of its inside; detail
  views nest. A part with an inside shows a visible open mark, in the editor
  and the export; a click on it without moving it, or Enter on it, goes into
  its inside, and a drag moves it.
- **NAV-2** (To change) A views panel beside the canvas lists the whole
  system, each section and each flow of the drawing, with their detail views
  under them, marks the current one and goes to any of them in one click;
  below 900 px it folds into the header menu. Tabs show the current choice's
  channels (overview, LinkedIn, README, presentation) with a "needs update"
  mark; a breadcrumb shows the path into detail views.
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
carousels; CLI/library and monorepo layouts; links other than `https` links
of github.com, gitlab.com and bitbucket.org; hosted mode, accounts, API-key
engines.

## 4. Contracts

`docs/contracts/diagram.md` (the drawing file), `api.md` (the local server),
`ui.md` (the editor's test ids and behaviour), `cli.md` (the command),
`testing.md` (environment, fixture engine, suites).
