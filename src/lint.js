import { treeRefs } from './schema.js';
import { narrativeGaps } from './store.js';
import { checkState } from './state.js';
import { traceHash } from './anchor.js';

const REF_RE = /\[((?:\d+[a-z]{1,2})(?:\s*,\s*\d+[a-z]{1,2})*)\]/g;
const words = (s) => (String(s || '').trim().match(/\S+/g) || []).length;

function refsIn(text) {
  const out = [];
  for (const m of String(text || '').matchAll(REF_RE)) out.push(...m[1].split(/\s*,\s*/));
  return out;
}

/**
 * Static quality checks on a map's prose and structure (no code access needed).
 * error: broken references; warn: missing/weak narrative, uncited nodes, over-long labels.
 */
export function lintMap(doc, { mapIds = null } = {}) {
  const issues = [];
  const add = (level, where, message) => issues.push({ level, where, message });
  const ids = new Set(doc.traces.flatMap((t) => t.locations.map((l) => l.id)));

  const checkRefs = (where, text) => {
    for (const r of refsIn(text)) if (!ids.has(r)) add('error', where, `references unknown node [${r}]`);
  };
  checkRefs('description', doc.description);
  checkRefs('story', doc.story);
  for (const t of doc.traces) {
    checkRefs(`trace ${t.id} description`, t.description);
    checkRefs(`trace ${t.id} motivation`, t.motivation);
    checkRefs(`trace ${t.id} details`, t.details);
    for (const l of t.locations) {
      checkRefs(`[${l.id}] description`, l.description);
      checkRefs(`[${l.id}] explanation`, l.explanation);
    }
  }
  for (const l of doc.links || []) {
    if (!ids.has(l.from) || !ids.has(l.to)) add('error', 'links', `link ${l.from} -> ${l.to} references an unknown node`);
  }

  const gaps = narrativeGaps(doc);
  if (gaps.story) add('warn', 'story', 'missing holistic story');
  for (const id of gaps.motivation) add('warn', `trace ${id}`, 'missing motivation');
  for (const id of gaps.details) add('warn', `trace ${id}`, 'missing details');
  if (gaps.explanation.length) add('warn', 'explanations', `missing for ${gaps.explanation.map((x) => `[${x}]`).join(', ')}`);

  for (const t of doc.traces) {
    const cited = new Set(refsIn(t.details));
    if (t.details) {
      const uncited = t.locations.filter((l) => !cited.has(l.id)).map((l) => `[${l.id}]`);
      if (uncited.length) add('warn', `trace ${t.id} details`, `does not cite ${uncited.join(', ')}`);
    }
    const inTree = new Set(treeRefs(t.tree));
    const orphan = t.locations.filter((l) => !inTree.has(l.id)).map((l) => `[${l.id}]`);
    if (orphan.length) add('warn', `trace ${t.id} tree`, `nodes not placed in the tree: ${orphan.join(', ')}`);
    for (const l of t.locations) {
      if (words(l.title) > 6) add('warn', `[${l.id}] title`, `${words(l.title)} words (aim for <= 5)`);
      if (words(l.description) > 20) add('warn', `[${l.id}] description`, `${words(l.description)} words (aim for one sentence <= 15)`);
      if (l.explanation && l.explanation.trim().length < 80) add('warn', `[${l.id}] explanation`, 'very short; tell the story (3-6 sentences)');
    }
  }
  for (const t of doc.traces) {
    for (const l of t.locations) {
      const st = checkState(l);
      if (st === 'unsupported') add('error', `[${l.id}] fact-check`, `unsupported: ${(l.check.issues || []).join('; ') || 'see map'}`);
      else if (st === 'partial') add('warn', `[${l.id}] fact-check`, `partial: ${(l.check.issues || []).join('; ') || 'see map'}`);
      if (l.mapRef && mapIds && !mapIds.has(l.mapRef.split('#')[0])) add('error', `[${l.id}] mapRef`, `links to unknown map "${l.mapRef}"`);
    }
    if (t.check?.verdict === 'unsupported' && t.check.hash === traceHash(t)) add('error', `trace ${t.id} fact-check`, `unsupported: ${(t.check.issues || []).join('; ')}`);
  }
  if (doc.storyCheck?.verdict === 'unsupported') add('error', 'story fact-check', `unsupported: ${(doc.storyCheck.issues || []).join('; ')}`);

  const errors = issues.filter((i) => i.level === 'error').length;
  return { id: doc.id, errors, warnings: issues.length - errors, issues, ok: errors === 0 };
}
