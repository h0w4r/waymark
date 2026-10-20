# Connecting Waymark to a harness

Waymark exposes the same capabilities three ways: **MCP server** (best: tools + resources), **CLI** (any agent with a shell), and **files** (`.waymark/*.json|html`, read-only). This skill works with any of them.

## Install the skill

The skill is a plain folder (`SKILL.md` + `references/` + `scripts/`), following the open Agent Skills layout:

| Harness | Skill location | How |
|---|---|---|
| Claude Code | `~/.claude/skills/using-waymark/` or `<repo>/.claude/skills/…` | `waymark install --claude-global` / `waymark install` (or the Claude Code plugin, which bundles it) |
| Codex CLI / IDE / desktop | `~/.agents/skills/using-waymark/` or `<repo>/.agents/skills/…` | `waymark install --codex-global` / `waymark install` |
| Any other skills-aware harness (Cursor, Gemini CLI, Agent SDK, custom) | its skills directory | `waymark install --no-claude --no-codex --no-agents-md --skill-dir <dir>` (copies the folder only) |
| Harness without skills | — | paste `SKILL.md` into its rules/instructions file (e.g. `AGENTS.md`, `.cursor/rules`, `GEMINI.md`) |

## Connect the MCP server (optional but recommended)

Stdio server: `node <waymark>/src/mcp.js` (clone) or `node <plugin>/dist/waymark.mjs mcp` (bundle). Examples:

- **Claude Code:** plugin `/plugin install waymark --marketplace h0w4r/waymark`, or `claude mcp add -s user waymark -- node <clone>/src/mcp.js`.
- **Codex:** `~/.codex/config.toml` → `[mcp_servers.waymark] command = "node" args = ["<clone>/src/mcp.js"]`.
- **Cursor / Windsurf / VS Code:** `mcpServers.waymark = { "command": "node", "args": ["<clone>/src/mcp.js"] }` in their MCP settings.
- **Claude Agent SDK / any MCP client:** `mcpServers: { waymark: { command: "node", args: ["<clone>/src/mcp.js"] } }`.

When the server runs outside the repository (global installs), pass `root` to every tool.

## No MCP? Use the wrapper

`node <this-skill>/scripts/wm.mjs <command> [args]` finds the CLI in this order: `WAYMARK_CLI` env var → the plugin bundle next to this skill → a Waymark clone containing this skill → `waymark` on PATH → `npx --yes github:h0w4r/waymark#v<version>`. `node <this-skill>/scripts/wm.mjs where` prints which one it uses.

Commands that run an agent themselves (`generate`, `enrich`, `refresh`, `check`) call `claude -p` or `codex exec`; from inside an agent prefer doing that work yourself with the procedure (`guide`, `show`, `annotate`, `create`) unless the user wants it delegated.
