---
id: 0009
title: "A story answer states its limits, gets one repair turn, and is never lost to a length"
date: 2026-10-22
status: accepted
deciders: [brkakyldz]
supersedes: []
---

## Context

A user started a draw and got `The engine's post cannot be drawn: the
description is 249 characters, over the file's 240; ask for a shorter post`
(#82). The user chose none of that text and had nothing to shorten.

- The story prompt of the overview, README and presentation stated none of the
  hard limits code enforces on a story answer; the post prompt stated smaller
  targets, but not the zone label. The answer schema carried no `maxLength`.
- The overview brief allowed 60 parts while every zone also becomes a part, so
  a valid-looking answer could overflow the view.
- A hard limit over or a relation violated failed the run. In a draw that is
  the second or third engine call, so the read was lost with it.
- The diagram contract had two policies for one overrun: a story answer failed,
  while the repair of a full-drawing answer and the read answer shortened the
  text with `…` and one warning.

A spike (2 live Claude Haiku calls, Claude Code 2.1.303): asked for a lede of
about 300 characters under a schema with `maxLength: 40`, `claude -p
--json-schema` answered 35 and 39 characters, with no error: complete, shorter
sentences ("Repo in, architecture diagrams out."). A second spike (3 live Codex
calls, codex-cli 0.162.1, the adapter's `exec --json --sandbox read-only
--output-schema`): Codex accepts `maxLength` and holds it by cutting. Under
`maxLength: 40` both answers were exactly 40 characters and stopped
mid-sentence ("This web shop helps shoppers browse and "). Under the full story
schema the lede stopped at exactly 240 with no end, and a connection label at
exactly 40.

## Decision

Exact shapes are in `docs/contracts/` (diagram, api, testing).

- **The engine is told every limit.** Every story and post prompt states each
  hard limit of a story answer, generated from the same constants the code
  checks. The overview brief counts zones in a view's 60 parts. Post targets
  stay targets, stated as now.
- **The schema carries the text limits.** `STORY_SCHEMA` gives every text
  field its hard limit as `maxLength`. The Codex adapter removes `maxLength`
  from the schema it writes: Codex would cut the text at the limit
  mid-sentence, with no `…` and no warning, and the cut answer would pass
  every check, so no repair turn would come. Without it, an over-long Codex
  text reaches the repair turn like any other.
- **One repair turn.** Code checks a story answer for every problem at once:
  each text over its hard limit and each relation violated. With any, the
  engine gets one more call: its answer and the list of problems, quoted as
  data, and the same schema. Claude Code gets no tool; Codex, which has no
  tool-free mode, stays in its read-only sandbox and is told to read nothing.
  The call runs within the run's one deadline, with no time added. Every
  story answer gets it: story, post, a draw's overview and channel, and a
  revise's story (without the image). The second answer replaces the first
  and is checked again in full. The engine still writes every word it can.
- **A length never fails a run.** A text still over its limit after the repair
  turn is shortened with `…`, one warning each, as the repair of a
  full-drawing answer already does. A part with more than 12 rows keeps the
  first 12 with one warning, as now, also when the chips alone are more than
  12; that is not a problem for the repair turn.
- **A relation the second answer violates fails the run**, whether or not
  the first answer did, naming every violation and the channel: `The engine's
  <channel> cannot be drawn: …`. Code does not guess a story. That includes a
  story over a view's 60 parts, which the repair of a full-drawing answer cuts
  with a warning: cutting a part of a story breaks the spine, zones and
  holders built around it.
- An answer that does not match the schema's shape fails as before; the
  engines' structured output makes it rare.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep failing, only fix the prompts | The engine still overruns now and then, and the user can do nothing but run it all again |
| Shorten at once, no repair turn | Code cuts the engine's sentence mid-thought where one cheap call lets the engine say it shorter |
| Repair turns until the answer is clean | No bound on calls or time; one turn and then a fixed rule is predictable |
| Code repairs relations (renumber a spine, drop a zone) | Code would guess the story the engine meant (ADR 0007's split between what is told and what is placed) |

## Consequences

- **Upside:** an engine's overrun no longer costs the user the run; prompts
  and code share one set of numbers; one policy for over-long text across
  every answer.
- **Cost:**
  - up to one more engine call per story answer: a draw makes three to five,
    a story-route refine two to three, a post, story or revise one or two
    (ADR 0007 counted three and two);
  - that call's time comes out of the run's one deadline, so a slow first
    answer leaves less for the repair turn;
  - a story answer's checks collect problems instead of stopping at the first;
  - the fixture engine answers a repair turn, with two new markers;
  - `runs.test.ts` and `intent.test.ts` change where they expect a broken
    post to fail; no held-out scenario does. The independent author is needed
    only for scenarios on `[fixture:overlong]` and `[fixture:stubborn]`.
- **Cost to reverse:** low — a prompt section, a schema keyword and one extra
  call; the file format does not change.
