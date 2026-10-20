import crypto from 'node:crypto';

// Small, dependency-free helpers shared by the store and the renderers.

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

/** Hash of the prose a fact-check judged (title + description + explanation). */
export const proseHash = (l) => sha([l.title, l.description, l.explanation || ''].join('|'));

/** supported | partial | unsupported | unchecked | stale (code or prose changed since the check). */
export function checkState(l) {
  if (!l.check) return 'unchecked';
  if (l.check.ctxHash !== l.ctxHash || l.check.proseHash !== proseHash(l)) return 'stale';
  return l.check.verdict;
}

/** hit | miss | unknown | stale (code changed since coverage was taken). */
export function execState(l) {
  if (!l.exec) return 'unknown';
  if (l.exec.ctxHash !== l.ctxHash) return 'stale';
  return l.exec.hit ? 'hit' : 'miss';
}
