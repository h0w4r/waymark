import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMermaid } from './mermaid.js';
import { renderMarkdown } from './markdown.js';

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
export function renderHtml(doc, { files = {} } = {}) {
  const data = {
    doc,
    files,
    markdown: renderMarkdown(doc, { detail: 'full' }),
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
    <div class="seg" role="tablist" aria-label="View">
      <button id="vCode" role="tab" title="Code view (d)">Code</button>
      <button id="vDiagram" role="tab" title="Diagram view (d)">Diagram</button>
    </div>
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
          </div>
        </div>
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
