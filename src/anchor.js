import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { trackedFiles } from './git.js';

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const SNIPPET_BEFORE = 3;
const SNIPPET_AFTER = 14;

const norm = (s) => (s || '').trim().replace(/\s+/g, ' ');

/** Resolves a repo-relative path, refusing anything that escapes the root. */
export function safeJoin(root, rel) {
  const abs = path.resolve(root, rel);
  const relBack = path.relative(root, abs);
  if (relBack.startsWith('..') || path.isAbsolute(relBack)) {
    throw new Error(`Path "${rel}" is outside the repository root`);
  }
  return abs;
}

export class FileCache {
  constructor(root) {
    this.root = root;
    this.files = new Map();
    this._tracked = undefined;
  }

  read(rel) {
    if (this.files.has(rel)) return this.files.get(rel);
    let entry = null;
    try {
      const abs = safeJoin(this.root, rel);
      const stat = fs.statSync(abs);
      if (stat.isFile() && stat.size <= MAX_FILE_BYTES) {
        const text = fs.readFileSync(abs, 'utf8');
        entry = {
          lines: text.split(/\r?\n/),
          hash: crypto.createHash('sha1').update(text).digest('hex').slice(0, 12),
        };
      }
    } catch {
      entry = null;
    }
    this.files.set(rel, entry);
    return entry;
  }

  /** Finds a moved/renamed file by basename when the original path is gone. */
  findByBasename(rel) {
    if (this._tracked === undefined) this._tracked = trackedFiles(this.root);
    if (!this._tracked) return null;
    const base = path.posix.basename(rel);
    const hits = this._tracked.filter((f) => path.posix.basename(f) === base);
    if (hits.length === 1) return hits[0];
    // Prefer the candidate sharing the longest path suffix.
    const parts = rel.split('/');
    let best = null;
    let bestScore = 0;
    for (const h of hits) {
      const hp = h.split('/');
      let s = 0;
      while (s < parts.length && s < hp.length && parts[parts.length - 1 - s] === hp[hp.length - 1 - s]) s++;
      if (s > bestScore) [best, bestScore] = [h, s];
      else if (s === bestScore) best = null;
    }
    return bestScore > 1 ? best : null;
  }
}

function nearest(indices, target) {
  return indices.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
}

/**
 * Checks a location against the working tree and corrects its line number.
 * status: ok | moved (same text, other line) | fuzzy (partial match) | relocated (file moved)
 *         | unresolved (text not found) | missing (file not found)
 */
export function anchorLocation(cache, loc) {
  let relPath = loc.path;
  let file = cache.read(relPath);
  let relocatedFrom = null;
  if (!file) {
    const alt = cache.findByBasename(relPath);
    if (alt && (file = cache.read(alt))) {
      relocatedFrom = relPath;
      relPath = alt;
    }
  }
  if (!file) {
    return { ...loc, status: 'missing', note: `File not found: ${loc.path}` };
  }

  const { lines } = file;
  const wanted = norm(loc.lineContent);
  const idx0 = Math.min(Math.max(loc.lineNumber - 1, 0), lines.length - 1);
  let idx = -1;
  let status = 'unresolved';

  if (!wanted || norm(lines[idx0]) === wanted) {
    idx = idx0;
    status = 'ok';
  } else {
    const exact = [];
    lines.forEach((l, i) => norm(l) === wanted && exact.push(i));
    if (exact.length) {
      idx = nearest(exact, idx0);
      status = 'moved';
    } else {
      const partial = [];
      if (wanted.length >= 6) {
        lines.forEach((l, i) => {
          const n = norm(l);
          if (n.length >= 6 && (n.includes(wanted) || wanted.includes(n))) partial.push(i);
        });
      }
      if (!partial.length && loc.symbol) {
        const re = new RegExp(`\\b${loc.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        lines.forEach((l, i) => re.test(l) && partial.push(i));
      }
      if (partial.length) {
        idx = nearest(partial, idx0);
        status = 'fuzzy';
      }
    }
  }
  if (relocatedFrom && (status === 'ok' || status === 'moved')) status = 'relocated';

  const anchorIdx = idx >= 0 ? idx : idx0;
  const start = Math.max(0, anchorIdx - SNIPPET_BEFORE);
  const end = Math.min(lines.length, anchorIdx + SNIPPET_AFTER + 1);
  const result = {
    ...loc,
    path: relPath,
    lineNumber: anchorIdx + 1,
    status,
    fileHash: file.hash,
    snippet: { startLine: start + 1, code: lines.slice(start, end).join('\n') },
  };
  if (idx >= 0) result.lineContent = lines[anchorIdx].trim();
  const notes = [];
  if (relocatedFrom) notes.push(`file moved from ${relocatedFrom}`);
  if (status !== 'ok' && status !== 'unresolved' && loc.lineNumber !== anchorIdx + 1) {
    notes.push(`line ${loc.lineNumber} -> ${anchorIdx + 1}`);
  }
  if (status === 'fuzzy') notes.push('partial text match; double-check');
  if (status === 'unresolved') notes.push(`line content not found in ${relPath}: "${loc.lineContent}"`);
  if (notes.length) result.note = notes.join('; ');
  else delete result.note;
  return result;
}

/** Anchors every location of a normalized map in place; returns a summary report. */
export function anchorMap(root, map) {
  const cache = new FileCache(root);
  const report = { ok: 0, moved: 0, fuzzy: 0, relocated: 0, unresolved: 0, missing: 0, issues: [] };
  for (const trace of map.traces) {
    trace.locations = trace.locations.map((loc) => {
      const r = anchorLocation(cache, loc);
      report[r.status]++;
      if (r.status !== 'ok') report.issues.push({ id: r.id, status: r.status, path: r.path, note: r.note });
      return r;
    });
  }
  report.total = map.traces.reduce((n, t) => n + t.locations.length, 0);
  report.healthy = report.unresolved === 0 && report.missing === 0;
  return report;
}

/** Search helper for agents: lines in a file matching a regex or literal, with numbers. */
export function findInFile(root, rel, pattern, { regex = false, limit = 20 } = {}) {
  const cache = new FileCache(root);
  const file = cache.read(rel.replace(/\\/g, '/'));
  if (!file) throw new Error(`File not found or unreadable: ${rel}`);
  const re = regex ? new RegExp(pattern) : null;
  const hits = [];
  file.lines.forEach((l, i) => {
    if (hits.length < limit && (re ? re.test(l) : l.includes(pattern))) {
      hits.push({ lineNumber: i + 1, lineContent: l.trim() });
    }
  });
  return { path: rel, totalLines: file.lines.length, hits };
}
