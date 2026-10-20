# Contributing to Archdrawer

Thanks for your interest. Archdrawer is young and changing fast, so a short
conversation in an issue before a large change saves everyone time.

## Find something to work on

- Work is tracked in [GitHub issues](https://github.com/brkakyldz/Archdrawer/issues),
  grouped into milestones. Issues labelled `good first issue` are small and
  need no AI engine.
- Comment on an issue before you start, so two people do not do the same work.
- For a bug fix, open a pull request directly. For anything bigger, agree on
  the approach in the issue first.

## Set up

You need Node 20.19 or newer. You do not need Claude Code or Codex: the test
engine stands in for them.

```bash
npm ci
npx playwright install chromium
ARCHDRAW_ENGINES=fixture npm start
```

In PowerShell, set the variable first: `$env:ARCHDRAW_ENGINES = "fixture"`,
then `npm start`. The app then runs at `http://127.0.0.1:4317`. The environment variables are
described in [`docs/contracts/testing.md`](docs/contracts/testing.md).

## Make a change

1. Read [`AGENTS.md`](AGENTS.md). It holds the rules every change follows,
   including the invariants that keep the app safe and the editor and export
   in agreement. It is written for people and coding agents alike.
2. Branch from `main`. One issue per pull request.
3. Test each behaviour once, at the lowest layer that can observe it: pure
   logic in a `*.test.ts` file next to the code, browser behaviour in
   `tests/e2e/`.
4. If your change touches an interface, update its contract in
   `docs/contracts/`. A requirement that changes is updated in
   `docs/spec.md`.

### Acceptance scenarios

The scenarios in `tests/acceptance/holdout/` are written by an independent
author who sees the requirements and contracts but not the code. Do not edit
them in your pull request. If your change alters what a user sees or does,
the maintainer adds or updates scenarios on your branch before merging, so
keep "Allow edits by maintainers" switched on. If a scenario looks wrong, say
so in the pull request or an issue.

## Before you open a pull request

```bash
npm run check   # types and unit tests
npm run e2e     # when the web client changed
```

`npm run holdout` runs the acceptance scenarios. It takes several minutes,
and CI runs it on every pull request, so running it locally is optional.

In the pull request, write `Closes #<issue>`, say how you checked the change
and add before and after screenshots when something visible changed.

## What happens next

- CI runs types, unit tests and the build on Ubuntu and Windows, and the
  browser suites on Ubuntu. For a first-time contributor, CI starts once the
  maintainer approves the run.
- A change to the Claude Code or Codex adapters also gets a live run with a
  real engine by the maintainer, since CI only uses the test engine.
- Pull requests are squash-merged, so your branch becomes one commit on
  `main`.

## Using a coding agent

You are welcome to. `AGENTS.md` is written to be read by Claude Code, Codex
and similar tools. You are responsible for the diff you submit, so read it
before you open the pull request.

## License

By contributing, you agree that your contribution is licensed under the
[MIT License](LICENSE) of this project.
