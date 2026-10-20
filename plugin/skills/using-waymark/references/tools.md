# Waymark tools and their CLI twins

MCP tools appear with a harness-specific prefix (`mcp__waymark__waymark_get`, `mcp__plugin_waymark_waymark__waymark_get`, `waymark.waymark_get`…). Every tool accepts `root` (absolute repo path). CLI twin = `node <this-skill>/scripts/wm.mjs <command>` (or `waymark <command>` when installed); add `--root <repo>` if you are not inside the repository.

## Read / understand

| Tool | Arguments | Returns | CLI |
|---|---|---|---|
| `waymark_list` | — | every map: id, title, kind (`flow`/`overview`), nodes, verified/executed counts, drift, links to other maps | `list [--json]` |
| `waymark_get` | `id` (prefix ok), `format` = `markdown`\|`compact`\|`json`\|`mermaid`, `trace`, `node` | the map as context; `trace`/`node` return only that part (node: with parent, children and links) | `show <id> --format compact` |
| `waymark_for_file` | `path`, `line`, `format` | maps/traces/nodes covering a file, nearest node's explanation, team notes, drift flags | `for-file <path> [line] [--json]` |
| `waymark_suggest_topics` | `limit` | topics from files viewed in the editor, uncommitted/recent changes, commits, entry points | `suggest [--json]` |
| `waymark_find_anchor` | `path`, `pattern`, `regex`, `limit` | exact line numbers + line text (to anchor nodes precisely) | — (use grep) |
| resource `waymark://{id}` / `waymark://{id}/{trace\|node}` | — | same as `waymark_get` (Claude Code: `@waymark:waymark://<id>/2b`) | — |

## Create / edit

| Tool | Arguments | Notes | CLI |
|---|---|---|---|
| `waymark_start` | `query`, `mode` = `fast`\|`smart`\|`parallel`\|`overview` | procedure + input format + repo hints + existing maps. Always call first | `guide "<topic>"` (procedure only) / `generate "<topic>" [--mode fast] [--parallel] [--overview]` (runs a headless agent) |
| `waymark_create` | full map (`title`, `description`, `story`, `language`, `kind`, `traces[]`, `links[]`…), `id` to overwrite | validates, anchors, keeps human notes and still-valid verdicts, writes JSON + HTML; returns anchor report, missing narrative, lint | `create <file.json> [--id <id>]` |
| `waymark_annotate` | `id`, `story`, `description`, `title`, `traces[]` (`motivation`, `details`…), `locations[]` (`explanation`, `description`…), `links[]`, `reviewed[]` | edit prose without re-anchoring; `reviewed` confirms unchanged prose after a code change | `annotate <id> <patch.json>` |
| `waymark_enrich` | `id` | procedure + gaps to add storytelling to an old map | `enrich <id>` (headless agent) |
| `waymark_plan` | `query`, `title`, `language`, `kind`, `traces[]` (`title`, `focus`, `hints`) | parallel phase 1: returns `draft` and one builder prompt per trace | `generate --parallel` |
| `waymark_add_trace` | `draft`, `n`, `trace` | parallel phase 2 (safe concurrently): renumbers ids `<n>a…`, anchors | — |
| `waymark_draft` | `draft` (omit to list) | finished/missing traces + their content | — |
| `waymark_finalize` | `draft`, `description`, `story`, `links`, `title`, `language`, `id` | parallel phase 3: merges into a map | — |
| `waymark_note` | `id`, `node`, `text`, `author`, `remove` (index) | human team note; only when the user asks | `note <id> <node> "<text>" [--author] [--remove <i>]`, `notes <id>` |
| `waymark_render` | `id`, `open` | regenerates the HTML viewer (and `index.html`) | `render <id> [--open]`, `index` |
| `waymark_delete` | `id` | deletes a map — only on explicit request | `delete <id>` |

## Verify / keep true

| Tool | Arguments | Returns | CLI |
|---|---|---|---|
| `waymark_verify` | `id` (omit = all), `fix` | moved/relocated/broken anchors, changed files, **narrative drift** (nodes, trace guides, story); `fix` writes corrected anchors | `verify [id] [--fix] [--strict] [--strict-narrative]` |
| `waymark_refresh` | `id` | procedure + stale/broken nodes with their stored prose and snippets | `refresh <id>` (headless agent) |
| `waymark_lint` | `id` (omit = all) | errors: unknown `[refs]`, unsupported claims, links to unknown maps; warnings: missing narrative, uncited nodes, partial claims, long labels | `lint [id] [--strict] [--json]` |
| `waymark_check` | `id` | fact-check procedure + full map with snippets (give it to a fresh agent) | `check <id>` (headless agent) |
| `waymark_record_check` | `id`, `nodes[]`/`traces[]` (`id`, `verdict` = `supported`\|`partial`\|`unsupported`, `issues[]`), `story`, `checker` | stores verdicts (void when code or prose changes) | — |
| `waymark_diff` | `base` (default `HEAD` = uncommitted), `range` (base...HEAD), `format` | nodes whose code block the change touches, broken anchors, stale prose | `diff [base] [--range] [--format json] [--fail-on touched\|broken\|drift]` |
| `waymark_exec` | `id` (omit = all), `command` (Node: V8 coverage) or `lcov` (any language) | ▶ executed / ○ not executed per node | `exec [id] -- <test cmd>` / `exec [id] --lcov <file>` |

## Admin (CLI only)

`install` (wire into a repo/harness: `--claude-global`, `--codex-global`, `--vscode`, `--pr-action`, `--skill-dir <dir>`), `update` (git pull + reinstall), `hook <kind>` (Claude Code hooks), `mcp` (run the MCP server on stdio).
