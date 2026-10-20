# Waymark playbooks for agent workflows

Tool names are the MCP base names (`waymark_<x>`); the CLI twin is `node <skill>/scripts/wm.mjs <command>` (see [tools.md](tools.md)). Pass `root` (absolute repo path) when needed.

---

## A. Before modifying code ("understand first")

1. For each file you plan to touch: `waymark_for_file(path, line?)`.
   - Read the trace tree it returns, the **explanation of the nearest node** and any **team notes**.
   - If a node is flagged `⚠ code changed…`, the prose is older than the code: read the code itself.
2. Need more than the file's slice? `waymark_get(id, trace: "<n>")` (one trace) or `node: "<id>"` (one node with its parent/children and links).
3. No map covers the area and the flow spans several files → consider creating one (playbook B). For a one-file change, skip it.
4. Use what you learned: callers in the tree are what your change can break; `links` between traces show data flowing to other subsystems.

In Claude Code with Waymark hooks installed, steps 1–2 happen automatically when you read or edit a covered file (the context appears next to the tool result).

## B. Create a map for a topic

1. `waymark_start(query, mode)` — modes: `fast` (quick, 1-3 traces), `smart` (default, full storytelling), `parallel` (big topics), `overview` (whole system). It returns the procedure: follow it exactly.
2. Explore read-only, pick anchored nodes, build the annotated tree, write the prose (see [map-format.md](map-format.md)).
3. `waymark_create({...map})`. Fix any `unresolved`/`missing` anchors (`waymark_find_anchor` gives exact lines) and resubmit with the same `id`. Fill missing narrative with `waymark_annotate`.
4. `waymark_lint(id)` → fix errors.
5. Optional but recommended for maps others will rely on: fact-check (playbook F).

**Parallel (3+ traces):** `waymark_start(query, mode: "parallel")` → `waymark_plan` returns one builder prompt per trace → run one subagent per trace **concurrently**, each calls `waymark_add_trace(draft, n, trace)` → `waymark_draft(draft)` → `waymark_finalize(draft, description, story, links)`. Without subagents: `wm generate "<topic>" --parallel --jobs 4`.

## C. After changing code (keep maps true)

1. `waymark_verify(fix: true)` — re-anchors moved lines, follows renamed files, reports broken anchors and **narrative drift**.
2. Broken anchors (`unresolved`/`missing`): the code the node described is gone → update the map structure with `waymark_create(id, …)` (keep the other prose).
3. Drift (`narrative.nodes/traces/story`): `waymark_refresh(id)` lists exactly what to review → rewrite with `waymark_annotate`, or confirm unchanged prose with `reviewed: ["2b", "trace:1", "story"]`.
4. New behaviour that matters (a new step in the flow)? Add a node via `waymark_create(id, …)`.
5. `waymark_lint` → 0 errors before you finish.

## D. Review a pull request / branch

1. `waymark_diff(base: "origin/main", range: true)` (or the PR's base).
2. For every touched node: is the change consistent with what the node's explanation says the code is for? Mismatches are review findings.
3. Broken anchors / stale prose in the report: ask the author to run `/waymark refresh <id>` (or do it if you own the branch).
4. The `waymark-pr` GitHub Action (`wm install --pr-action`) posts this report on every PR automatically.

## E. Debug a failure / incident

1. Collect the files and lines from the stack trace or logs.
2. `waymark_for_file(path, line)` for each → which trace and which node is failing; read the node's explanation and its parent/children (`waymark_get(id, node)`).
3. Follow the trace's tree upstream (callers) to find where bad data could originate; `links` show cross-subsystem inputs.
4. Prove the executed path: `waymark_exec(id, command: "<test that reproduces the bug>")` → ▶ nodes ran, ○ did not. A node you expected to run but is ○ is a strong lead.
5. After the fix: playbook C.

## F. Fact-check a map (before relying on it for a risky change)

1. Delegate to a **fresh** subagent/session (it must not be the agent that wrote the map): give it `waymark_check(id)` output — the procedure plus the map with snippets.
2. It verifies each claim against the code, fixes wrong prose with `waymark_annotate`, and records verdicts with `waymark_record_check` (`supported` / `partial` / `unsupported` + issues).
3. Without subagents: `wm check <id>` (runs a separate headless agent).
4. `waymark_lint` reports `unsupported` as errors and `partial` as warnings.

## G. Plan or write tests

1. `waymark_exec(id, command: "npm test")` (Node, V8 coverage) or `waymark_exec(id, lcov: "coverage/lcov.info")` (any language).
2. `waymark_get(id, format: "compact")` → nodes marked `○ not executed` are documented paths no test exercises.
3. Write tests for those paths first (they are, by construction, important steps of real flows). Re-run step 1 to confirm ▶.

## H. Refactor, rename, move

1. Before: playbook A for the area; note every trace that passes through the code.
2. After: `waymark_verify(fix: true)` (renamed/moved files and moved lines are followed automatically), then playbook C for drift and broken anchors.
3. If the refactor changed the shape of the flow (new layers, merged functions), update the tree with `waymark_create(id, …)`.

## I. Onboarding / explaining the repository

1. `waymark_list` → start from maps of `kind: "overview"` (map of maps); `.waymark/index.html` shows all maps with their health.
2. `waymark_get(overviewId)` → each node's `→ detailed map` link points to the map that explains that part.
3. No overview yet: `waymark_start(query, mode: "overview")` → it links nodes to existing maps (`mapRef`) and lists "maps to create next".
4. For humans: `waymark_render(id, open: true)` opens the interactive viewer (story, guides, explanations, code, diagram).

## J. Hand-off and documentation

1. Point to the map id, its viewer (`.waymark/<id>.html`, works offline) and the resource `waymark://<id>`.
2. Decisions, gotchas, links to tickets → **team notes**, only when the user asks: `waymark_note(id, node, text, author)`.
3. Commit `.waymark/` with the code so maps travel with the repository.

## K. CI and automation (no agent in the loop)

- `wm verify --strict` (fail on moved/broken anchors), `wm verify --strict-narrative` (also fail on stale prose), `wm lint` (fail on broken references / unsupported claims), `wm diff <base> --range --fail-on drift`.
- `wm install --pr-action` adds the PR comment workflow.
