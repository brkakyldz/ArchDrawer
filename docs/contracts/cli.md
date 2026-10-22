# Contract — the `archdrawer` command

The command an agent session runs after writing a drawing, and that a person
can run by hand: it validates a drawing file, opens it in the editor (starting
or reusing a detached server), writes share images, converts older files, and
reports or stops the server. Node ≥ 20.19.

Implemented by: `src/cli/main.ts`; entry point `bin/archdrawer.mjs`
(`package.json` `bin.archdrawer`), with the shell launchers `bin/archdrawer`
and `bin/archdrawer.cmd`; `src/server/files.ts`, `src/server/serverfile.ts`,
`scripts/start.mjs`.

## General

- Output is UTF-8 text on stdout; messages that stop a command go to stderr.
- Exit codes: `0` success, `1` invalid file or failure, `2` wrong usage.
  A usage error prints its reason and `Run "archdrawer --help" for the
  commands.` to stderr. Unknown options (any argument but `-` that starts
  with `-`: `Unknown or incomplete option <arg>`), a missing option value and
  a wrong number of files are usage errors.
- The CLI reads the same environment as the server (testing contract) and
  passes it to a server it starts.
- When its own dependencies are missing (a bare plugin copy), the entry point
  installs them once (`npm ci`, or `npm install`, without dev dependencies),
  reporting on stderr.

## `archdrawer validate <file>`

Checks the file against the drawing contract, including the repository file
check. Writes nothing.

- Valid: prints each warning as `WARN  <json path>: <message>` (two spaces),
  then `valid`, or `valid with <n> warning(s)`; exit 0.
- Invalid: one line per violation, `ERROR <json path>: <message>`, every
  violation listed, then `<n> error(s)`; exit 1. The path names the place to
  fix (`choices[0].channels.overview.views[0].nodes[3].form`) and the message what is allowed
  (`"box" is not a form; use one of card, compact, panel, group`). An invalid file
  prints no warnings.
- Not JSON: `ERROR json: <parser message>`; unreadable: `ERROR file: not
  found` (or the system message); an `archdraw/diagram@1` file:
  `ERROR schema: this is archdraw/diagram@1; run "archdrawer migrate <file>"`
  (an `archdraw/diagram@3` or `@2` file is checked as converted, with the conversion
  warnings as `WARN` lines);
  each followed by `1 error(s)`, exit 1.

## `archdrawer open <file> [--no-browser]`

1. Validates as `validate` does, except that a path missing from the
   repository is a `WARN` line, not an error (drawing contract rule 14); on
   errors prints them the same way and exits 1 without writing or starting
   anything.
2. Normalises the document (drawing contract) and writes it back only when
   its text changed.
3. Reads `server.json` in the data directory and finds this data
   directory's server (below). When it runs this installation's `build`, it
   is reused. When it runs another `build`, the CLI stops it as `stop` does,
   prints `Restarted the editor server (it was running older code)` and
   starts a new one; when it does not stop, the command fails with `stop`'s
   message. When there is none, it builds the web client if needed, starts
   the server **detached** (it outlives the command and the session that ran
   it), appends its output to `<data dir>/server.log`, and waits up to 15 s
   for this data directory's server with this `build` — the one it started,
   or one another command started meanwhile, in which case the one it
   started is stopped. When the server it started exits first (a port in
   use, say), it fails with `The editor server did not start: <the last line
   it logged>; see <log>`; after 15 s, with `The editor server did not start
   within 15 s; see <log>`.
4. Registers the file (`POST /api/files`). A refusal prints
   `The editor refused the file: <error>` on stderr and its `ERROR` lines;
   exit 1.
5. Opens the URL in the default browser (no shell) unless `--no-browser` or
   `ARCHDRAW_NO_OPEN` is set, and prints as its last line
   `Opened <absolute file> → http://127.0.0.1:<port>/d/<id>`; exit 0.

The same file always gets the same id and URL. A file whose `id` belongs to
another registered drawing gets a new id, written back.

## `archdrawer svg <file> [--choice <id>] [--channel <c>] [--view <id>] [--format <f>] [--theme light|dark] [--out <path>]`

Writes the share image (ui contract, The share image) with title, steps,
connection labels, colour key and texts on, description off and sub-lines as
the view's switch says, the fonts embedded. The file is checked as `open`
checks it. `--choice` names one of its choices, by default the one holding
`--view` when it is given, else the first. `--channel` is
`overview` (default), `linkedin`, `readme` or `presentation`; `--view` defaults
to the channel's first view; `--format` is
`linkedin` (default, 1620×1080), `readme`, `slide`, `square` or `feed`
(1080×1350); `--theme` defaults to the document's. Default output, next to the
file: `<name>-<view>-<format>.svg`, where `<name>` is the file name without
its extension and without a trailing `.archdraw`
(`architecture.archdraw.json` → `architecture-overview-linkedin.svg`); the
same name for every channel, since view ids are unique in the file.
Prints the path written.

An unknown format or theme is a usage error (exit 2:
`Unknown format "<f>"; use one of linkedin, readme, slide, square, feed`,
`Unknown theme "<t>"; use light or dark`). An unknown channel is a usage error
(`Unknown channel "<c>"; use one of overview, linkedin, readme, presentation`).
An unknown choice prints `No choice "<c>" in <file>; choices: <ids>` on
stderr, exit 1.
A channel with no view prints `The channel "<c>" has no drawing in <file>` on
stderr, exit 1. An unknown view prints
`No view "<v>" in the <c> channel of <file>; views: <ids>` on stderr, exit 1. An invalid file is
reported as by `validate`, exit 1.

## `archdrawer migrate <file>`

Rewrites an `archdraw/diagram@1`, `@2` or `@3` file in the current
format (drawing contract, Reading `archdraw/diagram@3`, `@2` and `@1`), prints each
conversion warning, then `migrated`; exit 0. A file already in the current
format prints `already archdraw/diagram@4`, exit 0. Not JSON: `ERROR json: <message>`; any
other schema: `ERROR schema: not an archdrawer drawing`; exit 1.

## `archdrawer status` and `archdrawer stop`

This data directory's server is the one on the port `server.json` names when
it answers `GET /api/health` with `"app": "archdrawer"` and accepts the token
`server.json` names: `POST /api/health` with that token, a call no route
serves, answers anything but 403. A server on that port that refuses the token
is another data directory's (the `server.json` is stale) and counts as none.

`status` prints `running on http://127.0.0.1:<port> (pid <pid>)` when this data
directory's server runs, else `not running`; exit 0. `stop` sends that server
`POST /api/shutdown` with its token and waits up to 5 s until it no longer
answers, then prints `stopped`, exit 0; with no server it prints `not running`,
exit 0. A refused shutdown prints `The editor server refused to stop: <error>`,
and a server still answering after 5 s prints `The editor server on port
<port> (pid <pid>) still answers after 5 s`, both on stderr, exit 1.

## `archdrawer --version`, `--help`

`--version` (`-v`) prints the package version. `--help` (`-h`, `help`) prints
the commands, exit 0; no arguments prints them and exits 2. An unknown
command is a usage error.

## `server.json`

A running server writes `<ARCHDRAW_DATA_DIR>/server.json`:
`{"port", "pid", "token", "version", "build"}`, readable only by the user
(mode 0600 where the OS supports it), and removes it on a clean exit when it
still names its own pid. The CLI reads it to find the server and to send the
token on mutating calls.
