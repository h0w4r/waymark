import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMermaid } from './mermaid.js';
import { renderMarkdown } from './markdown.js';
import { checkState, execState } from '../state.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(HERE, 'viewer.css'), 'utf8');
const CLIENT = fs.readFileSync(path.join(HERE, 'viewer.client.js'), 'utf8');
const BS = String.fromCharCode(92);

const escHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// JSON inside <script type="application/json">: only "<" must be neutralized (no "</script>").
const inlineJson = (v) => JSON.stringify(v).split('<').join(BS + 'u003c');
const inlineScript = (s) => s.replace(/<\/script/gi, '<' + BS + '/script');

/**
 * Self-contained, shareable viewer (no network): map pane with story, guides and
 * explanations; code view with embedded files; interactive SVG diagram.
 * `files` is a snapshot { path: content } of the referenced files.
 */
export function renderHtml(doc, { files = {}, maps = [] } = {}) {
  const data = {
    doc,
    files,
    maps,
    // Precomputed per-node state (fact-check verdict validity needs hashes the browser can't do sync).
    states: Object.fromEntries(
      doc.traces.flatMap((t) => t.locations.map((l) => [l.id, { check: checkState(l), exec: execState(l) }])),
    ),
    markdown: renderMarkdown(doc, { detail: 'full' }),
    // Smaller context blocks for "copy trace / node as context".
    traceMd: Object.fromEntries(doc.traces.map((t) => [t.id, renderMarkdown(doc, { trace: t.id })])),
    nodeMd: Object.fromEntries(doc.traces.flatMap((t) => t.locations.map((l) => [l.id, renderMarkdown(doc, { node: l.id })]))),
    mermaid: renderMermaid({ ...doc, diagram: undefined }),
  };
  return `<!doctype html>
<html lang="${escHtml(doc.language || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="waymark">
<title>Waymark · ${escHtml(doc.title)}</title>
<style>${CSS}</style>
</head>
<body>
<div id="app">
  <header id="topbar">
    <span class="brand">WAYMARK</span><span class="brand-sep"></span>
    <span class="top-title"></span>
    <div class="search">
      <input id="search" type="search" placeholder="Search nodes…  ( / )" autocomplete="off" spellcheck="false" aria-label="Search nodes">
      <div id="searchResults" hidden></div>
    </div>
    <div class="seg" role="tablist" aria-label="View">
      <button id="vCode" role="tab" title="Code view (d)">Code</button>
      <button id="vDiagram" role="tab" title="Diagram view (d)">Diagram</button>
    </div>
    <a class="tbtn" id="allMaps" href="index.html" title="All maps in this repository">All maps</a>
    <button class="tbtn" id="copyCtx" title="Copy the map as markdown context for an agent">Copy context</button>
    <button class="tbtn" id="settingsBtn" title="Editor link settings">⚙</button>
  </header>
  <div id="settings" hidden>
    <label>Local repo path <input id="setRoot" spellcheck="false"></label>
    <label>Editor
      <select id="setEditor">
        <option value="vscode">VS Code</option><option value="cursor">Cursor</option>
        <option value="windsurf">Windsurf / Devin Desktop</option><option value="idea">JetBrains</option>
      </select>
    </label>
  </div>
  <div id="main">
    <aside id="mapPane" aria-label="Map"></aside>
    <div id="splitter" role="separator" aria-orientation="vertical" title="Drag to resize"></div>
    <section id="rightPane">
      <div id="codeView">
        <div id="fileTabs"></div>
        <div id="codeScroll"><div id="code"></div></div>
      </div>
      <div id="diagramView" hidden>
        <div class="dg-toolbar">
          <div class="legend" id="legend"></div>
          <div class="zoom">
            <button id="zin" title="Zoom in">+</button>
            <button id="zout" title="Zoom out">−</button>
            <button id="zfit" title="Fit all (f)">⤢</button>
            <button id="zsel" title="Center selected node">◎</button>
            <button id="copyMmd" title="Copy the diagram as Mermaid source">⧉</button>
            <button id="exportSvg" title="Download the diagram as SVG">⤓</button>
          </div>
        </div>
        <svg id="mini" xmlns="http://www.w3.org/2000/svg" aria-label="Minimap"><g id="miniContent"></g><rect id="miniView"/></svg>
        <svg id="dg" xmlns="http://www.w3.org/2000/svg" aria-label="Interactive diagram">
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor" style="color:var(--muted)"/></marker>
            <marker id="arr2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor" style="color:var(--ink2)"/></marker>
          </defs>
          <g id="vp"></g>
        </svg>
        <div id="dgTip" hidden></div>
        <div id="dgCard" hidden></div>
        <div class="dg-hint">Drag to pan · wheel to zoom · click a node to focus its path · double-click to open the code</div>
      </div>
    </section>
  </div>
</div>
<script id="waymark-data" type="application/json">${inlineJson(data)}</script>
<script>${inlineScript(CLIENT)}</script>
</body>
</html>`;
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');

/** .waymark/index.html: overview maps first, then flows; health badges per map; text filter. */
export function renderIndex(maps, { root = '' } = {}) {
  const sorted = [...maps].sort((a, b) => (a.kind === 'overview' ? 0 : 1) - (b.kind === 'overview' ? 0 : 1) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const cards = sorted
    .map((m) => {
      const c = m.check || {};
      const badges = [
        m.kind === 'overview' ? '<span class="b ov">overview</span>' : '',
        `<span class="b">${m.traces} traces · ${m.locations} nodes</span>`,
        c.total && c.total - c.unchecked - c.stale ? `<span class="b ${c.unsupported ? 'bad' : 'ok'}" title="fact-checked nodes">✓ ${pct(c.supported, c.total)} verified${c.unsupported ? ` · ${c.unsupported} unsupported` : ''}</span>` : '',
        m.exec ? `<span class="b ok" title="nodes executed by the tests">▶ ${m.exec.hit}/${m.exec.hit + m.exec.miss} executed</span>` : '',
        m.drift ? `<span class="b warn">◔ ${m.drift} to review</span>` : '',
      ].join('');
      const text = escHtml([m.title, m.description, m.id, m.query].join(' ').toLowerCase());
      return `<a class="card" href="${escHtml(m.id)}.html" data-text="${text}"><h2>${escHtml(m.title)}</h2><p>${escHtml(m.description || '')}</p><div class="bs">${badges}</div><div class="id">${escHtml(m.id)} · ${escHtml(String(m.updatedAt || '').slice(0, 10))}</div></a>`;
    })
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Waymark · maps</title>
<style>
:root{--bg:#1b1c1f;--panel:#232428;--ink:#e4e5e8;--muted:#8f949c;--line:#36383e;--accent:#5b8cff;--ok:#3fae6a;--warn:#e0a43a;--bad:#e5646b;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#f6f6f4;--panel:#fff;--ink:#1d1f23;--muted:#6b7078;--line:#e3e3df;--accent:#3a5ccc;color-scheme:light}}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
header{display:flex;gap:16px;align-items:center;padding:18px 28px;border-bottom:1px solid var(--line);background:var(--panel)}
.brand{font:700 12px/1 sans-serif;letter-spacing:.14em;color:var(--accent)}
h1{font-size:18px;margin:0;flex:1}
input{background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 10px;width:260px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;padding:22px 28px}
.card{display:block;text-decoration:none;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.card:hover{border-color:var(--accent)}
.card h2{font-size:15px;margin:0 0 6px}.card p{margin:0 0 10px;color:var(--muted);font-size:13px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.bs{display:flex;flex-wrap:wrap;gap:6px}.b{font-size:11.5px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--muted)}
.b.ov{color:var(--accent);border-color:var(--accent)}.b.ok{color:var(--ok);border-color:var(--ok)}.b.warn{color:var(--warn);border-color:var(--warn)}.b.bad{color:var(--bad);border-color:var(--bad)}
.id{margin-top:10px;font:11px ui-monospace,Consolas,monospace;color:var(--muted)}
</style></head><body>
<header><span class="brand">WAYMARK</span><h1>Maps${root ? ' · ' + escHtml(String(root).split(/[\\/]/).pop()) : ''}</h1><input id="q" type="search" placeholder="Filter maps…"></header>
<main id="list">${cards}</main>
<script>document.getElementById('q').addEventListener('input',function(e){var q=e.target.value.toLowerCase();document.querySelectorAll('.card').forEach(function(c){c.style.display=c.dataset.text.indexOf(q)>-1?'':'none';});});</script>
</body></html>`;
}
