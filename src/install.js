import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { waymarkGuide } from './guide.js';
import { resolveCommand, argsFor } from './bin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP_ENTRY = path.join(HERE, 'mcp.js').replace(/\\/g, '/');
const MARK = '<!-- waymark:managed -->';
const TOML_MARK = '# waymark:managed';
const TOOLS = [
  'waymark_start',
  'waymark_suggest_topics',
  'waymark_find_anchor',
  'waymark_create',
  'waymark_annotate',
  'waymark_enrich',
  'waymark_refresh',
  'waymark_lint',
  'waymark_for_file',
  'waymark_list',
  'waymark_get',
  'waymark_verify',
  'waymark_render',
  'waymark_check',
  'waymark_record_check',
  'waymark_diff',
  'waymark_plan',
  'waymark_add_trace',
  'waymark_draft',
  'waymark_finalize',
];
const AGENT_DESCRIPTION =
  'Waymark agent. Builds a hierarchical, line-anchored map of how code executes for a topic (traces of numbered locations 1a, 1b… with a call tree, guide and shareable HTML viewer). Use when the user asks how something works end-to-end, wants a map/diagram of a flow, before large refactors, or when onboarding to unfamiliar code.';
const AGENT_RETURN =
  'When you finish, return to the caller: the map id, the HTML path, the `waymark://<id>` resource URI, the anchor health, and a 3–5 line summary of each trace.';

// ---------- Claude Code ----------

const CLAUDE_AGENT = (prefix = 'mcp__waymark__') => `---
name: waymark
description: ${AGENT_DESCRIPTION}
tools: Read, Grep, Glob, ${TOOLS.map((t) => `${prefix}${t}`).join(', ')}
---
${MARK}
${waymarkGuide('the topic given by the caller')}
${AGENT_RETURN}
`;

// ---------- shared skill (Claude Code: .claude/skills, Codex: .agents/skills) ----------

// Claude Code shows skills in the / menu; argument-hint + $ARGUMENTS make `/waymark <topic>` work.
const SKILL = ({ claude = false } = {}) => `---
name: waymark
description: Waymark — create, read, verify and share narrated, line-anchored maps of how code executes (traces of numbered locations 1a, 1b… with an annotated tree, a storytelling guide, per-node explanations and an interactive viewer). Use when the user asks how a flow works end-to-end, asks for a code map/diagram/walkthrough of a feature, mentions waymark or waymark://<id>, or before changing code an existing map covers.
${claude ? 'argument-hint: "<topic> [--fast] | list | show <id> | enrich <id> | refresh <id> | lint | verify [id] | from-chat"\n' : ''}---
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
- **refresh <id>** → bring prose back in sync after code changes: \`waymark_refresh(id)\` lists nodes/guides whose code changed since they were written (and broken anchors); rewrite them with \`waymark_annotate\` or confirm them with \`reviewed\`.
- **lint [id]** → \`waymark_lint\`; report errors (unknown [refs]) and warnings (missing narrative, uncited nodes…) and offer to fix them.
- **check <id>** → fact-check the map: delegate to a **fresh** \`waymark\` subagent (it must not be the one that wrote the map) with the procedure from \`waymark_check(id)\`; it fixes wrong prose and records verdicts with \`waymark_record_check\`. Report supported / partial / unsupported.
- **diff [base]** → \`waymark_diff\` (uncommitted changes by default; \`range: true\` for a branch/PR vs base): which nodes the change touches, which anchors break and which prose goes stale; offer \`refresh\`.
- **note <id> <node> <text>** → \`waymark_note\` (human knowledge, never rewritten by agents). Only when the user asks.
- **exec [id]** → mark nodes executed by the tests: \`waymark_exec\` with \`command\` (Node: e.g. "npm test") or \`lcov\` (path to an lcov.info from any language).
- **overview** → build the "map of maps": \`waymark_start(query, mode: "overview")\`; nodes link to detailed maps with \`mapRef\`; \`kind: "overview"\`.
- **enrich <id>** → add the storytelling layer to an existing map: \`waymark_enrich(id)\` returns the procedure and what is missing; write the story, Motivation/Details per trace and an explanation per node, save with \`waymark_annotate\`.
- **from-chat** → build a map of the code paths discussed in this conversation (derive the topic yourself).
- **anything else** is a topic → create a map (below). \`--fast\` in the text → \`mode: "fast"\`; otherwise \`"smart"\`.

## Create a map
1. Call \`waymark_start(query, mode)\`: it returns the full Waymark agent procedure (structure **and** storytelling rules), the input format, repo hints and existing maps. Follow it exactly.
   - If subagents are available (Claude Code \`waymark\` agent, Codex \`waymark\` custom agent), delegate the exploration to it.
   - **Big topics (smart mode, 3+ traces): build in parallel.** \`waymark_start(query, mode: "parallel")\` → \`waymark_plan\` returns one builder prompt per trace → launch one \`waymark\` subagent per trace **in the same message** (they run concurrently; each calls \`waymark_add_trace\`) → read \`waymark_draft\` → \`waymark_finalize\` with the description, story and links.
2. Explore **read-only** (Read/Grep/Glob, or \`rg\` / \`sed -n\` / \`git grep\` in the shell). Every location must be a line you actually read.
3. Write the prose as a story for a new teammate, in the user's language: map summary + holistic **story**; per trace **motivation** (why it exists) and **details** (narrative walkthrough citing [1a]); per location a one-line **description** and a 3-6 sentence **explanation**.
4. Submit with \`waymark_create\`; fix \`unresolved\`/\`missing\` anchors and resubmit with the same \`id\`; fill any missing narrative it reports with \`waymark_annotate\`.
5. Reply with the id, the HTML path and a short summary; offer \`waymark_render(id, open: true)\` (map pane with "See more" guides and "Explain" per node, code view, interactive diagram).

## Use a map as context
- Claude Code: \`@waymark:waymark://<id>\`, or just one trace / node: \`@waymark:waymark://<id>/2\`, \`@waymark:waymark://<id>/2b\`. Any harness: \`waymark_get(id, trace?, node?)\` (\`format: "compact"\` for structure only).
- About to change a file? \`waymark_for_file(path, line?)\` tells which flows it belongs to (the Waymark hooks inject this automatically in Claude Code).
- Before trusting an old map: \`waymark_verify(id, fix: true)\` — it also reports **narrative drift** (prose written for code that has since changed).
- After changing code a map covers, run \`waymark_refresh(id)\` and update the prose that no longer holds.

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
    const r = spawnSync(codex.command, argsFor(codex, ['mcp', 'get', 'waymark']), { encoding: 'utf8', shell: !!codex.shell });
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
const CLI_ENTRY = path.join(HERE, 'cli.js').replace(/\\/g, '/');
const HOOKS = [
  { event: 'PreToolUse', matcher: 'Edit|Write|MultiEdit|NotebookEdit', kind: 'pre-edit' },
  { event: 'PostToolUse', matcher: 'Edit|Write|MultiEdit|NotebookEdit', kind: 'post-edit' },
  { event: 'PostToolUse', matcher: 'Read', kind: 'post-read' },
];
const isOurHook = (h) =>
  typeof h?.command === 'string' && /(waymark|cli\.js"?)\s+hook (pre-edit|post-edit|post-read)\s*$/.test(h.command);

/**
 * Adds the Waymark hooks to a Claude Code settings.json (merging, never touching other hooks).
 * remove=true only strips ours. A timestamped backup is kept when the file already existed.
 */
export function installClaudeHooks(settingsPath, written, { remove = false, useGlobalBin = false } = {}) {
  if (remove && !fs.existsSync(settingsPath)) return;
  let cfg = {};
  if (fs.existsSync(settingsPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      written.push(`skipped hooks: ${settingsPath} is not valid JSON`);
      return;
    }
    fs.copyFileSync(settingsPath, `${settingsPath}.backup-waymark-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  }
  cfg.hooks = cfg.hooks || {};
  for (const event of Object.keys(cfg.hooks)) {
    cfg.hooks[event] = (cfg.hooks[event] || [])
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurHook(h)) }))
      .filter((g) => g.hooks.length);
    if (!cfg.hooks[event].length) delete cfg.hooks[event];
  }
  if (!remove) {
    const cmd = (kind) => (useGlobalBin ? `waymark hook ${kind}` : `node "${CLI_ENTRY}" hook ${kind}`);
    for (const h of HOOKS) {
      cfg.hooks[h.event] = cfg.hooks[h.event] || [];
      cfg.hooks[h.event].push({ matcher: h.matcher, hooks: [{ type: 'command', command: cmd(h.kind), timeout: 20 }] });
    }
  }
  if (!Object.keys(cfg.hooks).length) delete cfg.hooks;
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2) + '\n');
  written.push(`${remove ? 'removed hooks from' : 'hooks →'} ${settingsPath}`);
}

/** Packages ../vscode as a VSIX (npx @vscode/vsce) and installs it with the `code` CLI. */
/**
 * GitHub Action for a target repo: on every PR, comment which documented flows the change touches.
 * Runs the CLI straight from GitHub at this version (no npm publish needed).
 */
export function installPrAction(target, written) {
  const version = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')).version;
  const file = path.join(target, '.github', 'workflows', 'waymark-pr.yml');
  if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes('waymark:managed')) {
    written.push(`skipped (user-owned): ${file}`);
    return;
  }
  const yml = `# waymark:managed — comments on each pull request with the documented flows it touches.
name: waymark-pr
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  maps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npx --yes github:h0w4r/waymark#v${version} diff "origin/\${{ github.base_ref }}" --range > waymark-report.md
      - name: Comment (updates the previous Waymark comment)
        env:
          GH_TOKEN: \${{ github.token }}
          PR: \${{ github.event.pull_request.number }}
        run: gh pr comment "$PR" --body-file waymark-report.md --edit-last 2>/dev/null || gh pr comment "$PR" --body-file waymark-report.md
`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yml);
  written.push(`wrote: ${file}`);
}

export function installVscode(written) {
  const dir = path.join(HERE, '..', 'vscode');
  const npx = resolveCommand('npx');
  const code = resolveCommand('code');
  if (!npx || !code) {
    written.push(`vscode: skipped (${!npx ? 'npx' : 'code'} not found on PATH)`);
    return;
  }
  // The VSIX embeds the bundled library (vscode/dist), produced by scripts/build.mjs.
  const buildScript = path.join(HERE, '..', 'scripts', 'build.mjs');
  if (fs.existsSync(buildScript)) {
    const b = spawnSync(process.execPath, [buildScript], { cwd: path.join(HERE, '..'), encoding: 'utf8' });
    if (b.status !== 0) {
      written.push(`vscode: build failed: ${(b.stderr || b.stdout || '').slice(-400)}`);
      return;
    }
  }
  const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  const vsix = path.join(dir, `waymark-vscode-${version}.vsix`);
  const pack = spawnSync(npx.command, argsFor(npx, ['--yes', '@vscode/vsce@latest', 'package', '--no-dependencies', '-o', vsix]), {
    cwd: dir,
    encoding: 'utf8',
    shell: !!npx.shell,
  });
  if (pack.status !== 0 || !fs.existsSync(vsix)) {
    written.push(`vscode: packaging failed: ${(pack.stderr || pack.stdout || '').slice(-400)}`);
    return;
  }
  const inst = spawnSync(code.command, argsFor(code, ['--install-extension', vsix, '--force']), { encoding: 'utf8', shell: !!code.shell });
  written.push(inst.status === 0 ? `vscode: installed ${path.basename(vsix)} (reload VS Code windows)` : `vscode: install failed: ${inst.stderr || inst.stdout}`);
}

function claudeGlobal(serverCmd, written, { hooks = true, useGlobalBin = false } = {}) {
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  if (hooks) installClaudeHooks(path.join(home, 'settings.json'), written, { useGlobalBin });
  writeManaged(path.join(home, 'skills', 'waymark', 'SKILL.md'), SKILL({ claude: true }), written);
  writeManaged(path.join(home, 'agents', 'waymark.md'), CLAUDE_AGENT(), written);
  removeManaged(path.join(home, 'commands', 'waymark.md'), written);
  const claude = resolveCommand('claude');
  if (!claude) {
    written.push('claude global: `claude` not found on PATH; MCP server not registered');
    return;
  }
  const run = (args) => spawnSync(claude.command, argsFor(claude, args), { encoding: 'utf8', shell: !!claude.shell });
  const get = run(['mcp', 'get', 'waymark']);
  if (get.status === 0 && /scope:s*user/i.test(get.stdout)) {
    written.push('claude global: user-scoped MCP server "waymark" already registered');
    return;
  }
  const add = run(['mcp', 'add', '-s', 'user', 'waymark', '--', serverCmd.command, ...serverCmd.args]);
  const msg = `${add.stderr || ''}${add.stdout || ''}`;
  if (add.status === 0) written.push('claude global: registered via `claude mcp add -s user waymark`');
  else if (/already exists in user config/i.test(msg)) written.push('claude global: user-scoped MCP server "waymark" already registered');
  else written.push(`claude global failed: ${msg}`);
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

export function install({
  target,
  claude = true,
  codex = true,
  agentsMd = true,
  hooks = true,
  codexGlobal: codexGlob = false,
  claudeGlobal: claudeGlob = false,
  useGlobalBin = false,
  vscode = false,
  prAction = false,
}) {
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
    // Hooks live at project level unless installed globally (avoid firing twice).
    if (hooks) installClaudeHooks(path.join(target, '.claude', 'settings.json'), written, { remove: claudeGlob, useGlobalBin });
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
  if (claudeGlob) claudeGlobal(serverCmd, written, { hooks, useGlobalBin });
  if (vscode) installVscode(written);
  if (prAction) installPrAction(target, written);
  if (agentsMd) {
    const p = path.join(target, 'AGENTS.md');
    const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    const next = cur.includes(MARK) ? cur.replace(/\n## Waymark\n[\s\S]*?<!-- \/waymark -->\n/, AGENTS_SNIPPET) : cur + AGENTS_SNIPPET;
    fs.writeFileSync(p, next);
    written.push(`wrote: ${p}`);
  }
  return written.join('\n');
}

/** Templates for the Claude Code plugin build (scripts/build.mjs). */
export function pluginTemplates(prefix) {
  return { skill: SKILL({ claude: true }), agent: CLAUDE_AGENT(prefix) };
}
