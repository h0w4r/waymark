import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { saveMap, loadMap, annotateMap, narrativeGaps } from '../src/store.js';
import { normalizeMap } from '../src/schema.js';
import { renderMarkdown } from '../src/render/markdown.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let repo;
let client;

const MAP = {
  title: 'Greeting flow',
  description: 'How a greeting is built [1a] and printed [1b].',
  language: 'en',
  traces: [
    {
      title: 'Build and print',
      description: 'Builds the text and prints it.',
      diagramTitle: 'Greeting Pipeline',
      locations: [
        { title: 'Build text', description: 'Concatenates the name.', path: 'app.js', lineNumber: 1, lineContent: 'export function greet(name) {' },
        { title: 'Print', description: 'Writes to stdout.', path: 'app.js', lineNumber: 4, lineContent: 'console.log(greet(process.argv[2]));' },
      ],
      tree: [{ ref: '1a', children: [{ label: 'template literal' }, { ref: '1b', via: 'returns string' }] }],
    },
  ],
};

before(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-narr-'));
  fs.writeFileSync(path.join(repo, 'app.js'), 'export function greet(name) {\r\n  return `hi ${name} </script>`;\r\n}\r\nconsole.log(greet(process.argv[2]));\r\n');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [path.join(HERE, '..', 'src', 'mcp.js')], env: { ...process.env, WAYMARK_ROOT: repo } }),
  );
});

after(async () => {
  await client?.close();
  fs.rmSync(repo, { recursive: true, force: true });
});

test('legacy "guide" becomes "details"; ids are validated', () => {
  const m = normalizeMap({ ...MAP, traces: [{ ...MAP.traces[0], guide: 'old guide' }] });
  assert.equal(m.traces[0].details, 'old guide');
  assert.equal(m.traces[0].guide, undefined);
  const bad = structuredClone(MAP);
  bad.traces[0].locations[0].id = '1a" onmouseover="x';
  assert.throws(() => normalizeMap(bad), /Invalid location id/);
});

test('create reports missing narrative; annotate fills it without re-anchoring', () => {
  const { doc, narrative } = saveMap(repo, MAP, { id: 'greet' });
  assert.equal(narrative.complete, false);
  assert.equal(narrative.story, true);
  assert.deepEqual(narrative.explanation, ['1a', '1b']);
  const before = JSON.stringify(doc.traces[0].locations.map((l) => [l.path, l.lineNumber]));

  const res = annotateMap(repo, 'greet', {
    story: 'Once upon a time a name arrived [1a]...',
    traces: [{ id: '1', motivation: 'Users like being greeted.', details: 'First [1a], then [1b].' }],
    locations: [
      { id: '1a', explanation: 'Here the name becomes a sentence.' },
      { id: '1b', explanation: 'And here it reaches the terminal.' },
      { id: '9z', explanation: 'nope' },
    ],
  });
  assert.equal(res.narrative.complete, true);
  assert.deepEqual(res.unknown, ['location 9z']);
  const after = loadMap(repo, 'greet');
  assert.equal(JSON.stringify(after.traces[0].locations.map((l) => [l.path, l.lineNumber])), before);
  assert.equal(narrativeGaps(after).complete, true);
});

test('viewer embeds files (LF-normalized), story and is script-safe', () => {
  const html = fs.readFileSync(path.join(repo, '.waymark', 'greet.html'), 'utf8');
  const data = JSON.parse(html.match(/<script id="waymark-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.files['app.js'].includes('\r'), false);
  assert.match(data.files['app.js'], /console\.log/);
  assert.equal(data.doc.story.startsWith('Once upon'), true);
  // The literal "</script>" inside the embedded file must not terminate the data island.
  assert.equal((html.match(/<\/script>/g) || []).length, 2);
  assert.match(html, /id="dg"/);
  assert.match(html, /AI generated guide|viewer/);
});

test('markdown context carries the narrative; compact omits it', () => {
  const doc = loadMap(repo, 'greet');
  const full = renderMarkdown(doc, { detail: 'full' });
  assert.match(full, /## The story/);
  assert.match(full, /### Motivation/);
  assert.match(full, /Here the name becomes a sentence/);
  assert.match(full, /\(returns string\) \[1b\]/);
  const compact = renderMarkdown(doc, { detail: 'compact' });
  assert.doesNotMatch(compact, /## The story|Here the name becomes/);
});

test('MCP: waymark_enrich returns procedure + gaps; waymark_annotate patches', async () => {
  saveMap(repo, MAP, { id: 'greet2' });
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw new Error(r.content[0].text);
    return r.content[0].text;
  };
  const enrich = await call('waymark_enrich', { id: 'greet2' });
  assert.match(enrich, /Missing narrative/);
  assert.match(enrich, /waymark_annotate/);
  const res = JSON.parse(await call('waymark_annotate', { id: 'greet2', story: 'A story.', locations: [{ id: '1a', explanation: 'x' }] }));
  assert.equal(res.changed, 2);
  assert.deepEqual(res.narrative.explanation, ['1b']);
  const start = await call('waymark_start', { query: 'greeting', mode: 'fast' });
  assert.match(start, /FAST mode/);
  assert.match(start, /storytelling/);
});
