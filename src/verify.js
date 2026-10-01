import { FileCache, anchorLocation } from './anchor.js';
import { headCommit } from './git.js';
import { loadMap, persist, writeHtml } from './store.js';

/**
 * Re-checks every anchor of a stored waymark against the current working tree.
 * With fix=true, corrected line numbers/snippets are written back.
 */
export function verifyMap(root, id, { fix = false } = {}) {
  const doc = loadMap(root, id);
  const cache = new FileCache(root);
  const changes = [];
  const changedFiles = new Set();
  const counts = { ok: 0, moved: 0, fuzzy: 0, relocated: 0, unresolved: 0, missing: 0 };

  for (const trace of doc.traces) {
    trace.locations = trace.locations.map((loc) => {
      const r = anchorLocation(cache, loc);
      counts[r.status]++;
      if (loc.fileHash && r.fileHash && loc.fileHash !== r.fileHash) changedFiles.add(r.path);
      if (r.status !== 'ok' || r.lineNumber !== loc.lineNumber || r.path !== loc.path) {
        changes.push({
          id: loc.id,
          status: r.status,
          from: `${loc.path}:${loc.lineNumber}`,
          to: `${r.path}:${r.lineNumber}`,
          note: r.note,
        });
      }
      return fix ? r : loc;
    });
  }

  const broken = counts.unresolved + counts.missing;
  const result = {
    id: doc.id,
    title: doc.title,
    mapCommit: doc.meta?.commit?.slice(0, 8) || null,
    headCommit: headCommit(root)?.slice(0, 8) || null,
    counts,
    changedFiles: [...changedFiles],
    changes,
    stale: changes.length > 0 || changedFiles.size > 0,
    broken,
    fixed: false,
  };
  if (fix && (changes.length || changedFiles.size)) {
    doc.meta = { ...doc.meta, verifiedAt: new Date().toISOString(), commit: headCommit(root), anchors: { ...counts } };
    persist(root, doc);
    writeHtml(root, doc);
    result.fixed = true;
  }
  return result;
}
