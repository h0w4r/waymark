import { execFileSync } from 'node:child_process';
import { listMaps, loadMap } from './store.js';
import { FileCache, contextRange } from './anchor.js';
import { verifyMap } from './verify.js';

/*
 * Impact of a change set on the maps: which nodes' code blocks were touched, which anchors
 * broke and which prose went out of date. Used by `waymark diff`, waymark_diff and the PR action.
 */

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Changed line numbers (in the *new* version of each file) between `base` and the working tree
 * (base "HEAD" = uncommitted changes) or `base...HEAD` (merge-base) when `range` is true.
 */
export function changedLines(root, base = 'HEAD', { range = false } = {}) {
  const args = ['diff', '--unified=0', '--no-color', '--no-ext-diff', '-M'];
  args.push(range ? `${base}...HEAD` : base);
  const out = git(root, args);
  const files = new Map();
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      cur = p === '/dev/null' ? null : p.replace(/^b\//, '');
      if (cur && !files.has(cur)) files.set(cur, new Set());
      continue;
    }
    const m = cur && line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (m) {
      const start = Number(m[1]);
      const count = m[2] == null ? 1 : Number(m[2]);
      const set = files.get(cur);
      if (count === 0) {
        // Pure deletion: mark the lines around the cut.
        set.add(Math.max(1, start));
        set.add(start + 1);
      } else for (let i = 0; i < count; i++) set.add(start + i);
    }
  }
  return files;
}

/** Report of the maps affected by a change set. */
export function diffMaps(root, base = 'HEAD', { range = false } = {}) {
  const changes = changedLines(root, base, { range });
  const cache = new FileCache(root);
  const maps = [];
  for (const m of listMaps(root)) {
    const doc = loadMap(root, m.id);
    const touched = [];
    for (const t of doc.traces) {
      for (const l of t.locations) {
        const changed = changes.get(l.path);
        if (!changed) continue;
        const f = cache.read(l.path);
        if (!f) continue;
        const r = contextRange(f.lines, Math.min(l.lineNumber - 1, f.lines.length - 1)) || [l.lineNumber, l.lineNumber];
        const hits = [...changed].filter((n) => n >= r[0] && n <= r[1]);
        if (hits.length) touched.push({ id: l.id, title: l.title, trace: t.id, path: l.path, from: r[0], to: r[1], lines: hits.length });
      }
    }
    const v = verifyMap(root, doc.id);
    const broken = v.changes.filter((c) => c.status === 'unresolved' || c.status === 'missing');
    if (!touched.length && !broken.length && !v.narrative.stale) continue;
    maps.push({ id: doc.id, title: doc.title, touched, broken, drift: v.narrative });
  }
  return { base, range, files: [...changes.keys()], maps };
}

/** Markdown for PR comments / terminals. */
export function renderDiff(rep) {
  if (!rep.maps.length) return `### Waymark\n\nNo documented flow is affected by these changes (${rep.files.length} file(s) changed).`;
  const o = ['### Waymark — documented flows affected by this change', ''];
  for (const m of rep.maps) {
    o.push(`**${m.title}** (\`${m.id}\`)`);
    if (m.touched.length) {
      o.push('', '| Node | Location | Changed lines |', '|---|---|---|');
      for (const t of m.touched) o.push(`| \`${t.id}\` ${t.title} | \`${t.path}:${t.from}-${t.to}\` | ${t.lines} |`);
    }
    if (m.broken.length) o.push('', `⚠ Anchors no longer found: ${m.broken.map((b) => `\`${b.id}\` (${b.from})`).join(', ')}`);
    const d = m.drift;
    if (d.stale) {
      const parts = [];
      if (d.nodes.length) parts.push(`nodes ${d.nodes.map((n) => `\`${n}\``).join(', ')}`);
      if (d.traces.length) parts.push(`trace guides ${d.traces.join(', ')}`);
      if (d.story) parts.push('the story');
      o.push('', `◔ Prose to review (code changed since it was written): ${parts.join('; ')}.`);
    }
    o.push('', `→ \`/waymark refresh ${m.id}\` updates the map.`, '');
  }
  return o.join('\n');
}
