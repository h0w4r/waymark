---
name: waymark
description: Waymark commands the user runs directly (/waymark <topic> | list | show | check | refresh | diff | exec | note | overview | enrich | verify | lint) to create, read, fact-check and maintain narrated, line-anchored maps of how code executes. Use when the user invokes /waymark or $waymark, asks to create/show/check a code map, or mentions waymark://<id>. For using maps while doing other work (editing, debugging, reviewing), see the using-waymark skill.
argument-hint: "<topic> [--fast] | list | show <id> | enrich <id> | refresh <id> | lint | verify [id] | from-chat"
---
# Waymark

Arguments: $ARGUMENTS


Maps live in `.waymark/<id>.json` plus a self-contained `.waymark/<id>.html` viewer at the repo root. All writing goes through the `waymark` MCP server tools (`waymark_*`); never hand-edit those files.

Always pass `root` = the absolute path of the current workspace to `waymark_*` tools when the server may be installed globally (e.g. Codex desktop).

## Modes (the text after `$waymark` / `/waymark`)
- **empty** → `waymark_suggest_topics`; offer the top suggestions (plus "map what we discussed" if code was discussed) and ask which to build.
- **list** → `waymark_list`; show id, title, nodes, updated.
- **show <id>** → `waymark_get` with `format: "compact"`; summarize and point to `.waymark/<id>.html`.
- **verify [id]** → `waymark_verify` with `fix: true`; report moved/relocated/broken anchors.
- **refresh <id>** → bring prose back in sync after code changes: `waymark_refresh(id)` lists nodes/guides whose code changed since they were written (and broken anchors); rewrite them with `waymark_annotate` or confirm them with `reviewed`.
- **lint [id]** → `waymark_lint`; report errors (unknown [refs]) and warnings (missing narrative, uncited nodes…) and offer to fix them.
- **check <id>** → fact-check the map: delegate to a **fresh** `waymark` subagent (it must not be the one that wrote the map) with the procedure from `waymark_check(id)`; it fixes wrong prose and records verdicts with `waymark_record_check`. Report supported / partial / unsupported.
- **diff [base]** → `waymark_diff` (uncommitted changes by default; `range: true` for a branch/PR vs base): which nodes the change touches, which anchors break and which prose goes stale; offer `refresh`.
- **note <id> <node> <text>** → `waymark_note` (human knowledge, never rewritten by agents). Only when the user asks.
- **exec [id]** → mark nodes executed by the tests: `waymark_exec` with `command` (Node: e.g. "npm test") or `lcov` (path to an lcov.info from any language).
- **overview** → build the "map of maps": `waymark_start(query, mode: "overview")`; nodes link to detailed maps with `mapRef`; `kind: "overview"`.
- **enrich <id>** → add the storytelling layer to an existing map: `waymark_enrich(id)` returns the procedure and what is missing; write the story, Motivation/Details per trace and an explanation per node, save with `waymark_annotate`.
- **from-chat** → build a map of the code paths discussed in this conversation (derive the topic yourself).
- **anything else** is a topic → create a map (below). `--fast` in the text → `mode: "fast"`; otherwise `"smart"`.

## Create a map
1. Call `waymark_start(query, mode)`: it returns the full Waymark agent procedure (structure **and** storytelling rules), the input format, repo hints and existing maps. Follow it exactly.
   - If subagents are available (Claude Code `waymark` agent, Codex `waymark` custom agent), delegate the exploration to it.
   - **Big topics (smart mode, 3+ traces): build in parallel.** `waymark_start(query, mode: "parallel")` → `waymark_plan` returns one builder prompt per trace → launch one `waymark` subagent per trace **in the same message** (they run concurrently; each calls `waymark_add_trace`) → read `waymark_draft` → `waymark_finalize` with the description, story and links.
2. Explore **read-only** (Read/Grep/Glob, or `rg` / `sed -n` / `git grep` in the shell). Every location must be a line you actually read.
3. Write the prose as a story for a new teammate, in the user's language: map summary + holistic **story**; per trace **motivation** (why it exists) and **details** (narrative walkthrough citing [1a]); per location a one-line **description** and a 3-6 sentence **explanation**.
4. Submit with `waymark_create`; fix `unresolved`/`missing` anchors and resubmit with the same `id`; fill any missing narrative it reports with `waymark_annotate`.
5. Reply with the id, the HTML path and a short summary; offer `waymark_render(id, open: true)` (map pane with "See more" guides and "Explain" per node, code view, interactive diagram).

## Use a map as context
- Claude Code: `@waymark:waymark://<id>`, or just one trace / node: `@waymark:waymark://<id>/2`, `@waymark:waymark://<id>/2b`. Any harness: `waymark_get(id, trace?, node?)` (`format: "compact"` for structure only).
- About to change a file? `waymark_for_file(path, line?)` tells which flows it belongs to (the Waymark hooks inject this automatically in Claude Code).
- Before trusting an old map: `waymark_verify(id, fix: true)` — it also reports **narrative drift** (prose written for code that has since changed).
- After changing code a map covers, run `waymark_refresh(id)` and update the prose that no longer holds.

## Without MCP (CLI fallback)
`waymark guide "<topic>"` prints the procedure; write the map as JSON and run `waymark create map.json`. Also `waymark show <id> --format compact`, `waymark verify --fix`, `waymark list`.
