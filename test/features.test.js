import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { saveMap, loadMap, annotateMap, noteMap, recordCheck, checkSummary, listMaps } from '../src/store.js';
import { checkState, execState } from '../src/state.js';
import { lintMap } from '../src/lint.js';
import { diffMaps, renderDiff } from '../src/diff.js';
import { parseLcov, execResults, applyCoverage, runWithV8Coverage } from '../src/coverage.js';
import { createPlan, addTrace, draftStatus, finalizeDraft } from '../src/parallel.js';
import { renderMarkdown } from '../src/render/markdown.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let repo;
const git = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=Tester', ...a], { cwd: repo, stdio: 'pipe' });
const SRC = [
  'export function parse(input) {',
  '  const parts = input.split(",");',
  '  return parts.map((p) => p.trim());',
  '}',
  '',
  'export function total(input) {',
  '  const nums = parse(input).map(Number);',
  '  return nums.reduce((a, b) => a + b, 0);',
  '}',
  '',
  'export function unused() {',
  '  return 42;',
  '}',
  '',
].join('\n');
const LOC = (title, lineNumber, lineContent, extra = {}) => ({ title, description: `${title} step.`, explanation: `Story of ${title}.`, path: 'calc.mjs', lineNumber, lineContent, ...extra });
const MAP = {
  title: 'Calculator',
  description: 'total [1a] parses [1b] and sums.',
  story: 'Numbers arrive as text [1b] and leave as a sum [1a].',
  traces: [
    {
      title: 'Sum', description: 'Sum a CSV of numbers.', motivation: 'Users type CSV.', details: 'total [1a] calls parse [1b]; unused [1c] is dead code.',
      locations: [
        LOC('total', 6, 'export function total(input) {'),
        LOC('parse', 1, 'export function parse(input) {'),
        LOC('unused', 11, 'export function unused() {'),
      ],
    },
  ],
};

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-features-'));
  fs.writeFileSync(path.join(repo, 'calc.mjs'), SRC);
  git('init', '-q');
  saveMap(repo, MAP, { id: 'calc' });
  git('add', '.');
  git('commit', '-q', '-m', 'init');
});
after(() => fs.rmSync(repo, { recursive: true, force: true }));

test('fact-check verdicts: recorded, summarized, voided when code or prose change, lint errors', () => {
  const r = recordCheck(repo, 'calc', {
    nodes: [
      { id: '1a', verdict: 'supported' },
      { id: '1b', verdict: 'partial', issues: ['does not say it trims'] },
      { id: '1c', verdict: 'unsupported', issues: ['claims it is used'] },
    ],
    traces: [{ id: '1', verdict: 'supported' }],
    checker: 'test',
  });
  assert.deepEqual(r.unknown, []);
  let doc = loadMap(repo, 'calc');
  assert.equal(checkSummary(doc).supported, 1);
  assert.equal(lintMap(doc).errors, 1); // unsupported → error
  annotateMap(repo, 'calc', { locations: [{ id: '1a', explanation: 'Rewritten story of total.' }] });
  doc = loadMap(repo, 'calc');
  assert.equal(checkState(doc.traces[0].locations[0]), 'stale'); // prose changed → verdict void
  assert.equal(checkState(doc.traces[0].locations[1]), 'partial');
  const md = renderMarkdown(doc, { detail: 'compact' });
  assert.match(md, /◑ partially verified: does not say it trims/);
  assert.match(md, /✗ fact-check failed: claims it is used/);
});

test('human notes: added, shown in context, kept when the map is re-created', () => {
  noteMap(repo, 'calc', '1b', { text: 'CSV may contain spaces', author: 'Ana' });
  saveMap(repo, MAP, { id: 'calc' }); // agent re-creates the map
  const doc = loadMap(repo, 'calc');
  const n = doc.traces[0].locations.find((l) => l.id === '1b').notes;
  assert.equal(n.length, 1);
  assert.equal(n[0].author, 'Ana');
  assert.match(renderMarkdown(doc), /Team note \(Ana, .*\): CSV may contain spaces/);
  noteMap(repo, 'calc', '1b', { remove: 0 });
  assert.equal(loadMap(repo, 'calc').traces[0].locations.find((l) => l.id === '1b').notes, undefined);
  assert.throws(() => noteMap(repo, 'calc', '9z', { text: 'x' }), /not found/);
});

test('diff: touched nodes by block, untouched ones ignored, markdown report', () => {
  git('add', '.');
  git('commit', '-q', '-m', 'map');
  fs.writeFileSync(path.join(repo, 'calc.mjs'), SRC.replace('return parts.map((p) => p.trim());', 'return parts.map((p) => p.trim()).filter(Boolean);'));
  const rep = diffMaps(repo, 'HEAD');
  assert.equal(rep.maps.length, 1);
  assert.deepEqual(rep.maps[0].touched.map((t) => t.id), ['1b']);
  assert.ok(rep.maps[0].drift.nodes.includes('1b'));
  const md = renderDiff(rep);
  assert.match(md, /`1b` parse \| `calc\.mjs:1-4`/);
  assert.match(md, /waymark refresh calc/);
  fs.writeFileSync(path.join(repo, 'calc.mjs'), SRC);
  assert.match(renderDiff(diffMaps(repo, 'HEAD')), /No documented flow is affected/);
});

test('execution: LCOV from any tool and real V8 coverage from a test command', () => {
  const lcov = ['SF:calc.mjs', 'DA:6,3', 'DA:7,3', 'DA:1,3', 'DA:2,3', 'DA:11,0', 'DA:12,0', 'end_of_record'].join('\n');
  const cov = parseLcov(lcov, repo);
  assert.deepEqual(execResults(loadMap(repo, 'calc'), cov), { '1a': { hit: true, count: 3 }, '1b': { hit: true, count: 3 }, '1c': { hit: false, count: 0 } });
  applyCoverage(repo, cov, { ids: ['calc'], source: 'lcov' });
  const doc = loadMap(repo, 'calc');
  assert.equal(execState(doc.traces[0].locations[2]), 'miss');
  assert.equal(doc.meta.exec.hit, 2);

  // Real V8: a tiny script that calls total() but never unused().
  fs.writeFileSync(path.join(repo, 'run.mjs'), "import { total } from './calc.mjs';\nconsole.log(total('1, 2'));\n");
  const res = runWithV8Coverage(repo, process.execPath, ['run.mjs']);
  assert.equal(res.status, 0);
  const v8 = execResults(loadMap(repo, 'calc'), res.coverage);
  assert.equal(v8['1a'].hit, true);
  assert.equal(v8['1b'].hit, true);
  assert.equal(v8['1c'].hit, false);
});

test('parallel drafts: plan, traces renumbered and anchored, finalize into a map', () => {
  const plan = createPlan(repo, { query: 'calc', title: 'Calc parallel', language: 'en', traces: [{ title: 'Parse', focus: 'parse' }, { title: 'Sum', focus: 'sum' }] });
  const r2 = addTrace(repo, plan.draft, 2, {
    title: 'Sum', description: 'Sums.', locations: [LOC('total', 6, 'export function total(input) {', { id: 'x' })],
    tree: [{ ref: 'x' }], details: 'Total [x] sums.',
  });
  assert.deepEqual(r2.remapped, { x: '2a' });
  assert.deepEqual(draftStatus(repo, plan.draft).missing, [1]);
  addTrace(repo, plan.draft, 1, { title: 'Parse', description: 'Parses.', locations: [LOC('parse', 9, 'export function parse(input) {')] });
  const { doc, report } = finalizeDraft(repo, plan.draft, { description: 'Parse [1a] then sum [2a].', story: 'Two steps.', links: [{ from: '1a', to: '2a', label: 'numbers' }] });
  assert.equal(report.healthy, true);
  assert.deepEqual(doc.traces.map((t) => t.locations.map((l) => l.id)), [['1a'], ['2a']]);
  assert.equal(doc.traces[1].details, 'Total [2a] sums.');
  assert.equal(doc.traces[0].locations[0].lineNumber, 1); // re-anchored from the wrong line 9
  assert.equal(fs.existsSync(path.join(repo, '.waymark', '.drafts', plan.draft)), false);
});

test('overview maps: mapRef links, unknown refs are lint errors, index lists maps', () => {
  const { doc } = saveMap(repo, {
    title: 'System overview', description: 'Calc [1a].', kind: 'overview',
    traces: [{ title: 'Core', description: 'Core.', locations: [LOC('total', 6, 'export function total(input) {', { mapRef: 'calc#1a' }), LOC('parse', 1, 'export function parse(input) {', { mapRef: 'ghost' })] }],
  }, { id: 'overview' });
  const res = lintMap(doc, { mapIds: new Set(listMaps(repo).map((m) => m.id)) });
  assert.equal(res.issues.filter((i) => /unknown map "ghost"/.test(i.message)).length, 1);
  assert.match(renderMarkdown(doc), /→ detailed map: waymark:\/\/calc\/1a/);
  const index = fs.readFileSync(path.join(repo, '.waymark', 'index.html'), 'utf8');
  assert.ok(index.indexOf('System overview') < index.indexOf('Calculator')); // overview first
  const html = fs.readFileSync(path.join(repo, '.waymark', 'overview.html'), 'utf8');
  assert.match(html, /"maps":\[/);
});

test('bundled CLI/MCP (plugin/dist) serves the new tools', { skip: !fs.existsSync(path.join(HERE, '..', 'plugin', 'dist', 'waymark.mjs')) }, async () => {
  const client = new Client({ name: 't', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(HERE, '..', 'plugin', 'dist', 'waymark.mjs'), 'mcp'], env: { ...process.env, WAYMARK_ROOT: repo } }));
  try {
    const { tools } = await client.listTools();
    for (const t of ['waymark_check', 'waymark_record_check', 'waymark_note', 'waymark_diff', 'waymark_exec', 'waymark_plan', 'waymark_add_trace', 'waymark_finalize']) {
      assert.ok(tools.some((x) => x.name === t), `missing ${t}`);
    }
    const r = await client.callTool({ name: 'waymark_check', arguments: { id: 'calc' } });
    assert.match(r.content[0].text, /fact-checker/);
    const html = await client.callTool({ name: 'waymark_render', arguments: { id: 'calc' } });
    assert.ok(!html.isError, html.content[0].text);
  } finally {
    await client.close();
  }
});
