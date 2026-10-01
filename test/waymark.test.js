import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'src', 'mcp.js');
const CLI = path.join(HERE, '..', 'src', 'cli.js');

let repo;
let client;

const sh = (args, cwd = repo) => execFileSync('git', args, { cwd, stdio: 'ignore' });
const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args });
  const t = res.content[0].text;
  if (res.isError) throw new Error(t);
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};

const MAP = {
  title: 'Order checkout',
  description: 'From HTTP handler to persisted order.',
  query: 'how does checkout work?',
  traces: [
    {
      title: 'Checkout request',
      description: 'Handler validates and delegates to the service.',
      locations: [
        { title: 'Handler', description: 'Entry.', path: 'src/http.js', lineNumber: 1, lineContent: 'export function handleCheckout(req) {', symbol: 'handleCheckout' },
        // Wrong line number on purpose: must be re-anchored to line 3.
        { title: 'Delegate', description: 'Calls service.', path: 'src/http.js', lineNumber: 9, lineContent: 'return placeOrder(req.body);' },
        { title: 'Persist', description: 'Writes the order.', path: 'src/service.js', lineNumber: 2, lineContent: 'db.insert(order);' },
      ],
      tree: [{ ref: '1a', children: [{ ref: '1b', children: [{ label: 'service layer', children: [{ ref: '1c' }] }] }] }],
      guide: 'The handler [1a] delegates [1b] and the service persists [1c].',
    },
  ],
};

before(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-test-'));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src/http.js'), 'export function handleCheckout(req) {\n  validate(req);\n  return placeOrder(req.body);\n}\n');
  fs.writeFileSync(path.join(repo, 'src/service.js'), 'export function placeOrder(order) {\n  db.insert(order);\n}\n');
  sh(['init', '-q']);
  sh(['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.']);
  sh(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init']);
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, WAYMARK_ROOT: repo } }));
});

after(async () => {
  await client?.close();
  fs.rmSync(repo, { recursive: true, force: true });
});

test('exposes tools, resource template and prompt', async () => {
  const { tools } = await client.listTools();
  for (const t of ['waymark_start', 'waymark_create', 'waymark_get', 'waymark_verify', 'waymark_find_anchor']) {
    assert.ok(tools.some((x) => x.name === t), `missing tool ${t}`);
  }
  const { resourceTemplates } = await client.listResourceTemplates();
  assert.equal(resourceTemplates[0].uriTemplate, 'waymark://{id}');
  const { prompts } = await client.listPrompts();
  assert.equal(prompts[0].name, 'create_waymark');
});

test('waymark_start returns the procedure and repo hints', async () => {
  const out = await call('waymark_start', { query: 'checkout' });
  assert.match(out, /Waymark agent/);
  assert.match(out, /root: /);
});

test('create anchors locations, writes JSON + HTML', async () => {
  const res = await call('waymark_create', { ...MAP, id: 'checkout' });
  assert.equal(res.id, 'checkout');
  assert.equal(res.anchors.healthy, true);
  assert.equal(res.anchors.moved, 1);
  assert.ok(fs.existsSync(res.html) && fs.existsSync(res.json));
  const doc = JSON.parse(fs.readFileSync(res.json, 'utf8'));
  assert.equal(doc.traces[0].locations[1].lineNumber, 3);
  assert.ok(doc.meta.commit);
  const html = fs.readFileSync(res.html, 'utf8');
  assert.ok(!/<\/script>[\s\S]*<\/script>[\s\S]*<\/script>[\s\S]*<\/script>/.test(html.replace(/<script>[\s\S]*?<\/script>/g, '')));
});

test('reports unresolved anchors without failing', async () => {
  const bad = structuredClone(MAP);
  bad.traces[0].locations[2].lineContent = 'thisLineDoesNotExist();';
  const res = await call('waymark_create', { ...bad, id: 'bad' });
  assert.equal(res.anchors.healthy, false);
  assert.equal(res.anchors.unresolved, 1);
  await call('waymark_delete', { id: 'bad' });
});

test('rejects paths outside the repo and dangling refs', async () => {
  const evil = structuredClone(MAP);
  evil.traces[0].locations[0].path = '../../etc/passwd';
  const res = await call('waymark_create', { ...evil, id: 'evil' });
  assert.equal(res.anchors.missing, 1);
  await call('waymark_delete', { id: 'evil' });
  const dangling = structuredClone(MAP);
  dangling.traces[0].tree = [{ ref: '9z' }];
  await assert.rejects(call('waymark_create', dangling), /unknown location/);
});

test('resource read returns markdown context with tree', async () => {
  const { resources } = await client.listResources();
  assert.ok(resources.some((r) => r.uri === 'waymark://checkout'));
  const { contents } = await client.readResource({ uri: 'waymark://checkout' });
  assert.match(contents[0].text, /\[1b\] Delegate {2}src\/http\.js:3/);
  assert.match(contents[0].text, /service layer/);
});

test('verify detects drift and fixes it; follows renamed files', async () => {
  fs.writeFileSync(
    path.join(repo, 'src/http.js'),
    '// header\n// more\nexport function handleCheckout(req) {\n  validate(req);\n  return placeOrder(req.body);\n}\n',
  );
  let [v] = await call('waymark_verify', { id: 'checkout' });
  assert.equal(v.stale, true);
  assert.equal(v.broken, 0);
  assert.deepEqual(v.changes.map((c) => c.to), ['src/http.js:3', 'src/http.js:5']);

  sh(['mv', 'src/service.js', 'src/order-service.js']);
  fs.mkdirSync(path.join(repo, 'src/orders'));
  sh(['mv', 'src/order-service.js', 'src/orders/service.js']);
  [v] = await call('waymark_verify', { id: 'checkout', fix: true });
  assert.equal(v.counts.relocated, 1);
  assert.equal(v.fixed, true);
  const md = await call('waymark_get', { id: 'check', format: 'compact' });
  assert.match(md, /src\/orders\/service\.js:2/);
});

test('find_anchor and mermaid output', async () => {
  const f = await call('waymark_find_anchor', { path: 'src/http.js', pattern: 'placeOrder' });
  assert.equal(f.hits[0].lineNumber, 5);
  const mmd = await call('waymark_get', { id: 'checkout', format: 'mermaid' });
  assert.match(mmd, /^flowchart TD/);
  assert.match(mmd, /n_1a --> n_1b/);
});

test('CLI verify --strict exit codes', () => {
  const run = (...a) => {
    try {
      execFileSync(process.execPath, [CLI, ...a, '--root', repo], { stdio: 'pipe' });
      return 0;
    } catch (e) {
      return e.status;
    }
  };
  assert.equal(run('verify', '--strict'), 0);
  fs.writeFileSync(path.join(repo, 'src/http.js'), 'export const nothing = 1;\n');
  assert.equal(run('verify'), 1);
});

test('install wires Claude Code + Codex and is idempotent', async () => {
  const { install } = await import('../src/install.js');
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-install-'));
  fs.mkdirSync(path.join(target, '.codex'));
  fs.writeFileSync(path.join(target, '.codex', 'config.toml'), 'model = "x"\n');
  install({ target });
  install({ target }); // second run must not duplicate managed blocks
  const toml = fs.readFileSync(path.join(target, '.codex', 'config.toml'), 'utf8');
  assert.match(toml, /^model = "x"/);
  assert.equal(toml.match(/\[mcp_servers\.waymark\]/g).length, 1);
  for (const f of [
    '.mcp.json',
    '.claude/agents/waymark.md',
    '.claude/commands/waymark.md',
    '.claude/skills/waymark/SKILL.md',
    '.codex/agents/waymark.toml',
    '.agents/skills/waymark/SKILL.md',
    '.agents/skills/waymark/agents/openai.yaml',
  ]) assert.ok(fs.existsSync(path.join(target, f)), `missing ${f}`);
  const agents = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
  assert.equal(agents.match(/## Waymark/g).length, 1);
  const agentToml = fs.readFileSync(path.join(target, '.codex', 'agents', 'waymark.toml'), 'utf8');
  assert.match(agentToml, /^name = "waymark"$/m);
  assert.match(agentToml, /sandbox_mode = "read-only"/);
  fs.rmSync(target, { recursive: true, force: true });
});

test('file hashes ignore CRLF vs LF (Windows autocrlf checkouts)', async () => {
  const { FileCache } = await import('../src/anchor.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-eol-'));
  fs.writeFileSync(path.join(dir, 'lf.js'), 'a\nb\n');
  fs.writeFileSync(path.join(dir, 'crlf.js'), 'a\r\nb\r\n');
  const c = new FileCache(dir);
  assert.equal(c.read('lf.js').hash, c.read('crlf.js').hash);
  fs.rmSync(dir, { recursive: true, force: true });
});
