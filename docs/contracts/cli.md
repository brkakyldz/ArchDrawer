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
  commands.` to stderr. Unknown options, a missing option value and a wrong
  number of files are usage errors.
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
  fix (`views[0].nodes[3].kind`) and the message what is allowed
  (`"database" is not a kind; use one of actor, client, …`). An invalid file
  prints no warnings.
- Not JSON: `ERROR json: <parser message>`; unreadable: `ERROR file: not
  found` (or the system message); an `archdraw/diagram@1` file:
  `ERROR schema: this is archdraw/diagram@1; run "archdrawer migrate <file>"`;
  each followed by `1 error(s)`, exit 1.

## `archdrawer open <file> [--no-browser]`

1. Validates as `validate` does; on errors prints them the same way and exits
   1 without writing or starting anything.
2. Normalises the document (drawing contract) and writes it back only when
   its text changed.
3. Reads `server.json` in the data directory. When that server answers
   `GET /api/health` with `"app": "archdrawer"` and this installation's
   `build`, it is reused. When it answers with another `build`, the CLI sends
   `POST /api/shutdown`, waits up to 5 s, prints `Restarted the editor server
   (it was running older code)` and starts a new one. When none answers, it
   builds the web client if needed, starts the server **detached** (it
   outlives the command and the session that ran it), appends its output to
   `<data dir>/server.log`, and waits up to 15 s for health; otherwise it fails
   with `The editor server did not start within 15 s; see <log>`.
4. Registers the file (`POST /api/files`). A refusal prints
   `The editor refused the file: <error>` on stderr and its `ERROR` lines;
   exit 1.
5. Opens the URL in the default browser (no shell) unless `--no-browser` or
   `ARCHDRAW_NO_OPEN` is set, and prints as its last line
   `Opened <absolute file> → http://127.0.0.1:<port>/d/<id>`; exit 0.

The same file always gets the same id and URL. A file whose `id` belongs to
another registered drawing gets a new id, written back.

## `archdrawer svg <file> [--view <id>] [--format <f>] [--theme light|dark] [--out <path>]`

Writes the share image (ui contract, The share image) with title, held items,
steps, connection labels, colour key and texts on and description off, the
fonts embedded. `--view` defaults to the first view; `--format` is
`linkedin` (default, 1620×1080), `readme`, `slide`, `square` or `feed`
(1080×1350); `--theme` defaults to the document's. Default output, next to the
file: `<name>-<view>-<format>.svg`, where `<name>` is the file name without
its extension and without a trailing `.archdraw`
(`architecture.archdraw.json` → `architecture-overview-linkedin.svg`).
Prints the path written.

An unknown format or theme is a usage error (exit 2:
`Unknown format "<f>"; use one of linkedin, readme, slide, square, feed`,
`Unknown theme "<t>"; use light or dark`). An unknown view prints
`No view "<v>" in <file>; views: <ids>` on stderr, exit 1. An invalid file is
reported as by `validate`, exit 1.

## `archdrawer migrate <file>`

Rewrites an `archdraw/diagram@1` file in the current format (drawing
contract, Reading `archdraw/diagram@1`), prints each conversion warning, then
`migrated`; exit 0. A file already in the current format prints
`already archdraw/diagram@2`, exit 0. Not JSON: `ERROR json: <message>`; any
other schema: `ERROR schema: not an archdraw drawing`; exit 1.

## `archdrawer status` and `archdrawer stop`

`status` prints `running on http://127.0.0.1:<port> (pid <pid>)` when the
server in `server.json` answers health, else `not running`; exit 0. `stop`
sends that server `POST /api/shutdown` with its token, waits up to 5 s until it
no longer answers, and prints `stopped` (or `not running`); exit 0.

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
