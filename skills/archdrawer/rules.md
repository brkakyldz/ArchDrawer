# Drawing a repository's architecture (archdraw/diagram@2)

You write one JSON file that an editor opens. The drawing must carry the real
architecture, read from the code — at the same depth for any repository:

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
  own drawing gets `detail`: the id of another view in `views`, drawn by the
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
- **Nothing is lost.** A component moved into a detail view keeps its id, its
  content, its files and its connections there. A part that stands for several
  components lists their ids in `from`, and keeps the `from` they already had.

Size: 8–20 components per detail view including those inside groups. Merge
small helpers into what they serve; leave out tests and build scripts.

## The file

```json
{
  "schema": "archdraw/diagram@2",
  "title": "Hotel Operations Agent",
  "views": [
    {
      "id": "overview",
      "title": "Overview",
      "caption": { "title": "Runtime architecture of the hotel agent", "lede": "One sentence that tells the story." },
      "nodes": [
        { "id": "runtime", "label": "Agent runtime", "kind": "llm", "form": "group", "icon": "cpu", "sub": "OpenAI Agents SDK",
          "items": [], "description": "…", "files": ["src/agent/"], "parent": null, "detail": null, "place": { "row": 0, "col": 3 },
          "lane": { "spine": 3 }, "from": [] },
        { "id": "llm", "label": "LLM", "kind": "llm", "form": "compact", "icon": "spark", "sub": "",
          "items": [], "description": "…", "files": [], "parent": "runtime", "detail": null, "place": null,
          "lane": { "spine": 0 }, "from": [] },
        { "id": "gateway", "label": "Tool gateway", "kind": "gate", "form": "panel", "icon": "shield", "sub": "every call passes here",
          "items": ["Schema validation", "Scope re-check", "Typed errors"], "description": "…", "files": ["src/tools/gateway.py"],
          "parent": null, "detail": null, "place": { "row": 0, "col": 4 },
          "lane": { "spine": 4 }, "from": [] }
      ],
      "edges": [
        { "from": "runtime", "to": "gateway", "label": "", "style": "call", "both": true, "step": 4 }
      ],
      "texts": []
    }
  ]
}
```

Every property shown is required, except `lane` and `from`, which default to
`null` and `[]`; use `null`, `""` or `[]` for none. Leave
`texts` empty: titles and remarks on the canvas are the user's to add.

- `kind`: actor (a person or role), client (browser, app, CLI the user
  touches), api (an HTTP/RPC surface), service (code this repo owns that
  decides or does work), worker (background job, scheduler, consumer), llm
  (a model call or an agent loop), external (a third-party API or service),
  ops (monitoring, tracing, evaluation), gate (a check: auth, validation,
  policy, approval rule), data (database, cache, queue, file store, log).
- `form`: card (a plain component), compact (a small part, mostly inside a
  group), panel (a component with `items`), group (a component holding other
  components; only a group may be a `parent`).
- `icon`: null for the kind's default, or one of: user, users, clipboard,
  monitor, window, zap, timer, spark, cloud, shield, scale, layers, bell, db,
  chat, loop, book, pen, receipt, inbox, box, cpu, cog, globe, key, lock, mail,
  file, folder, terminal, code, server, queue, search, chart, eye, git, plug.
- `label` ≤ 48 characters, `sub` ≤ 60, each item ≤ 44, `description` ≤ 400.
- Ids: letters, digits, `_` and `-`, unique across the whole file.
- Components inside a group get `place: null`.
