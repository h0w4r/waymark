import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveCommand, argsFor } from './bin.js';
import { install } from './install.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hashOf = (f) => (fs.existsSync(f) ? crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex') : null);

function run(cmd, args, opts = {}) {
  const bin = resolveCommand(cmd) || { command: cmd, args: [] };
  return spawnSync(bin.command, argsFor(bin, args), { cwd: PKG_ROOT, encoding: 'utf8', shell: !!bin.shell, ...opts });
}

/**
 * Non-agentic self-update of a cloned Waymark checkout:
 * git pull --ff-only → npm ci when the lockfile changed → re-run the requested installs.
 * The MCP server, hooks and CLI run straight from this folder, so pulling is what updates them.
 */
export function selfUpdate({ pull = true, claudeGlobal = false, vscode = false, target = null } = {}) {
  const log = [];
  const before = run('git', ['rev-parse', '--short', 'HEAD']).stdout?.trim();
  if (pull) {
    const dirty = run('git', ['status', '--porcelain', '--untracked-files=no']).stdout?.trim();
    if (dirty) throw new Error(`local changes in ${PKG_ROOT}; commit or stash them before updating`);
    const lockBefore = hashOf(path.join(PKG_ROOT, 'package-lock.json'));
    const p = run('git', ['pull', '--ff-only']);
    if (p.status !== 0) throw new Error(`git pull failed: ${p.stderr || p.stdout}`);
    const after = run('git', ['rev-parse', '--short', 'HEAD']).stdout?.trim();
    log.push(before === after ? `already up to date (${after})` : `updated ${before} → ${after}`);
    if (hashOf(path.join(PKG_ROOT, 'package-lock.json')) !== lockBefore) {
      const ci = run('npm', ['ci', '--no-audit', '--no-fund']);
      log.push(ci.status === 0 ? 'dependencies reinstalled (npm ci)' : `npm ci failed: ${ci.stderr}`);
    }
  }
  if (claudeGlobal || vscode || target) {
    log.push(
      install({
        target: target || PKG_ROOT,
        claude: !!target,
        codex: false,
        agentsMd: false,
        claudeGlobal,
        vscode,
      }),
    );
  }
  return log.join('\n');
}
