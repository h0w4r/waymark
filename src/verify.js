import { FileCache, anchorLocation } from './anchor.js';
import { headCommit } from './git.js';
import { loadMap, persist, writeHtml, narrativeDrift, baselineNarrative } from './store.js';

/**
 * Re-checks every anchor of a stored waymark against the current working tree, and
 * whether the prose still describes the code it was written for (narrative drift).
 * With fix=true, corrected line numbers/snippets/context hashes are written back
 * (narrative baselines are kept, so drifted prose stays flagged until it is rewritten).
 */
export function verifyMap(root, id, { fix = false } = {}) {
  const doc = loadMap(root, id);
  const cache = new FileCache(root);
  const changes = [];
  const changedFiles = new Set();
  const counts = { ok: 0, moved: 0, fuzzy: 0, relocated: 0, unresolved: 0, missing: 0 };
  let ctxChanged = false;

  const fresh = { ...doc, traces: [] };
  for (const trace of doc.traces) {
    const results = trace.locations.map((loc) => {
      const r = anchorLocation(cache, loc);
      counts[r.status]++;
      if (loc.fileHash && r.fileHash && loc.fileHash !== r.fileHash) changedFiles.add(r.path);
      if (r.ctxHash !== loc.ctxHash) ctxChanged = true;
      if (r.status !== 'ok' || r.lineNumber !== loc.lineNumber || r.path !== loc.path) {
        changes.push({
          id: loc.id,
          status: r.status,
          from: `${loc.path}:${loc.lineNumber}`,
          to: `${r.path}:${r.lineNumber}`,
          note: r.note,
        });
      }
      return r;
    });
    fresh.traces.push({ ...trace, locations: results });
    if (fix) trace.locations = results;
  }

  // Maps created before narrative tracking get a baseline instead of a false alarm.
  baselineNarrative(fresh);
  const drift = narrativeDrift(fresh);

  const broken = counts.unresolved + counts.missing;
  const result = {
    id: doc.id,
    title: doc.title,
    mapCommit: doc.meta?.commit?.slice(0, 8) || null,
    headCommit: headCommit(root)?.slice(0, 8) || null,
    counts,
    changedFiles: [...changedFiles],
    changes,
    narrative: drift,
    stale: changes.length > 0 || changedFiles.size > 0,
    broken,
    fixed: false,
  };
  const needsBaseline = doc.traces.some((t) => !t.narrativeHash || t.locations.some((l) => !l.narrativeHash));
  if (fix && (changes.length || changedFiles.size || ctxChanged || needsBaseline)) {
    baselineNarrative(doc);
    doc.meta = {
      ...doc.meta,
      verifiedAt: new Date().toISOString(),
      commit: headCommit(root),
      anchors: { ...counts },
      narrativeDrift: drift.stale ? { nodes: drift.nodes, traces: drift.traces, story: drift.story } : undefined,
    };
    persist(root, doc);
    writeHtml(root, doc);
    result.fixed = true;
  }
  return result;
}
