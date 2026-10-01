import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { waymarkGuide } from './guide.js';
import { resolveCommand } from './bin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP_ENTRY = path.join(HERE, 'mcp.js').replace(/\\/g, '/');
const MARK = '<!-- waymark:managed -->';
const TOML_MARK = '# waymark:managed';
const TOOLS = [
  'waymark_start',
  'waymark_suggest_topics',
  'waymark_find_anchor',
  'waymark_create',
  'waymark_list',
  'waymark_get',
  'waymark_verify',
  'waymark_render',
];
const AGENT_DESCRIPTION =
  'Waymark agent. Builds a hierarchical, line-anchored map of how code executes for a topic (traces of numbered locations 1a, 1b… with a call tree, guide and shareable HTML viewer). Use when the user asks how something works end-to-end, wants a map/diagram of a flow, before large refactors, or when onboarding to unfamiliar code.';
const AGENT_RETURN =
  'When you finish, return to the caller: the map id, the HTML path, the `waymark://<id>` resource URI, the anchor health, and a 3–5 line summary of each trace.';

// ---------- Claude Code ----------

const CLAUDE_AGENT = () => `---
name: waymark
description: ${AGENT_DESCRIPTION}
tools: Read, Grep, Glob, ${TOOLS.map((t) => `mcp__waymark__${t}`).join(', ')}
---
${MARK}
${waymarkGuide('the topic given by the caller')}
${AGENT_RETURN}
`;

// ---------- shared skill (Claude Code: .claude/skills, Codex: .agents/skills) ----------

// Claude Code shows skills in the / menu; argument-hint + $ARGUMENTS make `/waymark <topic>` work.
const SKILL = ({ claude = false } = {}) => `---
name: waymark
description: Waymark — create, read, verify and share hierarchical, line-anchored maps of how code executes (traces of numbered locations 1a, 1b… with a call tree, guide and HTML viewer). Use when the user asks how a flow works end-to-end, asks for a code map/diagram/trace of a feature, mentions waymark or waymark://<id>, or before changing code an existing map covers.
${claude ? 'argument-hint: "<topic> | list | show <id> | verify [id] | from-chat"\n' : ''}---
${MARK}
# Waymark
${claude ? '\nArguments: $ARGUMENTS\n' : ''}

Maps live in \`.waymark/<id>.json\` plus a self-contained \`.waymark/<id>.html\` viewer at the repo root. All writing goes through the \`waymark\` MCP server tools (\`waymark_*\`); never hand-edit those files.

Always pass \`root\` = the absolute path of the current workspace to \`waymark_*\` tools when the server may be installed globally (e.g. Codex desktop).

## Modes (the text after \`$waymark\` / \`/waymark\`)
- **empty** → \`waymark_suggest_topics\`; offer the top suggestions (plus "map what we discussed" if code was discussed) and ask which to build.
- **list** → \`waymark_list\`; show id, title, nodes, updated.
- **show <id>** → \`waymark_get\` with \`format: "compact"\`; summarize and point to \`.waymark/<id>.html\`.
- **verify [id]** → \`waymark_verify\` with \`fix: true\`; report moved/relocated/broken anchors.
- **from-chat** → build a map of the code paths discussed in this conversation (derive the topic yourself).
- **anything else** is a topic → create a map (below).

## Create a map
1. Call \`waymark_start(query)\`: it returns the full Waymark agent procedure, the input format, repo hints and existing maps. Follow it exactly.
   - If subagents are available (Claude Code \`waymark\` agent, Codex \`waymark\` custom agent), delegate the exploration to it.
2. Explore **read-only** (Read/Grep/Glob, or \`rg\` / \`sed -n\` / \`git grep\` in the shell). Every location must be a line you actually read.
3. Submit with \`waymark_create\`; fix \`unresolved\`/\`missing\` anchors and resubmit with the same \`id\` until healthy.
4. Reply with the id, the HTML path and a short summary; offer \`waymark_render(id, open: true)\`.

## Use a map as context
- Claude Code: \`@waymark:waymark://<id>\`. Any harness: \`waymark_get(id)\` (\`format: "compact"\` for structure only).
- Before trusting an old map: \`waymark_verify(id, fix: true)\`.
- Before editing code a map covers, read it; after the change, verify it and update descriptions that no longer hold.

## Without MCP (CLI fallback)
\`waymark guide "<topic>"\` prints the procedure; write the map as JSON and run \`waymark create map.json\`. Also \`waymark show <id> --format compact\`, \`waymark verify --fix\`, \`waymark list\`.
`;

const CODEX_SKILL_YAML = `interface:
  display_name: "Waymark"
  short_description: "Hierarchical, line-anchored maps of how code executes"
  brand_color: "#3A5CCC"
  default_prompt: "Use $waymark to map how this flow works end to end."
policy:
  allow_implicit_invocation: true
dependencies:
  tools:
    - type: "mcp"
      value: "waymark"
      description: "Waymark MCP server (waymark_* tools)"
`;

// ---------- Codex ----------

const tomlStr = (s) => JSON.stringify(s); // JSON strings are valid TOML basic strings
const tomlArr = (a) => `[${a.map(tomlStr).join(', ')}]`;

function codexServerToml(serverCmd, { cwd, enabledTools } = {}) {
  const lines = [
    `[mcp_servers.waymark]`,
    `command = ${tomlStr(serverCmd.command)}`,
    `args = ${tomlArr(serverCmd.args)}`,
    `startup_timeout_sec = 20`,
    `tool_timeout_sec = 120`,
  ];
  if (cwd) lines.push(`cwd = ${tomlStr(cwd)}`);
  if (enabledTools) lines.push(`enabled_tools = ${tomlArr(enabledTools)}`);
  return lines.join('\n');
}

const CODEX_AGENT = (serverCmd) => `${TOML_MARK}
name = "waymark"
description = ${tomlStr(AGENT_DESCRIPTION)}
sandbox_mode = "read-only"
developer_instructions = '''
${waymarkGuide('the topic given by the caller').replace(/'''/g, "''")}
${AGENT_RETURN}
'''

${codexServerToml(serverCmd, { enabledTools: TOOLS })}
`;

/** Inserts/replaces a managed block in a TOML file without touching the rest. */
function upsertTomlBlock(file, block, written) {
  const begin = `${TOML_MARK} >>>`;
  const end = `${TOML_MARK} <<<`;
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const wrapped = `${begin}\n${block}\n${end}\n`;
  let next;
  if (cur.includes(begin)) {
    next = cur.replace(new RegExp(`${begin}[\\s\\S]*?${end}\\n?`), wrapped);
  } else if (/^\[mcp_servers\.waymark\]/m.test(cur)) {
    written.push(`skipped (user-owned [mcp_servers.waymark]): ${file}`);
    return;
  } else {
    next = (cur && !cur.endsWith('\n') ? cur + '\n' : cur) + (cur ? '\n' : '') + wrapped;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  written.push(`wrote: ${file}`);
}

/**
 * Registers the server in ~/.codex/config.toml (shared by Codex CLI, IDE and desktop app).
 * Appends a managed block instead of `codex mcp add`, which re-serializes the whole file
 * (dropping the user's comments and formatting). A timestamped backup is kept.
 */
function codexGlobal(serverCmd, written) {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const file = path.join(home, 'config.toml');
  if (fs.existsSync(file)) {
    const backup = `${file}.backup-waymark-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(file, backup);
    written.push(`backup: ${backup}`);
  }
  upsertTomlBlock(file, codexServerToml(serverCmd), written);
  const codex = resolveCommand('codex');
  if (codex) {
    const r = spawnSync(codex.command, [...codex.args, 'mcp', 'get', 'waymark'], { encoding: 'utf8', shell: !!codex.shell });
    written.push(r.status === 0 ? 'codex global: `codex mcp get waymark` OK' : `codex global: check failed: ${r.stderr || r.stdout}`);
  }
  // User-level skill so the desktop app picks it up in any workspace.
  const dir = path.join(os.homedir(), '.agents', 'skills', 'waymark');
  writeManaged(path.join(dir, 'SKILL.md'), SKILL(), written);
  writeManaged(path.join(dir, 'agents', 'openai.yaml'), `# ${MARK}\n${CODEX_SKILL_YAML}`, written);
}

/**
 * Claude Code user scope: MCP server via `claude mcp add -s user` (no per-project approval)
 * plus ~/.claude/skills and ~/.claude/agents, so /waymark shows up in every project.
 */
function claudeGlobal(serverCmd, written) {
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  writeManaged(path.join(home, 'skills', 'waymark', 'SKILL.md'), SKILL({ claude: true }), written);
  writeManaged(path.join(home, 'agents', 'waymark.md'), CLAUDE_AGENT(), written);
  removeManaged(path.join(home, 'commands', 'waymark.md'), written);
  const claude = resolveCommand('claude');
  if (!claude) {
    written.push('claude global: `claude` not found on PATH; MCP server not registered');
    return;
  }
  const run = (args) => spawnSync(claude.command, [...claude.args, ...args], { encoding: 'utf8', shell: !!claude.shell });
  const get = run(['mcp', 'get', 'waymark']);
  if (get.status === 0 && /scope:s*user/i.test(get.stdout)) {
    written.push('claude global: user-scoped MCP server "waymark" already registered');
    return;
  }
  const add = run(['mcp', 'add', '-s', 'user', 'waymark', '--', serverCmd.command, ...serverCmd.args]);
  written.push(add.status === 0 ? 'claude global: registered via `claude mcp add -s user waymark`' : `claude global failed: ${add.stderr || add.stdout}`);
}

// ---------- AGENTS.md (read by Codex and many other harnesses) ----------

const AGENTS_SNIPPET = `
## Waymark
${MARK}
This repo uses **Waymark**: hierarchical, line-anchored maps of how code executes, stored in \`.waymark/\`.
- MCP server \`waymark\` (\`.mcp.json\` for Claude Code, \`.codex/config.toml\` for Codex): \`waymark_start\` → \`waymark_create\` to build a map; \`waymark_get\` / resource \`waymark://<id>\` to load one as context; \`waymark_verify\` to detect drift.
- Skill \`waymark\` (\`$waymark <topic>\` in Codex, \`/waymark <topic>\` in Claude Code).
- CLI fallback: \`waymark guide "<topic>"\`, \`waymark create map.json\`, \`waymark show <id> --format compact\`, \`waymark verify --fix\`.
- Before modifying an area covered by a map, read it; afterwards verify it.
<!-- /waymark -->
`;

function removeManaged(file, written) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('waymark:managed')) {
    fs.rmSync(file);
    written.push(`removed (superseded by the skill): ${file}`);
  }
}

function writeManaged(file, content, written) {
  if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes('waymark:managed')) {
    written.push(`skipped (user-owned): ${file}`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  written.push(`wrote: ${file}`);
}

export function install({ target, claude = true, codex = true, agentsMd = true, codexGlobal: codexGlob = false, claudeGlobal: claudeGlob = false, useGlobalBin = false }) {
  const written = [];
  const serverCmd = useGlobalBin ? { command: 'waymark-mcp', args: [] } : { command: 'node', args: [MCP_ENTRY] };

  if (claude) {
    const mcpPath = path.join(target, '.mcp.json');
    const cfg = fs.existsSync(mcpPath) ? JSON.parse(fs.readFileSync(mcpPath, 'utf8')) : {};
    cfg.mcpServers = cfg.mcpServers || {};
    cfg.mcpServers.waymark = serverCmd;
    fs.writeFileSync(mcpPath, JSON.stringify(cfg, null, 2) + '\n');
    written.push(`wrote: ${mcpPath}`);
    writeManaged(path.join(target, '.claude', 'agents', 'waymark.md'), CLAUDE_AGENT(), written);
    removeManaged(path.join(target, '.claude', 'commands', 'waymark.md'), written);
    writeManaged(path.join(target, '.claude', 'skills', 'waymark', 'SKILL.md'), SKILL({ claude: true }), written);
  }
  if (codex) {
    // Project-scoped config: Codex loads it only for trusted projects.
    upsertTomlBlock(
      path.join(target, '.codex', 'config.toml'),
      codexServerToml(serverCmd, { cwd: target.replace(/\\/g, '/') }),
      written,
    );
    writeManaged(path.join(target, '.codex', 'agents', 'waymark.toml'), CODEX_AGENT(serverCmd), written);
    const skillDir = path.join(target, '.agents', 'skills', 'waymark');
    writeManaged(path.join(skillDir, 'SKILL.md'), SKILL(), written);
    writeManaged(path.join(skillDir, 'agents', 'openai.yaml'), `# ${MARK}\n${CODEX_SKILL_YAML}`, written);
  }
  if (codexGlob) codexGlobal(serverCmd, written);
  if (claudeGlob) claudeGlobal(serverCmd, written);
  if (agentsMd) {
    const p = path.join(target, 'AGENTS.md');
    const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    const next = cur.includes(MARK) ? cur.replace(/\n## Waymark\n[\s\S]*?<!-- \/waymark -->\n/, AGENTS_SNIPPET) : cur + AGENTS_SNIPPET;
    fs.writeFileSync(p, next);
    written.push(`wrote: ${p}`);
  }
  return written.join('\n');
}
