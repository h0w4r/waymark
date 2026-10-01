import { renderMermaid } from './mermaid.js';
import { renderMarkdown } from './markdown.js';

const escHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// JSON safe to inline inside <script>.
const inlineJson = (v) =>
  JSON.stringify(v).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, ' ');

/** Self-contained, shareable viewer. Only the Mermaid diagram tab needs network (CDN). */
export function renderHtml(doc) {
  const data = {
    doc,
    mermaid: renderMermaid(doc, { clickable: true }),
    markdown: renderMarkdown(doc, { detail: 'compact' }),
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Waymark · ${escHtml(doc.title)}</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <div class="hgroup">
    <div class="eyebrow">WAYMARK</div>
    <h1>${escHtml(doc.title)}</h1>
    <p class="desc">${escHtml(doc.description)}</p>
    <div class="chips" id="chips"></div>
  </div>
  <div class="actions">
    <div class="seg" role="tablist">
      <button id="tab-map" class="on" role="tab">Map</button>
      <button id="tab-diagram" role="tab">Diagram</button>
    </div>
    <button id="copy-ctx" title="Copy as agent context (markdown)">Copy context</button>
    <button id="settings-btn" title="Editor link settings">⚙</button>
  </div>
</header>
<div id="settings" hidden>
  <label>Local repo path <input id="set-root" spellcheck="false"></label>
  <label>Editor
    <select id="set-editor">
      <option value="vscode">VS Code</option><option value="cursor">Cursor</option>
      <option value="windsurf">Windsurf</option><option value="idea">JetBrains</option>
    </select>
  </label>
</div>
<main id="view-map">
  <nav id="sidebar" aria-label="Traces"></nav>
  <section id="detail" aria-live="polite"></section>
</main>
<main id="view-diagram" hidden>
  <div id="diagram"><pre class="mmd-src"></pre></div>
</main>
<script id="waymark-data" type="application/json">${inlineJson(data)}</script>
<script>${JS}</script>
</body>
</html>`;
}

const CSS = `
:root{--bg:#fbfbfa;--panel:#fff;--ink:#1d1f23;--muted:#6b7078;--line:#e6e6e3;--accent:#3a5ccc;--accent-soft:#e9eefc;
--warn:#b26b00;--bad:#c23b3b;--code-bg:#f6f7f9;--hl:#fff6d6;--kw:#8a3ab9;--str:#2e7d32;--com:#8b8f97;--num:#b5520b;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#141518;--panel:#1b1d21;--ink:#e6e7ea;--muted:#959aa3;--line:#2c2f35;
--accent:#8aa4ff;--accent-soft:#232b45;--code-bg:#16181c;--hl:#3a3418;--kw:#d199ff;--str:#8fd694;--com:#6d727b;--num:#f0a868}}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);font:14px/1.5 var(--sans);display:flex;flex-direction:column}
header{display:flex;gap:24px;justify-content:space-between;align-items:flex-start;padding:18px 24px 14px;border-bottom:1px solid var(--line);background:var(--panel)}
.eyebrow{font:600 11px/1 var(--sans);letter-spacing:.12em;color:var(--accent)}
h1{font-size:20px;margin:6px 0 4px;font-weight:650}
.desc{margin:0;color:var(--muted);max-width:900px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;cursor:pointer}
.desc.open{display:block}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.chip{font:12px/1 var(--sans);padding:4px 8px;border-radius:999px;background:var(--code-bg);border:1px solid var(--line);color:var(--muted)}
.chip.bad{color:var(--bad);border-color:currentColor}.chip.warn{color:var(--warn);border-color:currentColor}
.actions{display:flex;gap:8px;align-items:center;flex-shrink:0}
button,select,input{font:inherit;color:inherit}
button{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px 10px;cursor:pointer}
button:hover{border-color:var(--accent)}
.seg{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.seg button{border:0;border-radius:0}.seg button.on{background:var(--accent-soft);color:var(--accent);font-weight:600}
#settings{display:flex;gap:16px;padding:10px 24px;border-bottom:1px solid var(--line);background:var(--panel);font-size:13px}
#settings[hidden]{display:none}
#settings input{width:420px;padding:4px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);font-family:var(--mono);font-size:12px}
#settings select{padding:4px;border:1px solid var(--line);border-radius:6px;background:var(--bg)}
main{flex:1;min-height:0;display:flex}main[hidden]{display:none}
#sidebar{width:400px;flex-shrink:0;overflow:auto;border-right:1px solid var(--line);padding:12px 10px 40px;background:var(--panel)}
.trace{margin-bottom:10px;border-radius:10px}
.trace-h{display:flex;gap:10px;align-items:flex-start;padding:8px;border-radius:8px;cursor:pointer;user-select:none}
.trace-h:hover{background:var(--code-bg)}
.tnum{flex-shrink:0;width:22px;height:22px;border-radius:6px;background:var(--accent);color:#fff;font:600 12px/22px var(--sans);text-align:center}
.trace-t{font-weight:600}.trace-d{color:var(--muted);font-size:12.5px;margin-top:2px}
.caret{margin-left:auto;color:var(--muted);transition:transform .15s}.trace.closed .caret{transform:rotate(-90deg)}
.trace.closed .tree{display:none}
.tree{list-style:none;margin:2px 0 0;padding:0 0 0 18px}
.tree .tree{padding-left:16px;border-left:1px dashed var(--line);margin-left:9px}
.node{display:flex;gap:8px;align-items:baseline;padding:4px 8px;border-radius:7px;cursor:pointer;margin:1px 0}
.node:hover{background:var(--code-bg)}
.node.sel{background:var(--accent-soft)}
.node .id{font:600 11.5px/1 var(--mono);color:var(--accent);min-width:24px}
.node .nt{flex:1;min-width:0}
.node .loc{display:block;font:11.5px/1.4 var(--mono);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.node.label{cursor:default;color:var(--muted);font-style:italic}
.st{font-size:11px;margin-left:4px}.st.fuzzy{color:var(--warn)}.st.unresolved,.st.missing{color:var(--bad)}
#detail{flex:1;overflow:auto;padding:22px 32px 60px;min-width:0}
.crumb{color:var(--muted);font-size:12.5px}
.dh{display:flex;align-items:center;gap:10px;margin:6px 0 4px}
.dh .id{font:600 13px/1 var(--mono);color:#fff;background:var(--accent);padding:5px 7px;border-radius:6px}
.dh h2{margin:0;font-size:18px}
.ddesc{max-width:900px;margin:6px 0 12px}
.where{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px;font-size:13px}
.where code{font-family:var(--mono);background:var(--code-bg);padding:3px 6px;border-radius:6px;border:1px solid var(--line)}
.where a{color:var(--accent);text-decoration:none;border:1px solid var(--line);padding:3px 8px;border-radius:6px}
.where a:hover{border-color:var(--accent)}
.note{font-size:12.5px;color:var(--warn);margin:-4px 0 10px}
pre.code{margin:0;background:var(--code-bg);border:1px solid var(--line);border-radius:10px;padding:10px 0;overflow:auto;font:12.5px/1.55 var(--mono)}
pre.code .ln{display:block;padding:0 14px 0 0;white-space:pre}
pre.code .ln.hl{background:var(--hl)}
pre.code .no{display:inline-block;width:56px;padding-right:12px;text-align:right;color:var(--muted);user-select:none}
.tk-k{color:var(--kw)}.tk-s{color:var(--str)}.tk-c{color:var(--com);font-style:italic}.tk-n{color:var(--num)}
.nav{display:flex;gap:8px;margin:14px 0 24px}
.guide{max-width:900px;border-top:1px solid var(--line);padding-top:14px}
.guide h3{font-size:14px;margin:0 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.guide code{font-family:var(--mono);background:var(--code-bg);padding:1px 5px;border-radius:5px;font-size:12.5px}
.guide pre{background:var(--code-bg);padding:10px;border-radius:8px;overflow:auto}
a.ref{font:600 12px/1 var(--mono);color:var(--accent);background:var(--accent-soft);padding:2px 5px;border-radius:5px;text-decoration:none;cursor:pointer}
.links{margin-top:16px;font-size:13px}.links li{margin:2px 0}
#view-diagram{overflow:auto;padding:20px}
#diagram{min-width:100%}#diagram svg{max-width:none}
.mmd-src{font:12px var(--mono);color:var(--muted);white-space:pre-wrap}
.empty{color:var(--muted);padding:40px}
@media (max-width:900px){header{flex-direction:column;gap:10px;padding:12px 14px}.actions{flex-wrap:wrap}
#view-map{flex-direction:column}#sidebar{width:auto;max-height:42vh;border-right:0;border-bottom:1px solid var(--line)}
#detail{padding:16px 14px 40px}#settings{flex-wrap:wrap;padding:10px 14px}#settings input{width:100%}}
`;

const JS = `
(() => {
const { doc, mermaid: mmdSrc, markdown } = JSON.parse(document.getElementById('waymark-data').textContent);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const locs = [], byId = new Map();
for (const t of doc.traces) for (const l of t.locations) { const x = { ...l, trace: t }; locs.push(x); byId.set(l.id, x); }
const meta = doc.meta || {};
const storeKey = 'waymark:' + doc.id;
const prefs = Object.assign({ root: meta.root || '', editor: 'vscode' }, JSON.parse(localStorage.getItem(storeKey) || '{}'));

// ---------- chips ----------
const a = meta.anchors || {};
const chips = [];
if (meta.commit) chips.push('<span class="chip" title="' + esc(meta.commit) + '">@ ' + esc(meta.commit.slice(0, 8)) + (meta.branch ? ' · ' + esc(meta.branch) : '') + '</span>');
if (meta.updatedAt) chips.push('<span class="chip">' + esc(meta.updatedAt.slice(0, 16).replace('T', ' ')) + '</span>');
chips.push('<span class="chip">' + doc.traces.length + ' traces · ' + locs.length + ' nodes</span>');
const broken = (a.unresolved || 0) + (a.missing || 0);
if (broken) chips.push('<span class="chip bad">' + broken + ' unverified anchors</span>');
if (a.fuzzy) chips.push('<span class="chip warn">' + a.fuzzy + ' approximate</span>');
if (doc.query) chips.push('<span class="chip" title="Prompt">“' + esc(doc.query) + '”</span>');
$('#chips').innerHTML = chips.join('');
document.querySelector('.desc').onclick = (e) => e.currentTarget.classList.toggle('open');

// ---------- links ----------
function editorUrl(l) {
  if (!prefs.root) return null;
  const abs = (prefs.root.replace(/\\\\/g, '/').replace(/\\/$/, '') + '/' + l.path);
  const p = abs.startsWith('/') ? abs : '/' + abs;
  if (prefs.editor === 'idea') return 'idea://open?file=' + encodeURIComponent(abs) + '&line=' + l.lineNumber;
  return prefs.editor + '://file' + encodeURI(p) + ':' + l.lineNumber;
}
function remoteUrl(l) {
  const r = meta.remote, c = meta.commit;
  if (!r || !c) return null;
  if (/dev\\.azure\\.com|visualstudio\\.com/.test(r)) return r + '?path=/' + l.path + '&version=GC' + c + '&line=' + l.lineNumber + '&lineEnd=' + l.lineNumber + '&lineStartColumn=1&lineEndColumn=1';
  if (/bitbucket\\./.test(r)) return r + '/src/' + c + '/' + l.path + '#lines-' + l.lineNumber;
  if (/gitlab\\./.test(r)) return r + '/-/blob/' + c + '/' + l.path + '#L' + l.lineNumber;
  return r + '/blob/' + c + '/' + l.path + '#L' + l.lineNumber;
}

// ---------- tiny highlighter ----------
const KW = new Set('abstract async await break case catch class const continue def default defer delete do elif else enum export extends false final finally fn for from func function go if impl implements import in interface is lambda let match module mut namespace new nil none not null of or package pass private protected pub public raise return self static struct super switch this throw throws trait true try type typeof use val var void when where while with yield'.split(' '));
const TOK = /(\\/\\/.*$|#.*$|\\/\\*.*?\\*\\/|--.*$)|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(\\b\\d[\\d_.xXa-fA-F]*\\b)|([A-Za-z_$][\\w$]*)/g;
function hl(line, ext) {
  const hashComments = /^(py|rb|sh|bash|yml|yaml|toml|r|pl|ps1|conf|cfg|dockerfile|mk|makefile)$/i.test(ext);
  const sqlish = /^(sql|lua|hs)$/i.test(ext);
  let out = '', last = 0, m;
  TOK.lastIndex = 0;
  while ((m = TOK.exec(line))) {
    out += esc(line.slice(last, m.index));
    const [t] = m;
    if (m[1] && ((t[0] === '#' && !hashComments) || (t.startsWith('--') && !sqlish))) { out += esc(t[0]); TOK.lastIndex = m.index + 1; last = m.index + 1; continue; }
    out += m[1] ? '<span class="tk-c">' + esc(t) + '</span>' : m[2] ? '<span class="tk-s">' + esc(t) + '</span>'
      : m[3] ? '<span class="tk-n">' + esc(t) + '</span>' : KW.has(t) ? '<span class="tk-k">' + esc(t) + '</span>' : esc(t);
    last = m.index + t.length;
  }
  return out + esc(line.slice(last));
}

// ---------- mini markdown (guides) ----------
function inline(s) {
  return esc(s)
    .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
    .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\\*([^*]+)\\*/g, '$1<em>$2</em>')
    .replace(/\\[(\\d+[a-z]{1,2})\\]/g, (m, id) => byId.has(id) ? '<a class="ref" data-ref="' + id + '">' + id + '</a>' : m);
}
function md(src) {
  const out = []; let list = null, para = [], code = null;
  const flush = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } if (list) { out.push('</' + list + '>'); list = null; } };
  for (const raw of String(src || '').split(/\\r?\\n/)) {
    if (code !== null) { if (/^\`\`\`/.test(raw)) { out.push('<pre><code>' + esc(code.join('\\n')) + '</code></pre>'); code = null; } else code.push(raw); continue; }
    if (/^\`\`\`/.test(raw)) { flush(); code = []; continue; }
    const h = raw.match(/^(#{1,4})\\s+(.*)/); if (h) { flush(); out.push('<h4>' + inline(h[2]) + '</h4>'); continue; }
    const li = raw.match(/^\\s*([-*]|\\d+\\.)\\s+(.*)/);
    if (li) { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } const kind = /\\d/.test(li[1]) ? 'ol' : 'ul'; if (list !== kind) { if (list) out.push('</' + list + '>'); out.push('<' + kind + '>'); list = kind; } out.push('<li>' + inline(li[2]) + '</li>'); continue; }
    if (!raw.trim()) { flush(); continue; }
    if (list) { out.push('</' + list + '>'); list = null; }
    para.push(raw.trim());
  }
  if (code !== null) out.push('<pre><code>' + esc(code.join('\\n')) + '</code></pre>');
  flush();
  return out.join('');
}

// ---------- sidebar ----------
const STATUS = { fuzzy: '≈', unresolved: '⚠', missing: '⚠' };
function treeHtml(nodes, trace) {
  if (!nodes || !nodes.length) return '';
  return '<ul class="tree">' + nodes.map((n) => {
    const l = n.ref && byId.get(n.ref);
    const inner = l
      ? '<div class="node" data-id="' + l.id + '"><span class="id">' + l.id + '</span><span class="nt">' + esc(n.label || l.title)
        + (STATUS[l.status] ? '<span class="st ' + l.status + '" title="' + esc(l.note || l.status) + '">' + STATUS[l.status] + '</span>' : '')
        + '<span class="loc">' + esc(l.path) + ':' + l.lineNumber + '</span></span></div>'
      : '<div class="node label">' + esc(n.label || '…') + '</div>';
    return '<li>' + inner + treeHtml(n.children, trace) + '</li>';
  }).join('') + '</ul>';
}
$('#sidebar').innerHTML = doc.traces.map((t) =>
  '<div class="trace" data-trace="' + esc(t.id) + '"><div class="trace-h"><span class="tnum">' + esc(t.id) + '</span><div><div class="trace-t">'
  + esc(t.title) + '</div><div class="trace-d">' + esc(t.description) + '</div></div><span class="caret">▾</span></div>'
  + treeHtml(t.tree, t) + '</div>').join('');
$('#sidebar').addEventListener('click', (e) => {
  const node = e.target.closest('.node[data-id]');
  if (node) return select(node.dataset.id);
  const th = e.target.closest('.trace-h');
  if (th) th.parentElement.classList.toggle('closed');
});

// ---------- detail ----------
let current = null;
function select(id, { push = true } = {}) {
  const l = byId.get(id); if (!l) return;
  current = id;
  document.querySelectorAll('.node.sel').forEach((n) => n.classList.remove('sel'));
  const node = document.querySelector('.node[data-id="' + id + '"]');
  if (node) { node.classList.add('sel'); node.closest('.trace').classList.remove('closed'); node.scrollIntoView({ block: 'nearest' }); }
  const ext = (l.path.split('.').pop() || '').toLowerCase();
  const code = l.snippet && l.snippet.code != null
    ? '<pre class="code">' + l.snippet.code.split('\\n').map((ln, i) => {
        const no = l.snippet.startLine + i;
        return '<span class="ln' + (no === l.lineNumber ? ' hl' : '') + '"><span class="no">' + no + '</span>' + hl(ln, ext) + '</span>';
      }).join('') + '</pre>'
    : '<pre class="code"><span class="ln hl"><span class="no">' + l.lineNumber + '</span>' + esc(l.lineContent) + '</span></pre>';
  const ed = editorUrl(l), rm = remoteUrl(l);
  const idx = locs.findIndex((x) => x.id === id);
  const links = (doc.links || []).filter((k) => k.from === id || k.to === id);
  $('#detail').innerHTML =
    '<div class="crumb">Trace ' + esc(l.trace.id) + ' · ' + esc(l.trace.title) + '</div>'
    + '<div class="dh"><span class="id">' + l.id + '</span><h2>' + esc(l.title) + '</h2></div>'
    + '<p class="ddesc">' + inline(l.description) + '</p>'
    + '<div class="where"><code>' + esc(l.path) + ':' + l.lineNumber + '</code>' + (l.symbol ? '<code>' + esc(l.symbol) + '</code>' : '')
    + (ed ? '<a href="' + esc(ed) + '">Open in editor</a>' : '') + (rm ? '<a href="' + esc(rm) + '" target="_blank" rel="noopener">View on remote</a>' : '')
    + '</div>' + (l.note ? '<div class="note">' + esc(l.note) + '</div>' : '') + code
    + (links.length ? '<ul class="links">' + links.map((k) => '<li>' + (k.from === id ? '→ ' : '← ') + '<a class="ref" data-ref="' + (k.from === id ? k.to : k.from) + '">' + (k.from === id ? k.to : k.from) + '</a> ' + esc(k.label || '') + '</li>').join('') + '</ul>' : '')
    + '<div class="nav"><button data-go="' + (idx - 1) + '"' + (idx <= 0 ? ' disabled' : '') + '>← Prev</button><button data-go="' + (idx + 1) + '"' + (idx >= locs.length - 1 ? ' disabled' : '') + '>Next →</button></div>'
    + (l.trace.guide ? '<div class="guide"><h3>Trace ' + esc(l.trace.id) + ' guide</h3>' + md(l.trace.guide) + '</div>' : '');
  if (push) history.replaceState(null, '', '#' + id);
}
$('#detail').addEventListener('click', (e) => {
  const r = e.target.closest('[data-ref]'); if (r) return select(r.dataset.ref);
  const g = e.target.closest('[data-go]'); if (g && locs[+g.dataset.go]) select(locs[+g.dataset.go].id);
});
document.addEventListener('keydown', (e) => {
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const i = locs.findIndex((x) => x.id === current);
  if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); if (locs[i + 1]) select(locs[i + 1].id); }
  if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); if (i > 0) select(locs[i - 1].id); }
});
window.waymarkSelect = (id) => { showTab('map'); select(id); };

// ---------- tabs / diagram ----------
let mermaidDone = false;
async function drawDiagram() {
  if (mermaidDone) return; mermaidDone = true;
  const box = $('#diagram');
  box.querySelector('.mmd-src').textContent = mmdSrc;
  try {
    const { default: mermaid } = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: dark ? 'dark' : 'neutral', flowchart: { htmlLabels: true, curve: 'basis' } });
    const { svg, bindFunctions } = await mermaid.render('cm-diagram', mmdSrc);
    box.innerHTML = svg; if (bindFunctions) bindFunctions(box);
  } catch (err) {
    box.insertAdjacentHTML('afterbegin', '<p class="empty">Diagram renderer unavailable (offline?). Mermaid source:</p>');
  }
}
function showTab(t) {
  $('#tab-map').classList.toggle('on', t === 'map'); $('#tab-diagram').classList.toggle('on', t === 'diagram');
  $('#view-map').hidden = t !== 'map'; $('#view-diagram').hidden = t !== 'diagram';
  if (t === 'diagram') drawDiagram();
}
$('#tab-map').onclick = () => showTab('map');
$('#tab-diagram').onclick = () => showTab('diagram');

// ---------- settings / copy ----------
$('#settings-btn').onclick = () => { $('#settings').hidden = !$('#settings').hidden; };
$('#set-root').value = prefs.root; $('#set-editor').value = prefs.editor;
const savePrefs = () => { prefs.root = $('#set-root').value.trim(); prefs.editor = $('#set-editor').value; localStorage.setItem(storeKey, JSON.stringify(prefs)); if (current) select(current, { push: false }); };
$('#set-root').onchange = savePrefs; $('#set-editor').onchange = savePrefs;
$('#copy-ctx').onclick = async () => {
  try { await navigator.clipboard.writeText(markdown); $('#copy-ctx').textContent = 'Copied ✓'; }
  catch { $('#copy-ctx').textContent = 'Copy failed'; }
  setTimeout(() => ($('#copy-ctx').textContent = 'Copy context'), 1500);
};

const initial = decodeURIComponent(location.hash.slice(1));
select(byId.has(initial) ? initial : locs[0].id, { push: false });
})();
`;
