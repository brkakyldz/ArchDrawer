# Drawing a repository's architecture (archdraw/diagram@3)

You write one JSON file that an editor opens. It holds two things: the
**facts** — what the system is made of and who talks to whom, read from the
code — and the **overview drawing** of those facts. The editor draws the
LinkedIn, README and presentation versions from the same facts later. The
drawing must carry the real architecture, at the same depth for any
repository:

- **What each component holds.** A component whose code shows distinct
  mechanisms lists them as `items` in a `panel` (e.g. a tool gateway: "Schema
  validation", "Scope re-check", "Idempotency key", "Typed errors", "Audit
  event"). Items name mechanisms, rules or contents, 2–5 words each.
- **Components inside components.** When one component runs an inner loop or
  owns sub-parts that talk to each other, make it a `group` and put the parts
  inside it with `parent` (e.g. an agent runtime holding LLM → tool proposal →
  execute → tool result, with the loop's connections).
- **A two-dimensional shape, never a left-to-right pipeline.** The main path
  (the request that defines the system) runs along row 0, left to right, with
  `step` 1, 2, 3 … on its connections. Side paths sit above (row -1, -2:
  notifications, approvals, schedulers) or below (row 1, 2: stores, logs,
  observability, evaluation). Give every top-level component a `place`
  {row, col}; col counts from 0 at the left.
- **Connections say how things talk.** `style`: `call` (a request the caller
  waits on, or data handed over), `async` (an event, queue, outbox or
  background trigger — drawn dashed), `dep` (telemetry, logs or a read-only
  dependency — dotted). `both: true` when the two sides exchange in both
  directions (request and typed result); never draw a second reverse
  connection. Label a connection only when the label adds something ("pending
  request", "decision", "emit"); repeat no label.
- **No tuning numbers.** Leave out limits, timeouts, counts and sizes ("6
  turns", "90 s", "2 retries"). They change; the architecture does not.
- **Every component explains itself.** `description`: 1–3 plain sentences on
  what it is for and what it guarantees, for a reader new to the code.
  `files`: repository-relative paths you actually opened that implement it.
- **Finer detail lives one level down.** A component whose inside deserves its
  own drawing gets `detail`: the id of another overview view, drawn by the
  same rules.

- **Items are names, not sentences.** 2–5 words each ("Schema validation",
  "Idempotency key"), at most 6 per panel. A thought that needs a verb goes in
  the `description`.
- **Two-way is the exception.** `both: true` only when the answer coming back
  is part of the architecture (a typed result, a decision, a stream of
  events). An ordinary call that returns a value is one-way, caller → callee.
- **Loops live inside their owner.** An agent loop, a retry loop or a
  pipeline of stages owned by one component is drawn inside that component as
  a group, with the loop's own connections between its parts.
- **At most five columns.** Use `col` 0–4. A main path longer than five
  components continues on a second band below (rows 2–3), again from col 0;
  keep its side parts next to the step they serve.
- **Go one level down when a component is big.** When a component holds more
  than about six parts of its own, give it `detail`: a second view with those
  parts, drawn by the same rules.

## The overview is a map

The first view is the overview. It is a map of the system, not its full
inventory:

- **4–6 zones.** Its top-level components are groups (zones) that hold what
  belongs together: the entry points, the runtime with its loop, the stores.
- **At most about 15 connections** in the whole view, zone interiors
  included. A connection the reader needs only for the detail lives there.
- **A `lane` on every top-level component**, and on the parts inside a zone.
  The main request path gets `{"spine": 0}`, `{"spine": 1}` … in order. A part
  that serves one spine part sits beside it: `{"anchor": "<that part's id>",
  "side": "above"}` for people, approvals, notifications and schedulers,
  `"below"` for stores, logs, observability and evaluation. `lane` places a
  part before `place` does.
- **Detail goes one level down.** What does not fit the map goes into a view
  reached by a zone's or component's `detail`; that view is drawn by the rules
  above, at full depth, with no zone target.
- **Nothing is lost.** Every component fact is drawn by at least one part of
  the overview or its detail views. A component moved into a detail view keeps
  its fact, its files and its relations. A part that stands for several
  components lists their facts in `facts` and gives its own `label`, `kind`
  and `description`.

Size: 8–20 components per detail view including those inside groups. Merge
small helpers into what they serve; leave out tests and build scripts.

## The file

```json
{
  "schema": "archdraw/diagram@3",
  "title": "Hotel Operations Agent",
  "facts": {
    "components": [
      { "id": "runtime", "label": "Agent runtime", "kind": "llm", "sub": "OpenAI Agents SDK", "description": "Runs the agent loop for every guest request.",
        "files": ["src/agent/"], "items": [] },
      { "id": "llm", "label": "LLM", "kind": "llm", "sub": "", "description": "Chooses the next step from the conversation so far.",
        "files": [], "items": [] },
      { "id": "gateway", "label": "Tool gateway", "kind": "gate", "sub": "every call passes here", "description": "The only way the agent reaches a tool.",
        "files": ["src/tools/gateway.py"], "items": ["Schema validation", "Scope re-check", "Typed errors"] }
    ],
    "relations": [
      { "id": "r1", "from": "runtime", "to": "gateway", "label": "", "style": "call", "both": true }
    ]
  },
  "channels": {
    "overview": {
      "views": [
        {
          "id": "overview",
          "title": "Overview",
          "caption": { "title": "Runtime architecture of the hotel agent", "lede": "One sentence that tells the story." },
          "nodes": [
            { "id": "runtime", "facts": ["runtime"], "form": "group", "icon": "cpu", "parent": null, "detail": null,
              "place": { "row": 0, "col": 3 }, "lane": { "spine": 3 } },
            { "id": "llm", "facts": ["llm"], "form": "compact", "icon": "spark", "parent": "runtime", "detail": null,
              "place": null, "lane": { "spine": 0 } },
            { "id": "gateway", "facts": ["gateway"], "form": "panel", "icon": "shield", "parent": null, "detail": null,
              "place": { "row": 0, "col": 4 }, "lane": { "spine": 4 } }
          ],
          "edges": [
            { "from": "runtime", "to": "gateway", "relations": ["r1"], "step": 4 }
          ],
          "texts": []
        }
      ]
    }
  }
}
```

**Facts** (`facts.components`, `facts.relations`) say what is true: every
property shown is required; use `""` or `[]` for none. A component's `items`
are what it holds; a part with form `panel` shows them. A relation joins two
component facts, once per pair (`both: true` for two-way).

**The overview** (`channels.overview.views`) draws the facts. A part (`nodes`)
points to the fact it shows with `facts: ["<id>"]` and carries only how it is
drawn: `form`, `icon`, `parent`, `detail`, `place`, `lane` (optional,
default `null`). Give it the fact's id. A connection (`edges`) joins two parts
of its view and names the relation it shows in `relations`, plus its `step`.
Leave `texts` empty: titles and remarks on the canvas are the user's to add.
Leave out the other channels: the editor draws them from the facts.

- `kind`: actor (a person or role), client (browser, app, CLI the user
  touches), api (an HTTP/RPC surface), service (code this repo owns that
  decides or does work), worker (background job, scheduler, consumer), llm
  (a model call or an agent loop), external (a third-party API or service),
  ops (monitoring, tracing, evaluation), gate (a check: auth, validation,
  policy, approval rule), data (database, cache, queue, file store, log).
- `form`: card (a plain component), compact (a small part, mostly inside a
  group), panel (a component whose fact has `items`), group (a component
  holding other components; only a group may be a `parent`).
- `icon`: null for the kind's default, or one of: user, users, clipboard,
  monitor, window, zap, timer, spark, cloud, shield, scale, layers, bell, db,
  chat, loop, book, pen, receipt, inbox, box, cpu, cog, globe, key, lock, mail,
  file, folder, terminal, code, server, queue, search, chart, eye, git, plug.
- `label` ≤ 48 characters, `sub` ≤ 60, each item ≤ 44, `description` ≤ 400.
- Ids: letters, digits, `_` and `-`. Fact ids (components and relations) are
  unique among facts, view ids across the file, part and connection ids within
  the overview.
- Components inside a group get `place: null`.
