---
id: 0004
title: The plugin is the main way in, and it opens the app; the app runs the pipeline
date: 2026-10-19
status: accepted
deciders: [brkakyldz]
supersedes: []
---

## Context

Today a Claude Code or Codex session with the plugin draws the file itself
under the skill's rules, and the app only opens and edits it. The staged
pipeline (ADR 0002) needs focus and channel choices and several engine calls;
doing that both in the app and in a chat session would mean two pipelines.

## Decision

Installing the Claude Code or Codex plugin is the main install path. In a
session, the plugin's command opens the app on the current repository; focus
and channel are chosen in the app, and the app runs every stage through the
user's own CLI. The `archdrawer` command stays for opening, validating and
exporting files. First launch shows a ready-made example drawing and its
presentation, and checks that `claude` or `codex` is installed and signed in.

## Rationale

One pipeline is tested and maintained once; two drift until the same request
draws differently depending on where it was typed. The app is also where the
choices are easiest to make and the result is seen immediately.

## Alternatives considered

| Alternative | Why not |
|---|---|
| The session runs the stages and asks the questions in chat | A second pipeline beside the app's |
| `npx archdrawer` as the main path | Needs an npm release; the plugin reaches the same users inside their agent |
| A desktop app | Easiest to start, heaviest to build and sign per platform |
| Clone and `npm ci` | Too long for a first try |

## Consequences

- **Upside:** one path from install to first drawing; the example shows the
  value before any wait.
- **Cost:** the home screen needs a repository start flow again; the skill's
  drawing instructions are retired once the app pipeline lands.
- **Cost to reverse:** medium.
