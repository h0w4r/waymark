import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { saveMap, loadMap, annotateMap } from '../src/store.js';
import { verifyMap } from '../src/verify.js';
import { lintMap } from '../src/lint.js';
import { mapsForFile } from '../src/context.js';
import { hookOutput } from '../src/hooks.js';
import { installClaudeHooks } from '../src/install.js';
import { suggestTopics } from '../src/suggest.js';
import { renderMarkdown } from '../src/render/markdown.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const model = require('../vscode/lib/model.js');

let repo;
let client;
const SRC = [
  'export function total(items) {',
  '  let sum = 0;',
  '  for (const i of items) sum += i.price;',
  '  return sum;',
  '}',
  '',
  'export function checkout(cart) {',
  '  const t = total(cart.items);',
  '  return { amount: t, currency: "EUR" };',
  '}',
  '',
].join('\n');

const MAP = {
  title: 'Checkout total',
  description: 'Checkout [1b] sums the cart with total [1a].',
  story: 'A cart arrives at checkout [1b], which asks total [1a] for the amount.',
  traces: [
    {
      title: 'Compute amount',
      description: 'From checkout to total.',
      motivation: 'Prices must be summed once.',
      details: 'checkout [1b] calls total [1a].',
      locations: [
        { title: 'total', description: 'Sums item prices.', explanation: 'Loops over items adding each price into sum.', path: 'cart.js', lineNumber: 1, lineContent: 'export function total(items) {' },
        { title: 'checkout', description: 'Builds the payment amount.', explanation: 'Calls total and wraps the result with the currency.', path: 'cart.js', lineNumber: 7, lineContent: 'export function checkout(cart) {' },
      ],
      tree: [{ ref: '1b', children: [{ ref: '1a', via: 'items' }] }],
    },
  ],
};
const write = (s) => fs.writeFileSync(path.join(repo, 'cart.js'), s);

before(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-agentic-'));
  write(SRC);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  saveMap(repo, MAP, { id: 'cart' });
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [path.join(HERE, '..', 'src', 'mcp.js')], env: { ...process.env, WAYMARK_ROOT: repo } }),
  );
});

after(async () => {
  await client?.close();
  fs.rmSync(repo, { recursive: true, force: true });
});

test('moving code is not narrative drift; editing it is', () => {
  write('// header\n// more\n' + SRC); // shift everything by 2 lines
  let v = verifyMap(repo, 'cart', { fix: true });
  assert.equal(v.narrative.stale, false);
  assert.ok(v.changes.some((c) => c.id === '1a' && c.to === 'cart.js:3'));

  write('// header\n// more\n' + SRC.replace('sum += i.price', 'sum += i.price * i.qty'));
  v = verifyMap(repo, 'cart', { fix: true });
  assert.deepEqual(v.narrative.nodes, ['1a']);
  assert.deepEqual(v.narrative.traces, ['1']);
  assert.equal(v.narrative.story, true);
  assert.deepEqual(loadMap(repo, 'cart').meta.narrativeDrift.nodes, ['1a']);
});

test('annotate (rewrite) and reviewed (confirm) clear the drift', () => {
  let r = annotateMap(repo, 'cart', { locations: [{ id: '1a', explanation: 'Multiplies price by quantity for each item and adds it to sum.' }] });
  assert.deepEqual(r.drift.nodes, []);
  assert.equal(r.drift.stale, true); // trace guide + story still flagged
  r = annotateMap(repo, 'cart', { reviewed: ['trace:1', 'story'] });
  assert.equal(r.drift.stale, false);
  assert.equal(loadMap(repo, 'cart').meta.narrativeDrift, undefined);
});

test('lint catches unknown refs and uncited nodes', () => {
  const doc = loadMap(repo, 'cart');
  assert.equal(lintMap(doc).errors, 0);
  doc.story = 'See [9z].';
  doc.traces[0].details = 'Only [1b].';
  const res = lintMap(doc);
  assert.equal(res.errors, 1);
  assert.ok(res.issues.some((i) => /does not cite \[1a\]/.test(i.message)));
});

test('for-file finds nodes and the nearest one', () => {
  const res = mapsForFile(repo, path.join(repo, 'cart.js'), { line: 10 });
  assert.equal(res.path, 'cart.js');
  assert.equal(res.maps[0].id, 'cart');
  assert.equal(res.maps[0].nearest, '1b');
  assert.equal(mapsForFile(repo, 'nope.js').maps.length, 0);
});

test('hooks: context once per session, short reminder before edits, drift after edits', () => {
  const SID = 's-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const input = (kind, session = SID) => ({ session_id: session, cwd: repo, tool_input: { file_path: path.join(repo, 'cart.js') }, kind });
  const first = hookOutput('post-read', input('post-read'));
  assert.match(first, /Waymark maps covering `cart\.js`/);
  assert.match(first, /\[1a\] total/);
  assert.equal(hookOutput('post-read', input('post-read')), '');
  assert.match(hookOutput('pre-edit', input('pre-edit')), /provided earlier in this session/);

  write('// header\n// more\n' + SRC.replace('return sum;', 'return Math.round(sum);'));
  const post = hookOutput('post-edit', input('post-edit'));
  assert.match(post, /changed after those nodes were explained/);
  assert.match(post, /waymark_refresh/);
  assert.equal(hookOutput('post-read', { ...input('post-read'), tool_input: { file_path: path.join(repo, 'other.js') } }), '');
});

test('markdown and MCP: trace / node parts, for_file, lint, refresh', async () => {
  const doc = loadMap(repo, 'cart');
  const node = renderMarkdown(doc, { node: '1a' });
  assert.match(node, /## Node \[1a\]/);
  assert.match(node, /Called from \/ part of: \[1b\] checkout/);
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw new Error(r.content[0].text);
    return r.content[0].text;
  };
  const { contents } = await client.readResource({ uri: 'waymark://cart/1a' });
  assert.match(contents[0].text, /## Node \[1a\]/);
  const traceRes = await client.readResource({ uri: 'waymark://cart/1' });
  assert.match(traceRes.contents[0].text, /## Trace 1: Compute amount/);
  const whole = await client.readResource({ uri: 'waymark://cart' });
  assert.match(whole.contents[0].text, /## The story/);
  assert.match(await call('waymark_for_file', { path: 'cart.js', line: 2 }), /Explanation of \[1a\]/);
  assert.match(await call('waymark_get', { id: 'cart', trace: '1', format: 'compact' }), /## Trace 1/);
  assert.match(await call('waymark_lint', {}), /"errors": 0/);
  assert.match(await call('waymark_refresh', { id: 'cart' }), /surrounding code changed: \[1a\]/);
});

test('installer merges hooks into settings.json without touching other hooks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-settings-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ model: 'x', hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo other' }] }] } }));
  const w = [];
  installClaudeHooks(file, w);
  installClaudeHooks(file, w); // idempotent
  let cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(cfg.model, 'x');
  const cmds = Object.values(cfg.hooks).flat().flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(cmds.includes('echo other'));
  assert.equal(cmds.filter((c) => / hook post-edit$/.test(c)).length, 1);
  assert.equal(cmds.filter((c) => / hook pre-edit$/.test(c)).length, 1);
  assert.equal(cmds.filter((c) => / hook post-read$/.test(c)).length, 1);
  installClaudeHooks(file, w, { remove: true });
  cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.values(cfg.hooks).flat().flatMap((g) => g.hooks.map((h) => h.command)), ['echo other']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('VS Code model: index, navigation, gutter icon, history → suggestions', () => {
  const ws = model.loadWorkspace(repo);
  assert.equal(ws.maps.length, 1);
  const m = ws.maps[0];
  assert.deepEqual(ws.byFile.get('cart.js').map((n) => n.id).sort(), ['1a', '1b']);
  const at = model.nodeAt(m, 'cart.js', m.nodes[0].line);
  assert.equal(at, 0);
  assert.equal(model.step(m, 0, 1), 1);
  assert.equal(model.step(m, 1, 1), -1);
  assert.equal(model.step(m, -1, -1), 1);
  assert.match(Buffer.from(model.gutterSvg('2b', '#ff0000').split(',')[1], 'base64').toString(), />2b</);
  assert.ok(model.nodeMarkdown(m.nodes[0]).includes(m.nodes[0].title));
  model.recordVisit(repo, 'src/payments/stripe.js');
  model.recordVisit(repo, 'src/payments/stripe.js');
  assert.equal(fs.readFileSync(path.join(repo, '.waymark', '.local', '.gitignore'), 'utf8'), '*\n');
  const s = suggestTopics(repo);
  assert.equal(s.viewedFiles[0].file, 'src/payments/stripe.js');
  assert.match(s.suggestions[0].reason, /recently viewed in the editor/);
});
