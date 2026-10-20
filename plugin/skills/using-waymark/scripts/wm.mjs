#!/usr/bin/env node
// Waymark CLI wrapper for agents without the MCP server.
// Usage: node wm.mjs <command> [args…]      e.g.  node wm.mjs for-file src/app.ts 42
//        node wm.mjs where                  prints which CLI it resolved
// Resolution order: WAYMARK_CLI env → wm.config.json (written by `waymark install`) → plugin
// bundle next to this skill → Waymark clone containing this skill → `waymark` on PATH →
// npx github:h0w4r/waymark#v<version>.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const isWin = process.platform === 'win32';

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(HERE, 'wm.config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function onPath(name) {
  const exts = isWin ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) if (fs.existsSync(path.join(dir, name + ext))) return path.join(dir, name + ext);
  }
  return null;
}

function resolve() {
  const cfg = readConfig();
  const scripts = [
    ['WAYMARK_CLI', process.env.WAYMARK_CLI],
    ['wm.config.json', cfg.cli],
    ['plugin bundle', path.resolve(HERE, '..', '..', '..', 'dist', 'waymark.mjs')],
    ['repository clone', path.resolve(HERE, '..', '..', '..', 'src', 'cli.js')],
  ];
  for (const [how, file] of scripts) {
    if (file && fs.existsSync(file)) return { how, command: process.execPath, prefix: [file], shell: false };
  }
  const bin = onPath('waymark');
  if (bin) return { how: 'waymark on PATH', command: bin, prefix: [], shell: isWin };
  const version = cfg.version ? `v${cfg.version}` : 'main';
  return { how: `npx github:h0w4r/waymark#${version}`, command: isWin ? 'npx.cmd' : 'npx', prefix: ['--yes', `github:h0w4r/waymark#${version}`], shell: isWin };
}

const r = resolve();
if (args[0] === 'where') {
  console.log(`${r.how}: ${[r.command, ...r.prefix].join(' ')}`);
  process.exit(0);
}
const quote = (a) => (r.shell && /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
const res = spawnSync(r.shell ? `"${r.command}"` : r.command, [...r.prefix, ...args].map(quote), { stdio: 'inherit', shell: r.shell });
if (res.error) {
  console.error(`wm: could not run the Waymark CLI (${r.how}): ${res.error.message}`);
  process.exit(127);
}
process.exit(res.status ?? 1);
