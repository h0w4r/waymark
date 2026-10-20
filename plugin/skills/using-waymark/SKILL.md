---
name: using-waymark
description: Use whenever the repository has a .waymark/ folder (or the waymark MCP tools are available) and you are about to modify, debug, review, refactor, test or explain code: it tells you which documented flows a file, line or diff belongs to, what each step does and why, and what to keep true. Also use after changing code (verify/refresh the maps it touched), when reviewing a PR, onboarding, or handing off. Prefer it over grepping .waymark/*.json by hand. Works through the waymark MCP tools or, without MCP, through scripts/wm.mjs (CLI).
---
<!-- waymark:managed -->
# Using Waymark in agent workflows

Waymark keeps **maps of how code executes**: traces of numbered nodes (`1a`, `2b`…) anchored to exact lines, an annotated call tree, and storytelling prose (map story, per-trace *Motivation/Details*, per-node *explanation*). Maps live in `.waymark/<id>.json` (+ a self-contained `.waymark/<id>.html` viewer) at the repo root and are verified against the code: Waymark knows when an anchor moved, when it broke, and when the prose was written for code that has since changed.

Use it as **memory about how the system works**: read it before you act, update it after you change things, and trust it only as much as its verification state allows.

## 1. Pick an access method (once per session)

| If you have… | Use | Names in this skill |
|---|---|---|
| MCP tools whose name ends in `waymark_start`, `waymark_get`… (prefix varies: `mcp__waymark__`, `mcp__plugin_waymark_waymark__`, `waymark.`…) | the tools directly | `waymark_<x>` |
| a shell but no Waymark MCP | `node <this-skill-dir>/scripts/wm.mjs <command>` (finds the CLI: local clone, plugin bundle, `waymark` on PATH, or `npx github:h0w4r/waymark`) | `wm <command>` |
| neither | read `.waymark/<id>.json` / `.html` as plain files (read-only) | — |

`<this-skill-dir>` is the directory containing this SKILL.md (harnesses usually print it as the skill's base directory). Always go through `wm.mjs`; don't guess a CLI entry point inside the repo. `wm where` shows which CLI it resolved. Every MCP tool has a CLI twin; see [references/tools.md](references/tools.md). All tools accept `root` (absolute repo path): pass it when the server may run from another directory. To connect a harness, see [references/harnesses.md](references/harnesses.md).

## 2. Situation → action

| You are about to… | Do this first / after | Tool · CLI |
|---|---|---|
| **modify a file** | Which flows does it belong to? Read the nearest node's explanation and team notes. | `waymark_for_file(path, line)` · `wm for-file <path> <line>` |
| **understand a feature / answer "how does X work?"** | Reuse a map if one exists; otherwise create one. | `waymark_list` → `waymark_get(id, trace?, node?)` · `wm list`, `wm show <id> --format compact` |
| work on code with **no map** and the flow is non-trivial (≥3 files) | Create a map (ask first if the user is waiting; smart/parallel runs take minutes). | `waymark_start(query, mode)` → `waymark_create` · `wm generate "<topic>"` |
| **finish a code change** | Re-anchor maps; if prose drifted, refresh it; lint. | `waymark_verify(fix:true)` → `waymark_refresh(id)` → `waymark_lint` · `wm verify --fix`, `wm refresh <id>`, `wm lint` |
| **review a PR / branch** | Which documented flows, anchors and explanations does it affect? | `waymark_diff(base, range:true)` · `wm diff origin/main --range` |
| **debug a failure** | Map the files in the stack trace to nodes; follow the trace's tree; confirm the executed path with coverage of the reproducing test. | `waymark_for_file` · `waymark_exec(id, command)` · `wm exec <id> -- <test cmd>` |
| **write or plan tests** | Nodes marked ○ (not executed) are untested paths. | `waymark_exec` then `waymark_get` (look for ○) |
| **refactor / rename / move code** | Before: read maps for the area. After: verify --fix (renames are followed), refresh, lint. | as above |
| **onboard / explain the repo** | Start from the overview map; drill into linked maps. | `waymark_list` (kind `overview`) · `.waymark/index.html` |
| **hand off / document** | Point to the map and its viewer; record decisions as team notes **only if the user asks**. | `waymark_render(id, open)`, `waymark_note` · `wm render <id> --open`, `wm note …` |
| **trust a map's claims** for a risky change | Fact-check it with a fresh agent first. | `waymark_check(id)` → `waymark_record_check` · `wm check <id>` |

Detailed step-by-step playbooks for each workflow: [references/workflows.md](references/workflows.md).

## 3. How much to trust what a map says

| Signal (in `waymark_get` / viewer / context) | Meaning | What to do |
|---|---|---|
| `✓ fact-checked` | every claim was verified against the code | rely on it |
| no mark | written by an agent, not independently checked | treat as a well-informed hint; confirm by reading the anchored lines |
| `◑ partially verified: …` | some claims are not verifiable from code | rely on the verified part only |
| `✗ fact-check failed: …` / `(!unverified)` / `(!missing)` | wrong prose or broken anchor | do not rely on it; fix (`refresh`, `create`) |
| `⚠ code changed since this node was explained` / `◔` | narrative drift | read the code; run `waymark_refresh` when done |
| `▶ executed by the tests` / `○ not executed` | coverage evidence | ○ = path unproven by tests |
| `> 📝 Team note` | human knowledge (never AI-written) | take seriously; never edit or delete without being asked |

## 4. Rules

1. **Never hand-edit** `.waymark/*.json` or `.html`; all writes go through the tools/CLI (they re-anchor and re-render).
2. **Explore read-only** when building or checking maps; every anchored node must be a line you actually read.
3. **Prose in the user's language**, storytelling for a new teammate, citing nodes as `[1a]`. Map format and quality bar: [references/map-format.md](references/map-format.md).
4. **Keep maps true**: after you change code covered by a map, `verify --fix`, then `refresh` the drifted prose (or mark it `reviewed` if still accurate), then `lint`. Do not leave a session with maps you broke.
5. **Fact-checking needs a fresh context**: delegate `waymark_check` to a subagent (or a new session) that did not write the map.
6. **Team notes are the user's**: add/remove only on request.
7. **Mind the cost**: `fast` mode for quick answers; `smart` / `parallel` / `check` launch long agent work — tell the user or ask before starting them when they are waiting on something else.
8. **Prefer small context**: `waymark_get(id, node)` or `trace` instead of the whole map; `format: "compact"` when you only need structure.
