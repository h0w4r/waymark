#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolveRoot } from './git.js';
import { saveMap, loadMap, listMaps, writeHtml, deleteMap, mapDir } from './store.js';
import { resolveCommand } from './bin.js';
import { verifyMap } from './verify.js';
import { suggestTopics } from './suggest.js';
import { waymarkGuide } from './guide.js';
import { renderMarkdown } from './render/markdown.js';
import { renderMermaid } from './render/mermaid.js';
import { openFile } from './open.js';
import { install } from './install.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const HELP = `waymark — hierarchical, line-anchored maps of how code executes

Usage: waymark <command> [options]

  generate "<topic>"     Build a map headlessly with an agent CLI
                         [--engine claude|codex] (default: claude if installed, else codex)
                         [--model <m>] [--open] [--max-turns <n> (claude)] [--approval <mode> (codex)]
  create <file.json>     Validate, anchor and store a map written as JSON [--id <id>] [--open]
  list                   List maps in the repo [--json]
  show <id>              Print a map [--format markdown|compact|json|mermaid]
  verify [id]            Check anchors against current code [--fix] [--strict]
                         exit 1 if anchors are broken (with --strict: also if stale)
  render <id>            Regenerate the HTML viewer [--open]
  delete <id>            Delete a map
  suggest                Suggest topics from recent work [--json]
  guide ["<topic>"]      Print the Waymark agent procedure (for any harness)
  install                Wire into a repo for Claude Code + Codex (CLI, IDE, desktop) + AGENTS.md
                         [--target <dir>] [--no-claude] [--no-codex] [--no-agents-md]
                         [--claude-global] also register for every project: claude mcp add -s user + ~/.claude/skills|agents
                         [--codex-global]  also register in ~/.codex/config.toml + ~/.agents/skills
                         [--global]        both of the above
                         [--global-bin]    use the waymark-mcp bin instead of an absolute path
  mcp                    Run the MCP server on stdio

Global: --root <dir>  repository root (default: git toplevel of cwd)
`;

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: 'string' },
    id: { type: 'string' },
    format: { type: 'string' },
    model: { type: 'string' },
    'max-turns': { type: 'string' },
    engine: { type: 'string' },
    approval: { type: 'string' },
    'no-codex': { type: 'boolean' },
    'codex-global': { type: 'boolean' },
    'claude-global': { type: 'boolean' },
    global: { type: 'boolean' },
    target: { type: 'string' },
    open: { type: 'boolean' },
    fix: { type: 'boolean' },
    strict: { type: 'boolean' },
    json: { type: 'boolean' },
    'no-claude': { type: 'boolean' },
    'no-agents-md': { type: 'boolean' },
    'global-bin': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [cmd, ...rest] = positionals;
const root = () => resolveRoot(opt.root);
const out = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));

function printReport(res) {
  const a = res.report;
  out(`✔ ${res.doc.id}  (${a.total} locations: ${a.ok} ok, ${a.moved + a.relocated} re-anchored, ${a.fuzzy} approx, ${a.unresolved + a.missing} unverified)`);
  for (const i of a.issues) out(`  ${i.status.padEnd(10)} [${i.id}] ${i.path}  ${i.note || ''}`);
  out(`  json: ${res.jsonPath}\n  html: ${res.htmlPath}`);
}

const MCP_ENTRY = path.join(HERE, 'mcp.js');
const fwd = (p) => p.replace(/\\/g, '/');

/** Claude Code headless: only read tools + waymark MCP are allowed. */
function claudeInvocation(r, prompt) {
  const cfgPath = path.join(os.tmpdir(), `waymark-mcp-${process.pid}.json`);
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({ mcpServers: { waymark: { command: process.execPath, args: [MCP_ENTRY], env: { WAYMARK_ROOT: r } } } }),
  );
  const args = ['-p', prompt, '--mcp-config', cfgPath, '--strict-mcp-config', '--allowedTools', 'Read,Grep,Glob,mcp__waymark', '--permission-mode', 'dontAsk'];
  if (opt.model) args.push('--model', opt.model);
  if (opt['max-turns']) args.push('--max-turns', opt['max-turns']);
  return { bin: resolveCommand('claude'), args, stdin: null, cleanup: () => fs.rmSync(cfgPath, { force: true }) };
}

/** Codex headless (codex exec): read-only sandbox; the MCP server (outside the sandbox) does the writing. */
function codexInvocation(r, prompt) {
  const toml = JSON.stringify;
  const args = [
    'exec',
    '--sandbox', 'read-only',
    '--skip-git-repo-check',
    '--color', 'never',
    '-C', r,
    '-c', `mcp_servers.waymark.command=${toml(fwd(process.execPath))}`,
    '-c', `mcp_servers.waymark.args=[${toml(fwd(MCP_ENTRY))}]`,
    '-c', `mcp_servers.waymark.env={WAYMARK_ROOT=${toml(fwd(r))}}`,
    '-c', 'mcp_servers.waymark.startup_timeout_sec=20',
    '-c', 'mcp_servers.waymark.tool_timeout_sec=120',
    '-c', `mcp_servers.waymark.default_tools_approval_mode=${toml(opt['approval'] || 'approve')}`,
  ];
  if (opt.model) args.push('-m', opt.model);
  args.push('-'); // prompt from stdin: avoids command-line length/quoting limits
  return { bin: resolveCommand('codex'), args, stdin: prompt, cleanup: () => {} };
}

function pickEngine() {
  const e = opt.engine || 'auto';
  if (e === 'claude' || e === 'codex') return e;
  if (e !== 'auto') throw new Error(`Unknown engine "${e}" (use claude | codex)`);
  return resolveCommand('claude') ? 'claude' : 'codex';
}

async function generate(topic) {
  if (!topic) throw new Error('Usage: waymark generate "<topic>" [--engine claude|codex]');
  const r = root();
  const engine = pickEngine();
  const before = new Set(listMaps(r).map((m) => m.id));
  const tools = engine === 'codex' ? 'read-only shell commands (rg, sed -n, git grep, ls)' : 'Read/Grep/Glob';
  const prompt =
    waymarkGuide(topic) +
    `\n\nRepository root: ${r}\nWork autonomously: do not ask questions. Explore with ${tools} only, submit with waymark_create ` +
    `(pass root="${fwd(r)}"), fix anchors until healthy, then answer with the id and a short summary.`;
  const inv = engine === 'codex' ? codexInvocation(r, prompt) : claudeInvocation(r, prompt);
  if (!inv.bin) throw new Error(`"${engine}" CLI not found on PATH`);
  out(`waymark: generating with ${engine}…`);
  const code = await new Promise((res, rej) => {
    const p = spawn(inv.bin.command, [...inv.bin.args, ...inv.args], {
      cwd: r,
      stdio: [inv.stdin ? 'pipe' : 'ignore', 'inherit', 'inherit'],
      shell: !!inv.bin.shell,
    });
    p.on('error', (e) => rej(new Error(`Could not run ${engine}: ${e.message}`)));
    p.on('close', res);
    if (inv.stdin) p.stdin.end(inv.stdin);
  }).finally(inv.cleanup);
  const created = listMaps(r).filter((m) => !before.has(m.id));
  if (created[0]) {
    const html = path.join(mapDir(r), `${created[0].id}.html`);
    out(`\nwaymark: ${created[0].id}\nhtml: ${html}`);
    if (opt.open) openFile(html);
  } else if (code === 0) {
    out('\n(no new map was stored; the agent may have updated an existing one)');
  }
  process.exitCode = code ?? 1;
}

async function main() {
  if (!cmd || opt.help) return out(HELP);
  switch (cmd) {
    case 'mcp': {
      const { startStdio } = await import('./mcp.js');
      return startStdio();
    }
    case 'generate':
      return generate(rest.join(' '));
    case 'create': {
      if (!rest[0]) throw new Error('Usage: waymark create <file.json|->');
      const raw = rest[0] === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(rest[0], 'utf8');
      const res = saveMap(root(), JSON.parse(raw), { id: opt.id });
      printReport(res);
      if (opt.open) openFile(res.htmlPath);
      if (!res.report.healthy) process.exitCode = 2;
      return;
    }
    case 'list': {
      const maps = listMaps(root());
      if (opt.json) return out(maps);
      if (!maps.length) return out('No waymark yet. Try: waymark generate "how does X work?"');
      for (const m of maps) out(`${m.id.padEnd(44)} ${String(m.locations).padStart(3)} nodes  ${(m.updatedAt || '').slice(0, 10)}  ${m.title}`);
      return;
    }
    case 'show': {
      const doc = loadMap(root(), rest[0]);
      const f = opt.format || 'markdown';
      return out(f === 'json' ? doc : f === 'mermaid' ? renderMermaid(doc) : renderMarkdown(doc, { detail: f === 'compact' ? 'compact' : 'full' }));
    }
    case 'verify': {
      const r = root();
      const ids = rest[0] ? [rest[0]] : listMaps(r).map((m) => m.id);
      let bad = false;
      for (const id of ids) {
        const v = verifyMap(r, id, { fix: opt.fix });
        const state = v.broken ? 'BROKEN' : v.stale ? 'STALE' : 'OK';
        out(`${state.padEnd(7)} ${v.id}  map@${v.mapCommit || '?'} head@${v.headCommit || '?'}${v.fixed ? '  (fixed)' : ''}`);
        for (const c of v.changes) out(`        ${c.status.padEnd(10)} [${c.id}] ${c.from} -> ${c.to}${c.note ? '  ' + c.note : ''}`);
        if (v.broken || (opt.strict && v.stale && !v.fixed)) bad = true;
      }
      if (bad) process.exitCode = 1;
      return;
    }
    case 'render': {
      const r = root();
      const p = writeHtml(r, loadMap(r, rest[0]));
      out(p);
      if (opt.open) openFile(p);
      return;
    }
    case 'delete':
      return out(`deleted ${deleteMap(root(), rest[0])}`);
    case 'suggest': {
      const s = suggestTopics(root());
      if (opt.json) return out(s);
      s.suggestions.forEach((x, i) => out(`${i + 1}. ${x.topic}\n   ${x.reason}`));
      return;
    }
    case 'guide':
      return out(waymarkGuide(rest.join(' ')));
    case 'install':
      return out(
        install({
          target: resolveRoot(opt.target || opt.root),
          claude: !opt['no-claude'],
          codex: !opt['no-codex'],
          codexGlobal: !!(opt['codex-global'] || opt.global),
          claudeGlobal: !!(opt['claude-global'] || opt.global),
          agentsMd: !opt['no-agents-md'],
          useGlobalBin: !!opt['global-bin'],
        }),
      );
    default:
      throw new Error(`Unknown command "${cmd}". Run waymark --help`);
  }
}

main().catch((e) => {
  console.error(`waymark: ${e.message}`);
  process.exit(1);
});
