import fs from 'node:fs';
import path from 'node:path';
import { listMaps, loadMap, narrativeDrift } from './store.js';
import { renderTextTree } from './render/markdown.js';

// Real path (resolves symlinks and Windows 8.3 short names such as C:\Users\RUNNER~1, which
// git never returns); falls back to the input when the path does not exist.
const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
};

/** Normalizes an absolute or relative path to a repo-relative, forward-slash path. */
export function relPath(root, p) {
  const abs = path.isAbsolute(p) ? p : path.resolve(root, p);
  let rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) rel = path.relative(real(root), real(abs));
  rel = rel.split(path.sep).join('/');
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel;
}

/**
 * Which maps / traces / nodes cover a file (and which node is nearest to `line`).
 * Used by the waymark_for_file tool, the CLI and the Claude Code hooks.
 */
export function mapsForFile(root, file, { line = null } = {}) {
  const rel = relPath(root, file);
  if (!rel) return { path: file, maps: [] };
  const maps = [];
  for (const m of listMaps(root)) {
    let doc;
    try {
      doc = loadMap(root, m.id);
    } catch {
      continue;
    }
    const drift = narrativeDrift(doc);
    const nodes = [];
    for (const t of doc.traces) {
      for (const l of t.locations) {
        if (l.path !== rel) continue;
        nodes.push({
          id: l.id,
          title: l.title,
          line: l.lineNumber,
          description: l.description,
          explanation: l.explanation,
          trace: t.id,
          traceTitle: t.title,
          stale: drift.nodes.includes(l.id),
        });
      }
    }
    if (!nodes.length) continue;
    let nearest = null;
    if (line != null) {
      nearest = nodes.reduce((a, b) => (Math.abs(b.line - line) < Math.abs(a.line - line) ? b : a));
    }
    maps.push({ id: doc.id, title: doc.title, traces: [...new Set(nodes.map((n) => n.trace))], nodes, nearest: nearest?.id || null, doc });
  }
  return { path: rel, maps };
}

/** Compact, factual context block for agents (hooks, waymark_for_file). Bounded size. */
export function renderFileContext(res, { maxChars = 3500, withTrees = true } = {}) {
  if (!res.maps.length) return '';
  const head = `Waymark maps covering \`${res.path}\`:`;
  const share = Math.floor((maxChars - head.length) / res.maps.length);
  const sections = res.maps.map((m) => {
    let s = renderMapSection(m, withTrees);
    if (s.length > share) s = s.slice(0, share - 60) + `\n… (truncated; waymark_get(id: "${m.id}") for more)`;
    return s;
  });
  return [head, ...sections].join('\n');
}

function renderMapSection(m, withTrees) {
  const o = [];
  {
    o.push('', `### Map \`${m.id}\` — ${m.title}`);
    for (const tid of m.traces) {
      const t = m.doc.traces.find((x) => x.id === tid);
      o.push('', `Trace ${t.id}: ${t.title} — ${t.description}`);
      if (withTrees) o.push('```text', renderTextTree(t), '```');
      for (const n of m.nodes.filter((x) => x.trace === tid)) {
        o.push(`- [${n.id}] ${n.title} (line ${n.line}) — ${n.description}${n.stale ? ' ⚠ code changed since this node was explained' : ''}`);
      }
    }
    const near = m.nearest && m.nodes.find((n) => n.id === m.nearest);
    if (near?.explanation) o.push('', `Explanation of [${near.id}] ${near.title}: ${near.explanation}`);
    o.push('', `More: waymark_get(id: "${m.id}", trace: "${m.traces[0]}") or the resource waymark://${m.id}/${m.traces[0]}.`);
  }
  return o.join('\n');
}

/** For JSON tool output: drop the heavy doc reference. */
export function forFileSummary(res) {
  return { path: res.path, maps: res.maps.map(({ doc, ...m }) => m) };
}
