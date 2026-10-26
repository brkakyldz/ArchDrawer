---
id: 0017
title: "Sources: recent and found repositories, the system's folder dialog, a repository from a link"
date: 2026-10-26
status: accepted
deciders: [brkakyldz]
supersedes: []
---

## Context

The home screen starts a drawing from a folder whose whole absolute path the
user types or pastes; its list offers only the folders of drawings already in
the library (ADR 0007). A repository on GitHub cannot be drawn at all: the
spec lists "GitHub URLs as a source" as out of scope.

A page cannot fix the first by itself. A browser never gives a page the path
of a folder picked in an `<input type="file">` or dropped on it, so a folder
tree or a drop zone in the page cannot name a folder to the server. The
server, which runs on the user's own machine, can: it can open the operating
system's own folder dialog and it can look for git repositories on the disk.

This ADR extends ADR 0007's "the folder is typed or pasted, or picked from
the folders of the drawings already in the library", and AGENTS.md
invariant 1, which gains a fourth user input reaching a program's arguments:
the link. Everything else in ADR 0007 stands; a cloned repository is a folder
like any other once it is copied, and its drawing is written into it as
ADR 0007 says.

## Decision

Exact shapes are in `docs/contracts/` (api, testing). The owner took the
recommended option, (a), of each of the five questions of issue #192 on
2026-10-26.

1. **Where repositories are found.** *Recent* lists the folders scanned or
   drawn before. *Found on this computer* lists the git repositories found
   below the home folder, below the usual code folders under it (`code`,
   `src`, `projects`, `repos`, `dev`, `Documents/GitHub`) and below the parent
   folder of each drawing's repository in the library, at most two levels
   deep, at most 50, made again at most every five minutes. Each entry shows
   its name, path, branch and the age of its last commit.
2. **Which links.** `https` links of github.com, gitlab.com and bitbucket.org,
   to a repository (`<owner>/<repo>`) and optionally a branch
   (`/tree/<branch>`, or that host's own form). A private repository works
   when the user's own git already holds a sign-in for it. Archdrawer never
   asks for, reads or keeps a password: git runs with every prompt off, and a
   link carrying a user name or password is refused.
3. **How much is cloned.** One commit (`--depth 1`) of the default branch, or
   of the branch the link names. The scan cache is per commit and the reading
   needs no history.
4. **The cache.** A copy lives under archdrawer's data folder at
   `repos/<host>/<owner>/<repo>`, one per repository, and its drawing is
   written into it. A later scan of it fetches the newest commit first: of
   the branch a link names, of the default branch when a link names none,
   or of the copy's own branch when the copy is chosen as a folder. While a
   drawing or an instruction is using the copy it is not updated, and a link
   asking for another branch is refused rather than scanning the wrong one. A copy stays until the user removes it: `Remove from list` on its
   drawing, or on its entry in *Recent*, offers to delete the copy too.
5. **No dialog available** (Linux without `zenity` or `kdialog`, a machine
   with no desktop). `Choose folder…` is not shown; pasting a path stays.

And, so every one of these is observable in tests without a desktop or a
network:

6. **The dialog and the clone have test stand-ins**, as the fixture engine
   stands in for an engine (AGENTS.md invariant 7). `ARCHDRAW_TEST_PICKER`
   names a file whose content is what the dialog answers;
   `ARCHDRAW_TEST_REMOTES` names a folder of local git repositories a link is
   cloned from. Both are off unless their variable is set; only the dialog or
   the network is replaced, everything after it runs as for a real one.
7. **The clone is part of the scan.** A scan given a link copies or updates
   the repository before it gathers its inputs, in the scan's progress and
   cancel. The copy holds no engine slot (ADR 0016) and its deadline starts
   when the scan is accepted; the engine's deadline starts when the scan
   gets its slot. One scan at a time per copy. A failed or cancelled copy
   leaves nothing in the cache.

## Rationale

The system's own dialog is the one way a click can give the server a path:
it runs on the user's machine, under the user's account, and answers a real
path the server then checks as it checks a typed one. The modern Explorer
picker, Finder's `choose folder` and `zenity`/`kdialog` are what users of
each system already know.

The lists answer the common case with no dialog at all: most people draw a
project they drew or scanned before, or one in the folder where they keep
code. Two levels and 50 results keep the search to a second or two on a
large home folder; five minutes keeps the list fresh enough without walking
the disk on every load.

Copying a repository into the cache, not into a folder the user chooses,
needs no question and keeps the user's own folders untouched. One commit is
enough: the scan cache is keyed by commit, the read needs only the files, and
a shallow copy of a large repository is fast. Writing the drawing into the
copy keeps ADR 0003's "a drawing is one file in its repository" true for a
link too, so registration, outside changes, evidence checks and exports need
nothing new.

Taking only https links of three hosts, rebuilding the URL from the checked
host, owner and repository and passing it after `--`, is what keeps the link
from reaching git as an option or another transport (`ext::`, `file://`,
`--upload-pack=`). Turning every prompt off keeps a private repository from
hanging the scan on a password window the user never sees.

## Alternatives considered

| Alternative | Why not |
|---|---|
| A folder tree or drop zone inside the page | A browser never gives a page the path; the server could only show its own tree, a second, worse file browser |
| (1b) Only folders drawn or picked before | Nothing to click on a first launch |
| (1c) Folders the user lists in a setting | A setting before the first drawing; the usual code folders cover most machines |
| (2b) github.com only | GitLab and Bitbucket links read the same way for little more |
| (2c) Any git URL, `ssh` included | `ssh` can prompt for a key passphrase or a host key, and any URL widens what reaches git's arguments |
| (3b) The whole history | Slow on a large repository; nothing reads it |
| (4b) A size limit removing the least recently used copies | A drawing would lose its repository behind the user's back |
| (5b) Show `Choose folder…` and explain why nothing opens | A button that never works |
| A copy per branch (`<repo>@<branch>`) | A second folder for each branch; one copy follows the branch the latest link asked for, the default branch when it named none |

## Consequences

- **Upside:**
  - a local repository is chosen by a click, with no path to type;
  - a public repository is drawn from its link, with nothing to install;
  - a copy's drawing is a drawing like any other: it opens, saves, follows
    outside changes and exports as today.
- **Cost:**
  - three platform helpers for the dialog, each checked live once (#198,
    Windows first);
  - a clone path with its own errors and a cache that grows until the user
    removes copies;
  - a fourth user input reaching a program's arguments (AGENTS.md
    invariant 1), with its own silent failures to guard;
  - two test switches the browser suites set.
- **Cost to reverse:** low. The lists, the dialog and the link are additions;
  removing them leaves a typed or pasted folder, as before. Copies already in
  the cache stay folders like any other.
