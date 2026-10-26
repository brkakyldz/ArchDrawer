---
id: 0016
title: "Jobs: choices drawn side by side in shared engine slots, new choices join a running draw, a failed choice costs only itself, an activity list"
date: 2026-10-26
status: accepted
deciders: [brkakyldz]
supersedes: []
---

Supersedes ADR 0015 **decision 4** (a draw's choices are drawn one after
another, and nothing is written until every choice is drawn), and with it the
last sentence of its decision 3 (adding a choice to an existing drawing is
not part of that decision). Everything else in ADR 0015 stands. It extends
ADR 0010: a choice that fails while the others finish keeps its read too.
ADR 0007's "any failure writes nothing" now holds for a whole draw, not for
one of its choices.

## Context

A draw of several choices draws them one after another (ADR 0015 decision
4): three choices take three times as long, and the screen shows one choice
moving while the others wait. A second draw of the same repository is
refused (`A drawing of this folder is already being made`), so a user who
ticks one more choice waits for the whole draw to end. Nothing on the server
lists what is running: a reloaded page loses every scan and draw it started,
though they go on in the background. While a choice runs, the screen shows
one line of text, so working and frozen look the same.

Every engine call runs on the user's own subscription, whose rate limit all
of them share.

## Decision

Exact shapes are in the api contract (*Engine slots*, *The draw run*,
*Activity*) and the testing contract. The owner took the recommended option,
(a), of each of the six questions of issue #191 on 2026-10-26.

1. **Engine slots.** At most three engine processes run at a time for the
   whole server. A slot is held by a scan that starts an engine, by each
   choice of a draw, and by each instruction run of the editor, from the
   moment it starts to the moment its engine has exited. What finds no free
   slot waits, first come first served across the server, and says
   `Waiting for a free engine`. Waiting counts toward no deadline. Cancel
   takes a waiting job out of the queue, and a running one's slot is freed
   once its engine is gone.
2. **Side by side.** A draw puts its choices in the queue in request order;
   each starts as soon as it has a slot, with its own read, overview, channel
   and deadline. The ids in the file do not depend on which choice finishes
   first: they are settled when the file is written, as if the choices had
   been drawn one after another in request order.
3. **A choice that fails while others go on** (decision 2). A choice that
   fails or times out ends alone; the others carry on. Once every choice has
   ended, the file is written with every choice that finished, and the run
   ends `succeeded` with the failed choice marked in its record. `Try again`
   on that run draws the failed choices into the file it wrote. A draw in
   which every choice failed ends `failed` and writes nothing. A cancelled
   draw writes nothing, as before.
4. **Joining a running draw** (decision 3). Choices for a folder whose draw
   is running join that draw: they take its channel, engine and model, queue
   for slots like its own choices, and go into the same file. A join is
   refused once the draw has started writing its file; the user then starts
   a new draw when it has finished.
5. **Structured progress.** Every progress line carries its time and whether
   the engine or the server wrote it. Each choice of a draw reports its
   state, when it started, the time of its last engine line, the number of
   files the engine has read for it, and the number of parts its checked read
   found.
6. **An activity list.** `GET /api/activity` lists every scan and draw that is
   running or ended within the last hour, with what is needed to show it and
   to follow its event stream again. A finished scan keeps its card and
   options there for that hour (decision 6), so a reload or a second visit
   can go back to choosing.
7. **A finished draw** (decision 4). The screen stays where it is; the
   Activity rail shows the job as `Ready` with `Open`, and a notice appears.
   The editor no longer opens by itself.
8. **A restart** (decision 5). Jobs live in the server's memory only. A page
   that was following running jobs when the server restarted says once
   `The server restarted; <n> jobs stopped`. The activity list names the
   server process it comes from, so the page can tell a restart from a
   dropped connection.

## Rationale

The subscription's rate limit is shared, so a limit per draw (b) would still
let two draws and a scan start nine processes; no limit (c) would let a
draw of ten choices start ten. Three is also as many rows as a screen shows
comfortably at once. One slot per choice for its whole life, not per engine
call, keeps a choice's three calls together and its deadline simple: no
choice waits behind another between its read and its overview.

Writing the finished choices when one fails (2a) keeps what the user paid
for. `succeeded` still implies a readable file holding every choice the
record marks `done`; the failed choice is told apart in the record and, with
`Try again`, drawn into the same file. Keeping a whole draw's failure (every
choice failed, a cancel) writing nothing keeps START-6 and ADR 0010 true.

Taking the running draw's channel for joining choices (3a) keeps one file,
one channel per draw. A join refused during the write keeps the write
simple: the file's choices are known before it starts.

Staying on the home screen when a draw finishes (4a) lets several jobs run
without one of them pulling the user into the editor. Keeping jobs in memory
only (5a) matches what happens to them anyway: engines are stopped when the
server stops, and ADR 0010 already keeps its reads in memory for the same
reason.

## Alternatives considered

| Alternative | Why not |
|---|---|
| (1b) Three slots per draw, no server limit | Two draws and a scan start nine engines on one subscription |
| (1c) No limit | A draw of ten choices starts ten engines |
| A slot per engine call, not per choice | A choice could wait between its read and its overview; its deadline would have to stop and start |
| (2b) The run fails, nothing is written, finished choices kept in memory | One bad choice costs the good ones until `Try again` succeeds |
| (3b) Each joining choice keeps its own channel | One draw would write several channels; the channel control would mean different things for different rows |
| Accept a join during the write and start a second draw for it | Two runs for one request; the user sees a job they did not start |
| (4b) Open the editor when the draw was the only job | The screen behaves differently depending on what else runs |
| (5b) Job records written to disk, shown as stopped after a restart | A file of past jobs to clean up, for jobs that cannot resume anyway |
| (6b) A finished scan gone once the page leaves it | A reload during choosing loses the card and options; scanning again costs nothing only when cached |

## Consequences

- **Upside:**
  - three choices take about as long as one;
  - one more choice joins the draw that is running instead of waiting for it;
  - a choice that fails costs only itself;
  - a reload finds every job again, with its progress;
  - the screen can say what each choice is doing and when the engine last
    spoke.
- **Cost:**
  - a server-wide slot queue (`src/server/slots.ts`) that scans, draws and
    instruction runs share; an instruction in the editor may now wait;
  - each choice has its own deadline and its own failure;
  - view ids are settled at write time, not as each choice is drawn;
  - a draw can add choices to a file it did not create in the same run
    (`Try again` after a failed choice);
  - every progress event grows `at` and `source`, and a draw's stream
    carries `choice` events;
  - held-out scenarios whose asserted behaviour this decision changes are
    superseded, and their author revises them:
    - H192 (lines 70–83): the controls locked while the draw runs, the
      choices one after another, the editor opening at the end;
    - H194 (lines 36–41): every draw line with a `choice` and a `stage`,
      choices never interleaved;
    - H195 (lines 28–38): a failure in the second choice fails the run;
    - H196 (lines 34–60): `Try again` from the first unfinished choice, then
      the editor opening;
    - H197 (line 12, lines 50–57): a cancel in the second choice while the
      first is done and the later ones wait, then the editor opening;
    - the editor opening by itself after a draw: H121 (lines 77–82), H122
      (line 85), H123 (line 51), H148 (line 26), H149 (line 45), H157
      (line 66).
- **Cost to reverse:** medium — memory-only state and new endpoints, no file
  format change.
