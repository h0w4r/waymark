import fs from 'node:fs';
import path from 'node:path';
import { recentFiles, recentSubjects, trackedFiles } from './git.js';

const ENTRY_RE =
  /(^|\/)(main|index|app|server|cli|program|startup|bootstrap|routes?|router|urls|handler|controller|api)\.[a-z]+$/i;
const IGNORE_RE = /(^|\/)(node_modules|dist|build|vendor|\.git|\.waymark|coverage|__tests__|tests?|spec)\//i;

/** Ranks entry-point-looking files near the top of the tree. */
function entryPoints(root, files) {
  const out = new Set();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg.main) out.add(pkg.main.replace(/^\.\//, ''));
    if (typeof pkg.bin === 'string') out.add(pkg.bin.replace(/^\.\//, ''));
    else if (pkg.bin) Object.values(pkg.bin).forEach((b) => out.add(String(b).replace(/^\.\//, '')));
  } catch {
    /* not a node project */
  }
  (files || [])
    .filter((f) => ENTRY_RE.test(f) && !IGNORE_RE.test(f))
    .sort((a, b) => a.split('/').length - b.split('/').length)
    .slice(0, 15)
    .forEach((f) => out.add(f));
  return [...out].slice(0, 15);
}

function areaOf(file) {
  const parts = file.split('/');
  if (parts.length <= 1) return '.';
  const skip = new Set(['src', 'lib', 'app', 'pkg', 'internal', 'packages', 'apps', 'source']);
  const meaningful = parts.slice(0, -1).filter((p) => !skip.has(p));
  return meaningful.slice(0, 2).join('/') || parts.slice(0, -1).join('/');
}

/**
 * Topic suggestions in the spirit of "based on your recent navigation":
 * we use uncommitted + recently committed files, commit subjects and entry points.
 */
export function suggestTopics(root, { limit = 8 } = {}) {
  const recent = recentFiles(root);
  const subjects = recentSubjects(root, 12);
  const files = trackedFiles(root);
  const entries = entryPoints(root, files);

  const areas = new Map();
  for (const { file, score } of recent) {
    if (IGNORE_RE.test(file)) continue;
    const a = areaOf(file);
    const cur = areas.get(a) || { area: a, score: 0, files: [] };
    cur.score += score;
    if (cur.files.length < 6) cur.files.push(file);
    areas.set(a, cur);
  }
  const hotAreas = [...areas.values()].sort((x, y) => y.score - x.score).slice(0, 5);

  const suggestions = [];
  for (const a of hotAreas) {
    suggestions.push({
      topic: `How does the ${a.area === '.' ? 'root module' : a.area} code you've been working on fit together?`,
      reason: `recently changed: ${a.files.slice(0, 3).join(', ')}`,
      seeds: a.files,
    });
  }
  for (const s of subjects.filter((s) => !/^merge\b/i.test(s)).slice(0, 3)) {
    suggestions.push({ topic: `Trace the code paths affected by "${s}"`, reason: 'recent commit', seeds: [] });
  }
  if (entries.length) {
    suggestions.push({
      topic: 'End-to-end flow from the main entry point to its core logic',
      reason: 'entry points detected',
      seeds: entries.slice(0, 5),
    });
  }
  return {
    suggestions: suggestions.slice(0, limit),
    recentFiles: recent.slice(0, 20),
    recentCommits: subjects,
    entryPoints: entries,
    trackedFileCount: files ? files.length : null,
  };
}
