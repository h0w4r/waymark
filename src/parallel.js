import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { TraceInput, normalizeMap, letterId } from './schema.js';
import { anchorMap } from './anchor.js';
import { mapDir, saveMap } from './store.js';

/*
 * Parallel generation: plan → N independent traces → finalize.
 *  .waymark/.drafts/<draft>/plan.json       { query, title, language, traces: [{ n, title, focus, hints }] }
 *  .waymark/.drafts/<draft>/trace-<n>.json  one finished trace per file (no write races between agents)
 */

const draftsDir = (root) => path.join(mapDir(root), '.drafts');
const draftDir = (root, draft) => {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(draft)) throw new Error(`Invalid draft id "${draft}"`);
  return path.join(draftsDir(root), draft);
};
const slug = (s) =>
  String(s)
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'map';

export function createPlan(root, { query, title, language, mode = 'smart', kind = 'flow', traces }) {
  if (!Array.isArray(traces) || !traces.length) throw new Error('A plan needs at least one trace');
  const draft = `${slug(title)}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = draftDir(root, draft);
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(draftsDir(root), '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n');
  const plan = {
    draft,
    query,
    title,
    language,
    mode,
    kind,
    createdAt: new Date().toISOString(),
    traces: traces.map((t, i) => ({ n: i + 1, title: t.title, focus: t.focus || '', hints: t.hints || [] })),
  };
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2));
  return plan;
}

export function loadPlan(root, draft) {
  return JSON.parse(fs.readFileSync(path.join(draftDir(root, draft), 'plan.json'), 'utf8'));
}

export function listDrafts(root) {
  if (!fs.existsSync(draftsDir(root))) return [];
  return fs
    .readdirSync(draftsDir(root))
    .filter((d) => fs.existsSync(path.join(draftsDir(root), d, 'plan.json')))
    .map((d) => draftStatus(root, d));
}

/** Validates, ids and anchors ONE trace (number n of the plan) and stores it. */
export function addTrace(root, draft, n, traceInput) {
  const plan = loadPlan(root, draft);
  const slot = plan.traces.find((t) => t.n === Number(n));
  if (!slot) throw new Error(`Trace ${n} is not in plan ${draft}`);
  const trace = TraceInput.parse(traceInput);
  trace.id = String(n);
  // Force the "<n><letter>" id scheme so traces built in parallel never collide.
  const remap = new Map();
  trace.locations.forEach((l, i) => {
    const nid = `${n}${letterId(i)}`;
    if (l.id && l.id !== nid) remap.set(l.id, nid);
    l.id = nid;
  });
  const fixRefs = (nodes) => (nodes || []).forEach((x) => {
    if (x.ref && remap.has(x.ref)) x.ref = remap.get(x.ref);
    fixRefs(x.children);
  });
  fixRefs(trace.tree);
  const fixText = (s) => (s ? s.replace(/\[([A-Za-z0-9_-]{1,16})\]/g, (m, id) => (remap.has(id) ? `[${remap.get(id)}]` : m)) : s);
  for (const k of ['description', 'motivation', 'details', 'guide']) trace[k] = fixText(trace[k]);
  for (const l of trace.locations) {
    l.description = fixText(l.description);
    l.explanation = fixText(l.explanation);
  }
  // Validate + anchor through the regular pipeline, on a one-trace map.
  const mini = normalizeMap({ title: plan.title, description: '-', traces: [trace] });
  const report = anchorMap(root, mini);
  fs.writeFileSync(path.join(draftDir(root, draft), `trace-${n}.json`), JSON.stringify(mini.traces[0], null, 2));
  return { draft, n: Number(n), anchors: { ...report }, remapped: Object.fromEntries(remap) };
}

export function draftStatus(root, draft) {
  const plan = loadPlan(root, draft);
  const done = plan.traces.filter((t) => fs.existsSync(path.join(draftDir(root, draft), `trace-${t.n}.json`))).map((t) => t.n);
  return { draft, title: plan.title, query: plan.query, total: plan.traces.length, done, missing: plan.traces.filter((t) => !done.includes(t.n)).map((t) => t.n), plan };
}

/** Finished traces of a draft (for the finalize step: story, summary and links). */
export function draftTraces(root, draft) {
  const plan = loadPlan(root, draft);
  return plan.traces
    .map((t) => {
      const f = path.join(draftDir(root, draft), `trace-${t.n}.json`);
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    })
    .filter(Boolean);
}

/** Merges the traces into a regular map (anchored again, HTML written) and removes the draft. */
export function finalizeDraft(root, draft, { title, description, story, language, links, tags, id } = {}) {
  const plan = loadPlan(root, draft);
  const traces = draftTraces(root, draft).map((t) => {
    const { locations, ...rest } = t;
    return { ...rest, locations: locations.map(({ status, note, snippet, fileHash, ctxHash, narrativeHash, ...l }) => l) };
  });
  if (!traces.length) throw new Error(`Draft ${draft} has no finished traces`);
  const res = saveMap(
    root,
    { title: title || plan.title, description, story, language: language || plan.language, query: plan.query, kind: plan.kind, links, tags, traces },
    { id: id || draft },
  );
  fs.rmSync(draftDir(root, draft), { recursive: true, force: true });
  return res;
}
