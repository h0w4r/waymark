import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installPlaybookSkill } from '../src/install.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SKILL = path.join(ROOT, 'skills', 'using-waymark');

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'SKILL.md starts with YAML frontmatter');
  return Object.fromEntries(m[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]));
}

test('using-waymark: frontmatter follows the Agent Skills spec', () => {
  const fm = frontmatter(fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n'));
  assert.equal(fm.name, 'using-waymark');
  assert.match(fm.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(fm.name.length <= 64);
  assert.ok(fm.description && fm.description.length <= 1024, 'description present and <= 1024 chars');
  for (const f of ['references/workflows.md', 'references/tools.md', 'references/map-format.md', 'references/harnesses.md', 'scripts/wm.mjs']) {
    assert.ok(fs.existsSync(path.join(SKILL, f)), `${f} exists`);
  }
});

test('using-waymark: references/tools.md documents every MCP tool the server registers', () => {
  const server = fs.readFileSync(path.join(ROOT, 'src', 'mcp.js'), 'utf8');
  const tools = [...server.matchAll(/registerTool\(\s*'(waymark_[a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(tools.length >= 20, `found ${tools.length} tools`);
  const doc = fs.readFileSync(path.join(SKILL, 'references', 'tools.md'), 'utf8');
  const missing = tools.filter((t) => !doc.includes(t));
  assert.deepEqual(missing, [], 'tools missing from references/tools.md');
});

test('using-waymark: installer copies the skill and points the wrapper at the CLI', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-skill-'));
  try {
    const written = [];
    installPlaybookSkill(dir, written);
    const dest = path.join(dir, 'using-waymark');
    assert.ok(fs.existsSync(path.join(dest, 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(dest, 'references', 'tools.md')));
    const cfg = JSON.parse(fs.readFileSync(path.join(dest, 'scripts', 'wm.config.json'), 'utf8'));
    assert.ok(fs.existsSync(cfg.cli), 'configured CLI exists');
    assert.match(cfg.version, /^\d+\.\d+\.\d+/);

    const where = execFileSync(process.execPath, [path.join(dest, 'scripts', 'wm.mjs'), 'where'], { encoding: 'utf8', env: { ...process.env, WAYMARK_CLI: '' } });
    assert.match(where, /^wm\.config\.json: /);
    const help = execFileSync(process.execPath, [path.join(dest, 'scripts', 'wm.mjs'), 'list'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, WAYMARK_CLI: '' } });
    assert.ok(help.length > 0, 'wrapper forwards to the CLI');

    // User-owned copies (no managed marker) are never overwritten.
    fs.writeFileSync(path.join(dest, 'SKILL.md'), '---\nname: using-waymark\ndescription: mine\n---\n');
    const again = [];
    installPlaybookSkill(dir, again);
    assert.match(again[0], /skipped/);
    assert.match(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'), /description: mine/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('using-waymark: wrapper inside the repo resolves the clone', () => {
  const out = execFileSync(process.execPath, [path.join(SKILL, 'scripts', 'wm.mjs'), 'where'], { encoding: 'utf8', env: { ...process.env, WAYMARK_CLI: '' } });
  assert.match(out, /^repository clone: /);
});
