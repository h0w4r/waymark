'use strict';
// Pure logic of the Waymark VS Code extension (no `vscode` import): testable with node.

const fs = require('fs');
const path = require('path');

const PALETTE = ['#5b8cff', '#e8803a', '#3fae6a', '#c04fd0', '#d4a72c', '#2fb3c4', '#e0566b', '#8a7dff', '#7fb800', '#ff6fa8'];

/** Loads every map in <root>/.waymark and indexes its nodes by file. */
function loadWorkspace(root) {
  const dir = path.join(root, '.waymark');
  const maps = [];
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return { root, maps, byFile: new Map() };
  }
  for (const f of names) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!doc || !Array.isArray(doc.traces)) continue;
      maps.push(normalize(doc));
    } catch {
      /* skip unreadable map */
    }
  }
  maps.sort((a, b) => String(b.meta?.updatedAt || '').localeCompare(String(a.meta?.updatedAt || '')));
  const byFile = new Map();
  for (const m of maps) {
    for (const n of m.nodes) {
      if (!byFile.has(n.path)) byFile.set(n.path, []);
      byFile.get(n.path).push(n);
    }
  }
  return { root, maps, byFile };
}

function normalize(doc) {
  const drift = new Set(doc.meta?.narrativeDrift?.nodes || []);
  const nodes = [];
  doc.traces.forEach((t, ti) => {
    t.color = PALETTE[ti % PALETTE.length];
    for (const l of t.locations) {
      const stale = drift.has(l.id) || (!!l.narrativeHash && !!l.ctxHash && l.narrativeHash !== l.ctxHash);
      nodes.push({
        mapId: doc.id,
        mapTitle: doc.title,
        id: l.id,
        title: l.title,
        description: l.description,
        explanation: l.explanation || '',
        path: l.path,
        line: l.lineNumber,
        status: l.status || 'ok',
        traceId: t.id,
        traceTitle: t.title,
        color: t.color,
        stale,
      });
    }
  });
  return { ...doc, nodes };
}

/** Index of the node anchored exactly at (path, line) in a given map, else -1. */
function nodeAt(map, relPath, line) {
  return map.nodes.findIndex((n) => n.path === relPath && n.line === line);
}

/** Next/previous node in reading order, starting from the node at the cursor or `fromIndex`. */
function step(map, fromIndex, dir) {
  if (!map.nodes.length) return -1;
  if (fromIndex < 0) return dir > 0 ? 0 : map.nodes.length - 1;
  const i = fromIndex + dir;
  return i < 0 || i >= map.nodes.length ? -1 : i;
}

/** Gutter icon: the node id in its trace colour, as an SVG data URI. */
function gutterSvg(id, color) {
  const w = id.length > 2 ? 22 : 18;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="16" viewBox="0 0 ${w} 16">` +
    `<rect x="0.5" y="1.5" width="${w - 1}" height="13" rx="3" fill="${color}" fill-opacity="0.18" stroke="${color}"/>` +
    `<text x="${w / 2}" y="11.5" text-anchor="middle" font-family="Consolas, monospace" font-size="9" font-weight="700" fill="${color}">${id}</text></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

/** Hover / tooltip markdown for a node (plain markdown; command links added by the caller). */
function nodeMarkdown(n) {
  const o = [`**${n.id} · ${n.title}** — _${n.mapTitle} › ${n.traceId}. ${n.traceTitle}_`, '', n.description];
  if (n.stale) o.push('', '⚠ The code here changed after this node was explained — the prose may be outdated.');
  if (n.explanation) o.push('', n.explanation);
  return o.join('\n');
}

/**
 * Navigation history (feeds `waymark suggest`): <root>/.waymark/.local/history.json,
 * a self-ignored folder so it never shows up in git.
 */
function recordVisit(root, relPath, now = Date.now()) {
  const dir = path.join(root, '.waymark', '.local');
  if (!fs.existsSync(path.join(root, '.waymark'))) return null;
  fs.mkdirSync(dir, { recursive: true });
  const ign = path.join(dir, '.gitignore');
  if (!fs.existsSync(ign)) fs.writeFileSync(ign, '*\n');
  const file = path.join(dir, 'history.json');
  let h = { files: {} };
  try {
    h = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* new history */
  }
  const e = h.files[relPath] || { visits: 0, last: 0 };
  e.visits += 1;
  e.last = now;
  h.files[relPath] = e;
  const entries = Object.entries(h.files).sort((a, b) => b[1].last - a[1].last).slice(0, 300);
  h.files = Object.fromEntries(entries);
  fs.writeFileSync(file, JSON.stringify(h));
  return e;
}

/** Semver-ish comparison: is `a` (e.g. "0.3.0" or "v0.3.0") newer than `b`? Pre-release tags ignored. */
function isNewer(a, b) {
  const parse = (v) => String(v || '').replace(/^v/, '').split('-')[0].split('.').map((x) => parseInt(x, 10) || 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

/** From a GitHub "latest release" payload: { version, url (vsix), notes } or null. */
function releaseInfo(rel) {
  if (!rel || !rel.tag_name || !Array.isArray(rel.assets)) return null;
  const asset = rel.assets.find((a) => /\.vsix$/i.test(a.name));
  if (!asset) return null;
  return { version: rel.tag_name.replace(/^v/, ''), url: asset.browser_download_url, name: asset.name, notes: rel.html_url };
}

module.exports = { PALETTE, loadWorkspace, normalize, nodeAt, step, gutterSvg, nodeMarkdown, recordVisit, isNewer, releaseInfo };
