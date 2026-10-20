/* Waymark viewer — runs inside the self-contained HTML. No dependencies, no network. */
(() => {
  'use strict';

  const DATA = JSON.parse(document.getElementById('waymark-data').textContent);
  const { doc } = DATA;
  const FILES = DATA.files || {};
  const meta = doc.meta || {};
  const PALETTE = ['#5b8cff', '#e8803a', '#3fae6a', '#c04fd0', '#d4a72c', '#2fb3c4', '#e0566b', '#8a7dff', '#7fb800', '#ff6fa8'];
  const SVGNS = 'http://www.w3.org/2000/svg';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const base = (p) => p.split('/').pop();
  const extOf = (p) => (base(p).includes('.') ? base(p).split('.').pop().toLowerCase() : base(p).toLowerCase());
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------------------------------------------------------------- model
  const traces = doc.traces.map((t, i) => ({ ...t, color: PALETTE[i % PALETTE.length], details: t.details || t.guide }));
  const locs = [];
  const byId = new Map();
  for (const t of traces) for (const l of t.locations) {
    const x = { ...l, trace: t };
    locs.push(x);
    byId.set(l.id, x);
  }
  const fileOrder = [...new Set(locs.map((l) => l.path))];

  // Narrative drift: prose written for code that changed afterwards (set by `waymark verify --fix`).
  const drift = meta.narrativeDrift || { nodes: [], traces: [], story: false };
  const staleNodes = new Set(drift.nodes || []);
  for (const l of locs) if (l.narrativeHash && l.ctxHash && l.narrativeHash !== l.ctxHash) staleNodes.add(l.id);
  const staleTraces = new Set(drift.traces || []);
  const DRIFT_NOTE = 'The code here changed after this was written — the prose may be outdated. Ask your agent: ';
  const driftNote = (what) => '<div class="drift-note">⚠ ' + esc(DRIFT_NOTE) + '<code>/waymark refresh ' + esc(doc.id) + '</code>' + (what ? ' (' + esc(what) + ')' : '') + '</div>';

  // Embedded in a VS Code webview: talk to the extension instead of opening URLs.
  const host = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

  // Fact-check verdicts, execution results, links between maps, human notes.
  const STATES = DATA.states || {};
  const MAPS = new Map((DATA.maps || []).map((m) => [m.id, m]));
  const CHECK_BADGE = {
    supported: ['ck ok', '✓', 'Fact-checked: every claim is backed by the code'],
    partial: ['ck warn', '◑', 'Partially verified'],
    unsupported: ['ck bad', '✗', 'Fact-check failed'],
  };
  function badges(l) {
    const st = STATES[l.id] || {};
    let h = '';
    const c = CHECK_BADGE[st.check];
    if (c) h += '<span class="st ' + c[0] + '" title="' + esc(c[2] + ((l.check && l.check.issues && l.check.issues.length) ? ': ' + l.check.issues.join('; ') : '')) + '">' + c[1] + '</span>';
    if (st.exec === 'hit') h += '<span class="st ex" title="Executed by the tests (' + l.exec.count + '×)">▶</span>';
    else if (st.exec === 'miss') h += '<span class="st nx" title="Not executed by the tests">○</span>';
    if (l.mapRef) h += '<span class="st mr" title="Detailed map: ' + esc(mapTitle(l.mapRef)) + '">↗</span>';
    if (l.notes && l.notes.length) h += '<span class="st nt" title="' + l.notes.length + ' team note(s)">✎</span>';
    return h;
  }
  function mapTitle(ref) {
    const m = MAPS.get(String(ref).split('#')[0]);
    return m ? m.title : ref;
  }
  function mapHref(ref) {
    const [id, node] = String(ref).split('#');
    return id + '.html' + (node ? '#' + node : '');
  }
  function extrasHtml(l) {
    const st = STATES[l.id] || {};
    let h = '';
    if (l.check && (st.check === 'partial' || st.check === 'unsupported') && l.check.issues && l.check.issues.length) {
      h += '<div class="ck-issues ' + (st.check === 'unsupported' ? 'bad' : 'warn') + '"><b>' + (st.check === 'unsupported' ? '✗ Fact-check failed' : '◑ Partially verified') + '</b><ul>' + l.check.issues.map((i) => '<li>' + inline(i) + '</li>').join('') + '</ul></div>';
    } else if (st.check === 'supported') {
      h += '<div class="ck-issues ok"><b>✓ Fact-checked</b> — every claim was verified against the code' + (l.check.issues && l.check.issues.length ? ' (' + l.check.issues.map(esc).join('; ') + ')' : '') + '</div>';
    }
    if (st.exec === 'hit') h += '<div class="ex-line">▶ Executed by the tests (' + l.exec.count + '×, ' + esc(l.exec.source) + ')</div>';
    else if (st.exec === 'miss') h += '<div class="ex-line nx">○ Not executed by the tests</div>';
    if (l.mapRef) {
      h += host
        ? '<button class="pill maplink" data-open-map="' + esc(l.mapRef) + '">↗ ' + esc(mapTitle(l.mapRef)) + '</button>'
        : '<a class="pill maplink" href="' + esc(mapHref(l.mapRef)) + '">↗ ' + esc(mapTitle(l.mapRef)) + '</a>';
    }
    h += '<div class="notes">' + (l.notes || []).map((n) => '<div class="note-item">✎ ' + inline(n.text) + ' <span class="na">— ' + esc(n.author) + ', ' + esc(String(n.at).slice(0, 10)) + '</span></div>').join('') +
      '<button class="explain" data-add-note="' + l.id + '" title="Add a team note (not AI-generated)">+ Note</button></div>';
    return h;
  }
  function addNote(id) {
    if (host) return host.postMessage({ type: 'addNote', id });
    const text = window.prompt('Team note for [' + id + '] (saved with the CLI):');
    if (!text) return;
    const cmd = 'waymark note ' + doc.id + ' ' + id + ' ' + JSON.stringify(text);
    try { navigator.clipboard.writeText(cmd); } catch (e) { /* no clipboard */ }
    window.alert('Run this in the repository (copied to the clipboard):\n\n' + cmd);
  }

  const prefsKey = 'waymark:' + doc.id;
  const prefs = Object.assign({ root: meta.root || '', editor: 'vscode', mapW: null, view: 'code' }, safeJson(localStorage.getItem(prefsKey)));
  function safeJson(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }
  const savePrefs = () => { try { localStorage.setItem(prefsKey, JSON.stringify(prefs)); } catch { /* private mode */ } };

  const state = { sel: null, view: prefs.view === 'diagram' ? 'diagram' : 'code', file: null, explainOpen: new Set(), annoExpl: false };

  // ---------------------------------------------------------------- text helpers
  const REF_RE = /\[((?:\d+[a-z]{1,2})(?:\s*,\s*\d+[a-z]{1,2})*)\]/g;
  function refs(html) {
    return html.replace(REF_RE, (m, list) => {
      const ids = list.split(/\s*,\s*/);
      if (!ids.every((id) => byId.has(id))) return m;
      return '<span class="refs">[' + ids.map((id) => '<a class="ref" data-ref="' + id + '">' + id + '</a>').join(', ') + ']</span>';
    });
  }
  function inline(s) {
    return refs(
      esc(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>'),
    );
  }
  function md(src) {
    const out = [];
    let list = null;
    let para = [];
    let code = null;
    const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
    const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
    for (const raw of String(src || '').split(/\r?\n/)) {
      if (code !== null) {
        if (/^\s*```/.test(raw)) { out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); code = null; } else code.push(raw);
        continue;
      }
      if (/^\s*```/.test(raw)) { flushPara(); closeList(); code = []; continue; }
      const h = raw.match(/^#{1,6}\s+(.*)/);
      if (h) { flushPara(); closeList(); out.push('<h5>' + inline(h[1]) + '</h5>'); continue; }
      const li = raw.match(/^\s*([-*]|\d+\.)\s+(.*)/);
      if (li) {
        flushPara();
        const kind = /\d/.test(li[1]) ? 'ol' : 'ul';
        if (list !== kind) { closeList(); out.push('<' + kind + '>'); list = kind; }
        out.push('<li>' + inline(li[2]) + '</li>');
        continue;
      }
      if (!raw.trim()) { flushPara(); closeList(); continue; }
      closeList();
      para.push(raw.trim());
    }
    if (code !== null) out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
    flushPara();
    closeList();
    return out.join('');
  }

  // ---------------------------------------------------------------- syntax highlight (tiny, language-agnostic)
  const KW = new Set(('abstract and as async await break case catch class const continue def default defer del delete do elif else enum except export extends ' +
    'false final finally fn for from func function global go if impl implements import in interface is lambda let match mod module mut namespace new nil ' +
    'none None not null of or package pass private protected pub public raise return self static struct super switch this throw throws trait true True ' +
    'False try type typeof use val var void when where while with yield dcl-s dcl-ds dcl-proc dcl-pi end-proc end-ds exec sql select update insert into values set').split(' '));
  const TOK = /(\/\/.*$|#.*$|\/\*.*?\*\/|--.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_.xXa-fA-F]*\b)|([A-Za-z_$][\w$-]*)(\s*\()?/g;
  const HASH = /^(py|rb|sh|bash|zsh|yml|yaml|toml|r|pl|ps1|conf|cfg|ini|dockerfile|makefile|mk|cmake|nim|ex|exs)$/;
  const DASH = /^(sql|lua|hs|elm|ada)$/;
  function hl(line, ext) {
    let out = '';
    let last = 0;
    let m;
    TOK.lastIndex = 0;
    while ((m = TOK.exec(line))) {
      const t = m[0];
      out += esc(line.slice(last, m.index));
      if (m[1] && ((t[0] === '#' && !HASH.test(ext)) || (t.startsWith('--') && !DASH.test(ext)))) {
        out += esc(t[0]);
        TOK.lastIndex = m.index + 1;
        last = m.index + 1;
        continue;
      }
      if (m[1]) out += '<span class="tk-c">' + esc(t) + '</span>';
      else if (m[2]) out += '<span class="tk-s">' + esc(t) + '</span>';
      else if (m[3]) out += '<span class="tk-n">' + esc(t) + '</span>';
      else if (KW.has(m[4])) out += '<span class="tk-k">' + esc(m[4]) + '</span>' + esc(m[5] || '');
      else if (m[5]) out += '<span class="tk-f">' + esc(m[4]) + '</span>' + esc(m[5]);
      else out += esc(t);
      last = m.index + t.length;
    }
    return out + esc(line.slice(last));
  }

  // ---------------------------------------------------------------- links
  function editorUrl(l) {
    if (!prefs.root) return null;
    const abs = prefs.root.replace(/\\/g, '/').replace(/\/$/, '') + '/' + l.path;
    if (prefs.editor === 'idea') return 'idea://open?file=' + encodeURIComponent(abs) + '&line=' + l.lineNumber;
    return prefs.editor + '://file' + encodeURI(abs.startsWith('/') ? abs : '/' + abs) + ':' + l.lineNumber;
  }
  function remoteUrl(l) {
    const r = meta.remote;
    const c = meta.commit;
    if (!r || !c) return null;
    if (/dev\.azure\.com|visualstudio\.com/.test(r)) return r + '?path=/' + l.path + '&version=GC' + c + '&line=' + l.lineNumber + '&lineEnd=' + l.lineNumber + '&lineStartColumn=1&lineEndColumn=1';
    if (/bitbucket\./.test(r)) return r + '/src/' + c + '/' + l.path + '#lines-' + l.lineNumber;
    if (/gitlab\./.test(r)) return r + '/-/blob/' + c + '/' + l.path + '#L' + l.lineNumber;
    return r + '/blob/' + c + '/' + l.path + '#L' + l.lineNumber;
  }
  function explanationHtml(l) {
    if (l.explanation) return (staleNodes.has(l.id) ? driftNote() : '') + md(l.explanation);
    return '<p class="empty">No storytelling explanation stored for this node yet. Ask your agent: <code>/waymark enrich ' + esc(doc.id) + '</code></p>';
  }

  // ---------------------------------------------------------------- map pane
  const STATUS = { fuzzy: '≈', unresolved: '⚠', missing: '⚠' };
  const mapPane = $('#mapPane');

  function renderMapPane() {
    const a = meta.anchors || {};
    const chips = [];
    if (meta.createdAt) chips.push('<span class="chip">Created ' + esc(new Date(meta.createdAt).toLocaleDateString()) + '</span>');
    if (meta.commit) chips.push('<span class="chip" title="' + esc(meta.commit) + '">@ ' + esc(meta.commit.slice(0, 8)) + (meta.branch ? ' · ' + esc(meta.branch) : '') + '</span>');
    chips.push('<span class="chip">' + traces.length + ' traces · ' + locs.length + ' nodes</span>');
    const broken = (a.unresolved || 0) + (a.missing || 0);
    if (broken) chips.push('<span class="chip bad">' + broken + ' unverified anchors</span>');
    if (a.fuzzy) chips.push('<span class="chip warn">' + a.fuzzy + ' approximate</span>');
    const sum = { supported: 0, partial: 0, unsupported: 0, hit: 0, miss: 0 };
    for (const l of locs) {
      const st = STATES[l.id] || {};
      if (sum[st.check] != null) sum[st.check]++;
      if (sum[st.exec] != null) sum[st.exec]++;
    }
    if (sum.supported + sum.partial + sum.unsupported) chips.push('<span class="chip ' + (sum.unsupported ? 'bad' : 'okc') + '" title="Fact-checked nodes">✓ ' + sum.supported + '/' + locs.length + ' verified' + (sum.unsupported ? ' · ' + sum.unsupported + ' unsupported' : '') + '</span>');
    if (sum.hit + sum.miss) chips.push('<span class="chip okc" title="Nodes executed by the tests">▶ ' + sum.hit + '/' + (sum.hit + sum.miss) + ' executed</span>');
    if (doc.kind === 'overview') chips.push('<span class="chip okc">overview map</span>');
    if (staleNodes.size) chips.push('<span class="chip warn" title="Code changed after these nodes were explained">' + staleNodes.size + ' explanations to review</span>');

    const head =
      '<div class="mp-head"><h1>' + esc(doc.title) + '</h1><div class="chips">' + chips.join('') + '</div>' +
      '<div class="summary">' + inline(doc.description) + '</div>' +
      '<div class="mp-actions">' +
      (doc.story ? '<button class="pill" id="storyBtn" aria-expanded="false">Read the full story</button>' : '') +
      '<button class="pill" id="explainAllBtn" title="Expand every node with its explanation">Explain all nodes</button>' +
      '<button class="pill" id="guidesBtn" title="Open every trace guide">Open all guides</button>' +
      '</div>' +
      (doc.story ? '<div class="story md" id="story" hidden><div class="ai-label">AI generated story</div>' + (drift.story ? driftNote('story') : '') + md(doc.story) + '</div>' : '') +
      '</div>';

    const seen = new Set();
    const treeHtml = (nodes) => {
      if (!nodes || !nodes.length) return '';
      return '<ul class="tt">' + nodes.map((n) => {
        const l = n.ref && byId.get(n.ref);
        let inner;
        if (l && seen.has(l.id)) {
          inner = '<div class="loc ref-again" data-id="' + l.id + '" style="--tc:' + l.trace.color + '"><div class="loc-top"><span class="lid">' + l.id + '</span><span class="lt">' + esc(n.label || l.title) + '</span></div></div>';
        } else if (l) {
          seen.add(l.id);
          const st =
            (STATUS[l.status] ? '<span class="st ' + l.status + '" title="' + esc(l.note || l.status) + '">' + STATUS[l.status] + '</span>' : '') +
            (staleNodes.has(l.id) ? '<span class="st drift" title="Code changed after this node was explained">◔</span>' : '') +
            badges(l);
          inner =
            '<div class="loc" data-id="' + l.id + '" tabindex="0" style="--tc:' + l.trace.color + '">' +
            '<div class="loc-top"><span class="lid">' + l.id + '</span><span class="lt">' + esc(n.label || l.title) + '</span>' + st +
            '<span class="lf" title="' + esc(l.path) + '">' + esc(base(l.path)) + '</span></div>' +
            '<div class="loc-code"><span class="ln">' + l.lineNumber + '</span><code>' + hl(l.lineContent || '', extOf(l.path)) + '</code></div>' +
            '<div class="loc-more"><div class="loc-desc">' + inline(l.description) + '</div>' +
            '<button class="explain" data-explain="' + l.id + '">' + (l.explanation ? 'Show explanation' : 'Explain') + '</button> ' +
            '<button class="explain" data-copy-node="' + l.id + '" title="Copy this node (with its trace context) as markdown for an agent">Copy context</button>' +
            '<div class="expl md" hidden></div>' + extrasHtml(l) + '</div></div>';
        } else {
          inner = '<div class="lbl">' + esc(n.label || '…') + '</div>';
        }
        const via = n.via ? '<div class="via">↳ ' + esc(n.via) + '</div>' : '';
        return '<li>' + via + inner + treeHtml(n.children) + '</li>';
      }).join('') + '</ul>';
    };

    const body = traces.map((t) => {
      const hasGuide = t.motivation || t.details;
      return (
        '<section class="trace" data-trace="' + esc(t.id) + '" style="--tc:' + t.color + '">' +
        '<div class="tr-head" data-toggle="' + esc(t.id) + '"><span class="tr-num">' + esc(t.id) + '</span><div class="tr-text">' +
        '<div class="tr-title">' + esc(t.title) + '</div><div class="tr-desc">' + inline(t.description) +
        (hasGuide ? ' <button class="see-more" data-guide="' + esc(t.id) + '">See more</button>' : '') + '</div></div>' +
        '<button class="tcopy" data-copy-trace="' + esc(t.id) + '" title="Copy this trace as markdown context for an agent">⧉</button>' +
        '<span class="caret">▾</span></div>' +
        (hasGuide
          ? '<div class="guide md" hidden><div class="ai-label">AI generated guide</div>' + (staleTraces.has(t.id) ? driftNote('trace guide') : '') +
            (t.motivation ? '<h4>Motivation</h4>' + md(t.motivation) : '') +
            (t.details ? '<h4>Details</h4>' + md(t.details) : '') + '</div>'
          : '') +
        '<div class="tr-body"><div class="tree-title">' + esc(t.diagramTitle || t.title) + '</div>' + treeHtml(t.tree) + '</div></section>'
      );
    }).join('');
    mapPane.innerHTML = head + body;
  }

  function toggleGuide(tid, force) {
    const sec = $('.trace[data-trace="' + tid + '"]', mapPane);
    if (!sec) return;
    const g = $('.guide', sec);
    const btn = $('.see-more', sec);
    if (!g) return;
    const show = force == null ? g.hidden : force;
    g.hidden = !show;
    if (btn) btn.textContent = show ? 'See less' : 'See more';
    if (show) sec.classList.remove('closed');
  }

  function toggleExplain(id, force) {
    const card = $('.loc[data-id="' + id + '"]:not(.ref-again)', mapPane);
    if (!card) return;
    const box = $('.expl', card);
    const btn = $('.explain', card);
    const l = byId.get(id);
    const show = force == null ? box.hidden : force;
    if (show && !box.innerHTML) box.innerHTML = explanationHtml(l);
    box.hidden = !show;
    card.classList.toggle('open', show);
    btn.classList.toggle('on', show);
    btn.textContent = show ? 'Hide explanation' : l.explanation ? 'Show explanation' : 'Explain';
  }

  mapPane.addEventListener('click', (e) => {
    const an = e.target.closest('[data-add-note]');
    if (an) { e.stopPropagation(); return addNote(an.dataset.addNote); }
    const om = e.target.closest('[data-open-map]');
    if (om) { e.stopPropagation(); return host && host.postMessage({ type: 'openMap', ref: om.dataset.openMap }); }
    const ct = e.target.closest('[data-copy-trace]');
    if (ct) { e.stopPropagation(); return copy(ct, (DATA.traceMd || {})[ct.dataset.copyTrace] || '', '⧉'); }
    const cn = e.target.closest('[data-copy-node]');
    if (cn) { e.stopPropagation(); return copy(cn, (DATA.nodeMd || {})[cn.dataset.copyNode] || '', 'Copy context'); }
    const r = e.target.closest('[data-ref]');
    if (r) { e.preventDefault(); return select(r.dataset.ref); }
    const sm = e.target.closest('[data-guide]');
    if (sm) { e.stopPropagation(); return toggleGuide(sm.dataset.guide); }
    const ex = e.target.closest('[data-explain]');
    if (ex) { e.stopPropagation(); return toggleExplain(ex.dataset.explain); }
    if (e.target.closest('#storyBtn')) {
      const s = $('#story');
      s.hidden = !s.hidden;
      e.target.textContent = s.hidden ? 'Read the full story' : 'Hide the story';
      e.target.classList.toggle('on', !s.hidden);
      return;
    }
    if (e.target.closest('#explainAllBtn')) {
      const on = !document.body.classList.contains('explain-all');
      document.body.classList.toggle('explain-all', on);
      locs.forEach((l) => toggleExplain(l.id, on));
      e.target.classList.toggle('on', on);
      e.target.textContent = on ? 'Collapse explanations' : 'Explain all nodes';
      return;
    }
    if (e.target.closest('#guidesBtn')) {
      const on = !e.target.classList.contains('on');
      traces.forEach((t) => toggleGuide(t.id, on));
      e.target.classList.toggle('on', on);
      e.target.textContent = on ? 'Close all guides' : 'Open all guides';
      return;
    }
    const card = e.target.closest('.loc[data-id]');
    if (card) return select(card.dataset.id);
    const th = e.target.closest('[data-toggle]');
    if (th) th.parentElement.classList.toggle('closed');
  });
  mapPane.addEventListener('keydown', (e) => {
    const card = e.target.closest('.loc[data-id]');
    if (card && e.key === 'Enter') select(card.dataset.id);
  });

  // ---------------------------------------------------------------- code view
  const codeEl = $('#code');
  const codeScroll = $('#codeScroll');
  const tabsEl = $('#fileTabs');

  function renderTabs() {
    tabsEl.innerHTML = fileOrder.map((p) => {
      const n = locs.filter((l) => l.path === p).length;
      return '<button class="ftab' + (p === state.file ? ' on' : '') + '" data-file="' + esc(p) + '" title="' + esc(p) + '">' + esc(base(p)) + '<span class="cnt">' + n + '</span></button>';
    }).join('');
    const on = $('.ftab.on', tabsEl);
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-file]');
    if (!b) return;
    const first = locs.find((l) => l.path === b.dataset.file);
    if (first) select(first.id);
  });

  function renderFile(p) {
    state.file = p;
    renderTabs();
    const ext = extOf(p);
    const markers = new Map();
    for (const l of locs) if (l.path === p) {
      if (!markers.has(l.lineNumber)) markers.set(l.lineNumber, []);
      markers.get(l.lineNumber).push(l);
    }
    const rows = [];
    const emit = (no, text) => {
      const mk = markers.get(no);
      const gut = mk ? mk.map((l) => '<a class="gm" data-ref="' + l.id + '" style="--tc:' + l.trace.color + '" title="' + esc(l.title) + '">' + l.id + '</a>').join('') : '';
      rows.push('<div class="cl' + (mk ? ' anchored' : '') + '" data-line="' + no + '"><span class="gut">' + gut + '</span><span class="no">' + no + '</span><span class="tx">' + hl(text, ext) + '</span></div>');
    };
    if (FILES[p] != null) {
      FILES[p].split('\n').forEach((t, i) => emit(i + 1, t));
    } else {
      rows.push('<div class="code-note">Only snippets are available for this file (it was missing or too large to embed).</div>');
      const lines = new Map();
      for (const l of locs) if (l.path === p && l.snippet) l.snippet.code.split('\n').forEach((t, i) => lines.set(l.snippet.startLine + i, t));
      if (!lines.size) for (const l of locs) if (l.path === p) lines.set(l.lineNumber, l.lineContent || '');
      let prev = null;
      for (const no of [...lines.keys()].sort((a, b) => a - b)) {
        if (prev !== null && no !== prev + 1) rows.push('<div class="gap">⋯</div>');
        emit(no, lines.get(no));
        prev = no;
      }
    }
    codeEl.innerHTML = rows.join('');
  }

  function showInCode(l) {
    if (state.file !== l.path) renderFile(l.path);
    $$('.cl.hl', codeEl).forEach((e) => e.classList.remove('hl'));
    $$('.anno, .anno-expl', codeEl).forEach((e) => e.remove());
    const row = $('.cl[data-line="' + l.lineNumber + '"]', codeEl);
    if (!row) return;
    row.classList.add('hl');
    const i = locs.indexOf(byId.get(l.id));
    const anno = document.createElement('div');
    anno.className = 'anno';
    anno.style.setProperty('--tc', l.trace.color);
    anno.innerHTML =
      '<span class="lid">' + l.id + '</span><span class="ad">' + inline(l.description) + '</span>' +
      '<button class="xbtn" data-anno-expl>' + (state.annoExpl ? 'Hide' : 'Explain') + '</button>' +
      (staleNodes.has(l.id) ? '<span class="st drift" title="Code changed after this node was explained">◔</span>' : '') +
      '<span class="an">' + (host ? '<a data-open-editor="' + l.id + '" title="Reveal in the editor">open ↗</a>' : '') +
      (i > 0 ? '<a data-go="' + (i - 1) + '">← prev</a>' : '') + (i < locs.length - 1 ? '<a data-go="' + (i + 1) + '">next →</a>' : '') + '</span>';
    row.parentNode.insertBefore(anno, row);
    if (state.annoExpl) {
      const ex = document.createElement('div');
      ex.className = 'anno-expl md';
      ex.style.setProperty('--tc', l.trace.color);
      ex.innerHTML = explanationHtml(l);
      row.parentNode.insertBefore(ex, row);
    }
    if (state.view === 'code') codeScroll.scrollTop = Math.max(0, anno.offsetTop - codeScroll.clientHeight / 3);
  }
  codeEl.addEventListener('click', (e) => {
    const oe = e.target.closest('[data-open-editor]');
    if (oe) return openInHost(oe.dataset.openEditor);
    const g = e.target.closest('[data-go]');
    if (g) return select(locs[+g.dataset.go].id);
    if (e.target.closest('[data-anno-expl]')) {
      state.annoExpl = !state.annoExpl;
      return showInCode(byId.get(state.sel));
    }
    const r = e.target.closest('[data-ref]');
    if (r) select(r.dataset.ref);
  });

  // ---------------------------------------------------------------- diagram (custom SVG: tidy tree per trace + cross links)
  const NODE_W = 200;
  const LOC_H = 60;
  const LBL_H = 36;
  const ROW_H = LOC_H + 54;
  const HGAP = 24;
  const PAD = 24;
  const HEAD = 40;
  const CGAP = 56;
  const STACK_IN = 30;

  const svg = $('#dg');
  const vp = $('#vp');
  const dgCard = $('#dgCard');
  const dgTip = $('#dgTip');
  const hidden = new Set();
  let dg = null;
  const view = { x: 0, y: 0, k: 1 };

  function buildDiagram() {
    const clusters = [];
    const nodes = [];
    for (const t of traces) {
      const cn = [];
      const ce = [];
      const seenLocal = new Set();
      let k = 0;
      const mk = (n, depth, parent) => {
        const l = n.ref ? byId.get(n.ref) : null;
        const kind = l ? (seenLocal.has(l.id) ? 'again' : 'loc') : 'label';
        if (l) seenLocal.add(l.id);
        const node = { key: t.id + ':' + k++, kind, loc: l, label: n.label || (l ? l.title : '…'), via: n.via, depth, parent, children: [], trace: t };
        node.h = kind === 'label' ? LBL_H : LOC_H;
        cn.push(node);
        node.children = (n.children || []).map((c) => mk(c, depth + 1, node));
        for (const c of node.children) ce.push({ from: node, to: c, label: c.via });
        return node;
      };
      const roots = (t.tree || []).map((n) => mk(n, 0, null));
      // Tidy tree, except that 3+ leaf children are stacked in a column under their parent
      // (with an elbow spine) instead of being spread horizontally: keeps clusters compact.
      const stackable = (n) => n.children.length >= 3 && n.children.every((c) => !c.children.length);
      const width = (n) => {
        if (!n.children.length) return (n.w = NODE_W);
        if (stackable(n)) {
          n.stack = true;
          for (const c of n.children) { c.stacked = true; if (c.via) c.h += 14; width(c); }
          return (n.w = NODE_W + STACK_IN);
        }
        const cw = n.children.reduce((s, c) => s + width(c), 0) + HGAP * (n.children.length - 1);
        return (n.w = Math.max(NODE_W, cw));
      };
      const place = (n, left, top) => {
        n.y = top + (n.stacked ? 0 : (LOC_H - n.h) / 2);
        if (!n.children.length) { n.x = left + (n.w - NODE_W) / 2; return; }
        if (n.stack) {
          n.x = left;
          let cy = top + LOC_H + 22;
          for (const c of n.children) { place(c, left + STACK_IN, cy); cy += c.h + 12; }
          return;
        }
        const cw = n.children.reduce((s, c) => s + c.w, 0) + HGAP * (n.children.length - 1);
        let cx = left + (n.w - cw) / 2;
        for (const c of n.children) { place(c, cx, top + ROW_H); cx += c.w + HGAP; }
        n.x = (n.children[0].x + n.children[n.children.length - 1].x) / 2;
      };
      let x = 0;
      for (const r of roots) { width(r); place(r, x, 0); x += r.w + HGAP; }
      const minX = Math.min(...cn.map((n) => n.x));
      const maxX = Math.max(...cn.map((n) => n.x + NODE_W));
      const maxY = Math.max(...cn.map((n) => n.y + n.h));
      const titleW = 60 + t.title.length * 7.2;
      const w = Math.max(maxX - minX, titleW) + PAD * 2;
      clusters.push({ trace: t, nodes: cn, edges: ce, w, h: maxY + PAD * 2 + HEAD, offX: PAD - minX + (w - PAD * 2 - (maxX - minX)) / 2, offY: HEAD + PAD });
      nodes.push(...cn);
    }
    // Flow layout of clusters into rows. Try several row widths and keep the one whose
    // bounding box best matches the viewport (largest fit scale), so clusters don't end up
    // in one very tall column or one very wide row.
    const flow = (maxRow, apply) => {
      let cx = 0;
      let cy = 0;
      let rowH = 0;
      let w = 0;
      for (const c of clusters) {
        if (cx > 0 && cx + c.w > maxRow) { cx = 0; cy += rowH + CGAP; rowH = 0; }
        if (apply) { c.x = cx; c.y = cy; }
        cx += c.w + CGAP;
        w = Math.max(w, cx - CGAP);
        rowH = Math.max(rowH, c.h);
      }
      return { w, h: cy + rowH };
    };
    const vr = svg.getBoundingClientRect();
    const vw = vr.width || 1200;
    const vh = vr.height || 800;
    const widest = Math.max(...clusters.map((c) => c.w));
    const total = clusters.reduce((s, c) => s + c.w + CGAP, 0);
    let best = widest;
    let bestK = 0;
    for (let i = 0; i <= 12; i++) {
      const cand = widest + ((total - widest) * i) / 12;
      const b = flow(cand, false);
      const k = Math.min(vw / b.w, vh / b.h);
      if (k > bestK + 1e-6) { bestK = k; best = cand; }
    }
    flow(best, true);
    for (const c of clusters) for (const n of c.nodes) { n.ax = c.x + c.offX + n.x; n.ay = c.y + c.offY + n.y; }
    const primary = new Map(nodes.filter((n) => n.kind === 'loc').map((n) => [n.loc.id, n]));
    const links = (doc.links || []).map((l) => ({ ...l, a: primary.get(l.from), b: primary.get(l.to) })).filter((l) => l.a && l.b);
    const bounds = { w: Math.max(...clusters.map((c) => c.x + c.w)), h: Math.max(...clusters.map((c) => c.y + c.h)) };
    return { clusters, nodes, links, primary, bounds, aspect: vw / vh };
  }

  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function renderDiagram() {
    dg = buildDiagram();
    vp.innerHTML = '';
    const gClusters = el('g', {}, vp);
    const gEdges = el('g', {}, vp);
    const gLinks = el('g', {}, vp);
    const gNodes = el('g', {}, vp);
    const gLabels = el('g', {}, vp);

    for (const c of dg.clusters) {
      const g = el('g', { class: 'cluster', 'data-t': c.trace.id, style: '--tc:' + c.trace.color }, gClusters);
      el('rect', { class: 'box', x: c.x, y: c.y, width: c.w, height: c.h, rx: 14 }, g);
      const head = el('g', { class: 'chead', 'data-fit': c.trace.id }, g);
      el('rect', { x: c.x, y: c.y, width: c.w, height: HEAD - 6, rx: 14 }, head);
      const tx = el('text', { x: c.x + 16, y: c.y + 22 }, head);
      tx.textContent = c.trace.id + '  ·  ' + c.trace.title;
      for (const e of c.edges) {
        if (e.to.stacked) {
          // Elbow from the parent's left spine to the stacked child; the via label lives inside the card.
          const sx = e.from.ax + STACK_IN / 2;
          const sy = e.from.ay + e.from.h;
          const ty = e.to.ay + Math.min(e.to.h, LOC_H) / 2;
          el('path', { class: 'edge', d: 'M' + sx + ',' + sy + ' V' + (ty - 8) + ' Q' + sx + ',' + ty + ' ' + (sx + 8) + ',' + ty + ' H' + (e.to.ax - 2), 'marker-end': 'url(#arr)', 'data-t': c.trace.id, 'data-a': e.from.key, 'data-b': e.to.key }, gEdges);
          continue;
        }
        const x1 = e.from.ax + NODE_W / 2;
        const y1 = e.from.ay + e.from.h;
        const x2 = e.to.ax + NODE_W / 2;
        const y2 = e.to.ay;
        const my = (y1 + y2) / 2;
        el('path', { class: 'edge', d: 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + my + ' ' + x2 + ',' + my + ' ' + x2 + ',' + (y2 - 2), 'marker-end': 'url(#arr)', 'data-t': c.trace.id, 'data-a': e.from.key, 'data-b': e.to.key }, gEdges);
        if (e.label) {
          const t = el('text', { class: 'elabel', x: (x1 + x2) / 2 + 6, y: my + 4, 'data-t': c.trace.id, 'data-a': e.from.key, 'data-b': e.to.key }, gLabels);
          t.textContent = e.label;
        }
      }
    }
    for (const L of dg.links) {
      const a = L.a;
      const b = L.b;
      const sameRow = Math.abs(a.ay - b.ay) < ROW_H;
      const x1 = a.ax + (b.ax > a.ax ? NODE_W : 0);
      const y1 = a.ay + a.h / 2;
      const x2 = b.ax + (b.ax > a.ax ? 0 : NODE_W);
      const y2 = b.ay + b.h / 2;
      const dx = Math.max(60, Math.abs(x2 - x1) / 2);
      const d = sameRow && Math.abs(x2 - x1) < 10
        ? 'M' + (a.ax + NODE_W) + ',' + y1 + ' C' + (a.ax + NODE_W + 80) + ',' + y1 + ' ' + (b.ax + NODE_W + 80) + ',' + y2 + ' ' + (b.ax + NODE_W) + ',' + y2
        : 'M' + x1 + ',' + y1 + ' C' + (x1 + (x2 > x1 ? dx : -dx)) + ',' + y1 + ' ' + (x2 + (x2 > x1 ? -dx : dx)) + ',' + y2 + ' ' + x2 + ',' + y2;
      const ts = a.trace.id + ' ' + b.trace.id;
      el('path', { class: 'link', d, stroke: a.trace.color, 'marker-end': 'url(#arr2)', 'data-t': ts, 'data-a': a.key, 'data-b': b.key }, gLinks);
      if (L.label) {
        const g = el('g', { class: 'llabel', 'data-t': ts, 'data-a': a.key, 'data-b': b.key }, gLabels);
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const w = L.label.length * 6.1 + 14;
        el('rect', { x: mx - w / 2, y: my - 10, width: w, height: 20, rx: 10 }, g);
        const t = el('text', { x: mx, y: my + 4, 'text-anchor': 'middle' }, g);
        t.textContent = L.label;
      }
    }
    for (const n of dg.nodes) {
      const g = el('g', { class: 'node', 'data-t': n.trace.id, 'data-key': n.key }, gNodes);
      const fo = el('foreignObject', { x: n.ax, y: n.ay, width: NODE_W, height: n.h }, g);
      const div = document.createElement('div');
      div.style.setProperty('--tc', n.trace.color);
      if (n.kind === 'label') {
        div.className = 'dn label';
        div.innerHTML = '<div class="t">' + esc(n.label) + '</div>';
      } else {
        div.className = 'dn ' + n.kind + (staleNodes.has(n.loc.id) ? ' drift' : '');
        div.dataset.id = n.loc.id;
        div.innerHTML =
          (n.stacked && n.via ? '<div class="v">↳ ' + esc(n.via) + '</div>' : '') +
          '<div class="h"><span class="i">' + (n.kind === 'again' ? '↺ ' : '') + n.loc.id + '</span><span class="t">' + esc(n.label) + '</span>' +
          (staleNodes.has(n.loc.id) ? '<span class="dr" title="Code changed after this node was explained">◔</span>' : '') + badges(n.loc) + '</div>' +
          '<div class="f">' + esc(base(n.loc.path)) + ':' + n.loc.lineNumber + '</div>';
      }
      if (n.kind === 'label' && n.stacked && n.via) div.insertAdjacentHTML('afterbegin', '<div class="v">↳ ' + esc(n.via) + '</div>');
      fo.appendChild(div);
    }
    applyHidden();
    renderMinimap();
    fit();
  }

  // ---- minimap: overview of clusters + current viewport; click/drag to navigate
  const mini = $('#mini');
  const miniContent = $('#miniContent');
  const miniView = $('#miniView');
  const MINI_W = 170;
  const MINI_H = 120;
  let miniScale = 1;
  function renderMinimap() {
    if (!dg) return;
    const b = dg.bounds;
    miniScale = Math.min(MINI_W / b.w, MINI_H / b.h);
    mini.setAttribute('width', Math.ceil(b.w * miniScale));
    mini.setAttribute('height', Math.ceil(b.h * miniScale));
    miniContent.innerHTML = '';
    for (const c of dg.clusters) {
      if (hidden.has(c.trace.id)) continue;
      el('rect', { x: c.x * miniScale, y: c.y * miniScale, width: c.w * miniScale, height: c.h * miniScale, rx: 3, fill: c.trace.color, 'fill-opacity': 0.18, stroke: c.trace.color, 'stroke-opacity': 0.6 }, miniContent);
      for (const n of c.nodes) el('rect', { x: n.ax * miniScale, y: n.ay * miniScale, width: NODE_W * miniScale, height: n.h * miniScale, fill: c.trace.color, 'fill-opacity': 0.7 }, miniContent);
    }
    updateMinimap();
  }
  function updateMinimap() {
    if (!dg) return;
    const r = svg.getBoundingClientRect();
    miniView.setAttribute('x', (-view.x / view.k) * miniScale);
    miniView.setAttribute('y', (-view.y / view.k) * miniScale);
    miniView.setAttribute('width', (r.width / view.k) * miniScale);
    miniView.setAttribute('height', (r.height / view.k) * miniScale);
  }
  function miniJump(e) {
    const mr = mini.getBoundingClientRect();
    const r = svg.getBoundingClientRect();
    const gx = (e.clientX - mr.left) / miniScale;
    const gy = (e.clientY - mr.top) / miniScale;
    view.x = r.width / 2 - gx * view.k;
    view.y = r.height / 2 - gy * view.k;
    applyTransform();
  }
  mini.addEventListener('pointerdown', (e) => {
    mini.setPointerCapture(e.pointerId);
    miniJump(e);
    const move = (ev) => miniJump(ev);
    mini.addEventListener('pointermove', move);
    mini.addEventListener('pointerup', () => mini.removeEventListener('pointermove', move), { once: true });
  });

  // ---- export the diagram as a standalone SVG (styles and theme colours inlined)
  function exportSvg() {
    if (!dg) return;
    const b = dg.bounds;
    const pad = 20;
    const clone = svg.cloneNode(true);
    clone.removeAttribute('id');
    clone.setAttribute('viewBox', [-pad, -pad, b.w + pad * 2, b.h + pad * 2].join(' '));
    clone.setAttribute('width', b.w + pad * 2);
    clone.setAttribute('height', b.h + pad * 2);
    clone.querySelector('#vp').removeAttribute('transform');
    clone.querySelectorAll('.dim').forEach((x) => x.classList.remove('dim'));
    clone.classList.remove('focus', 'panning');
    const cs = getComputedStyle(document.documentElement);
    const vars = ['--bg', '--panel', '--panel2', '--ink', '--ink2', '--muted', '--line', '--accent', '--mono', '--sans', '--warn']
      .map((v) => v + ':' + cs.getPropertyValue(v)).join(';');
    const style = document.createElementNS(SVGNS, 'style');
    style.textContent = 'svg{' + vars + ';background:' + cs.getPropertyValue('--bg') + '}' + document.querySelector('style').textContent;
    clone.insertBefore(style, clone.firstChild);
    const bg = document.createElementNS(SVGNS, 'rect');
    for (const [k, v] of Object.entries({ x: -pad, y: -pad, width: b.w + pad * 2, height: b.h + pad * 2, fill: cs.getPropertyValue('--bg') })) bg.setAttribute(k, v);
    clone.insertBefore(bg, style.nextSibling);
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = doc.id + '.svg';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  $('#exportSvg').onclick = exportSvg;

  function applyTransform() {
    vp.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
    updateMinimap();
  }
  let anim = null;
  function animateTo(x, y, k) {
    cancelAnimationFrame(anim);
    const from = { ...view };
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 260);
      const e = 1 - Math.pow(1 - p, 3);
      view.x = from.x + (x - from.x) * e;
      view.y = from.y + (y - from.y) * e;
      view.k = from.k + (k - from.k) * e;
      applyTransform();
      if (p < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  function fitBox(bx, by, bw, bh, maxK = 1.1, animate = true) {
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const k = clamp(Math.min((r.width - 60) / bw, (r.height - 90) / bh), 0.12, maxK);
    const x = (r.width - bw * k) / 2 - bx * k;
    const y = (r.height - bh * k) / 2 - by * k + 20;
    if (animate) animateTo(x, y, k);
    else { view.x = x; view.y = y; view.k = k; applyTransform(); }
  }
  function fit(animate = false) {
    if (!dg) return;
    const vis = dg.clusters.filter((c) => !hidden.has(c.trace.id));
    if (!vis.length) return;
    const x0 = Math.min(...vis.map((c) => c.x));
    const y0 = Math.min(...vis.map((c) => c.y));
    const x1 = Math.max(...vis.map((c) => c.x + c.w));
    const y1 = Math.max(...vis.map((c) => c.y + c.h));
    fitBox(x0, y0, x1 - x0, y1 - y0, 1, animate);
  }
  function zoomBy(f, cx, cy) {
    const r = svg.getBoundingClientRect();
    const mx = cx == null ? r.width / 2 : cx;
    const my = cy == null ? r.height / 2 : cy;
    const k = clamp(view.k * f, 0.12, 3);
    view.x = mx - (mx - view.x) * (k / view.k);
    view.y = my - (my - view.y) * (k / view.k);
    view.k = k;
    applyTransform();
  }
  function centerOn(n) {
    const r = svg.getBoundingClientRect();
    const k = Math.max(view.k, 0.8);
    animateTo(r.width / 2 - (n.ax + NODE_W / 2) * k, r.height / 2.4 - (n.ay + n.h / 2) * k, k);
  }

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  let pan = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.dn') || e.target.closest('.chead')) return;
    pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('panning');
  });
  svg.addEventListener('pointermove', (e) => {
    if (pan) {
      const dx = e.clientX - pan.x;
      const dy = e.clientY - pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
      view.x = pan.vx + dx;
      view.y = pan.vy + dy;
      applyTransform();
      return;
    }
    const d = e.target.closest('.dn[data-id]');
    if (!d) { dgTip.hidden = true; return; }
    const l = byId.get(d.dataset.id);
    const box = $('#diagramView').getBoundingClientRect();
    dgTip.style.setProperty('--tc', l.trace.color);
    dgTip.innerHTML = '<b>' + l.id + '</b>' + esc(l.title) + '<div>' + inline(l.description) + '</div>';
    dgTip.hidden = false;
    dgTip.style.left = Math.min(e.clientX - box.left + 14, box.width - 350) + 'px';
    dgTip.style.top = e.clientY - box.top + 16 + 'px';
  });
  svg.addEventListener('pointerleave', () => { dgTip.hidden = true; });
  svg.addEventListener('pointerup', (e) => {
    if (pan) {
      svg.classList.remove('panning');
      if (!pan.moved) clearFocus();
      pan = null;
    }
  });
  svg.addEventListener('click', (e) => {
    const d = e.target.closest('.dn[data-id]');
    if (d) return select(d.dataset.id, { from: 'diagram' });
    const h = e.target.closest('[data-fit]');
    if (h) {
      const c = dg.clusters.find((x) => x.trace.id === h.dataset.fit);
      fitBox(c.x, c.y, c.w, c.h, 1.2);
    }
  });
  svg.addEventListener('dblclick', (e) => {
    const d = e.target.closest('.dn[data-id]');
    if (!d) return;
    const l = byId.get(d.dataset.id);
    if (l && l.mapRef) {
      if (host) host.postMessage({ type: 'openMap', ref: l.mapRef });
      else location.href = mapHref(l.mapRef);
      return;
    }
    select(d.dataset.id);
    setView('code');
  });

  function relatedKeys(n) {
    const keys = new Set([n.key]);
    for (let p = n.parent; p; p = p.parent) keys.add(p.key);
    const down = (x) => { for (const c of x.children) { keys.add(c.key); down(c); } };
    down(n);
    for (const L of dg.links) {
      if (L.a === n) keys.add(L.b.key);
      if (L.b === n) keys.add(L.a.key);
    }
    return keys;
  }
  function focusDiagram(id) {
    if (!dg) return;
    const n = dg.primary.get(id);
    $$('.dn.sel', svg).forEach((e) => e.classList.remove('sel'));
    if (!n) return;
    $$('.dn[data-id="' + id + '"]', svg).forEach((e) => e.classList.add('sel'));
    const keys = relatedKeys(n);
    svg.classList.add('focus');
    $$('.node', svg).forEach((g) => g.classList.toggle('dim', !keys.has(g.dataset.key)));
    $$('[data-a]', svg).forEach((p) => p.classList.toggle('dim', !(keys.has(p.dataset.a) && keys.has(p.dataset.b))));
    return n;
  }
  function clearFocus() {
    svg.classList.remove('focus');
    $$('.dim', svg).forEach((e) => e.classList.remove('dim'));
    $$('.dn.sel', svg).forEach((e) => e.classList.remove('sel'));
    dgCard.hidden = true;
  }
  function renderCard(l) {
    const lines = FILES[l.path] != null ? FILES[l.path].split('\n') : null;
    let snippet = '';
    const from = Math.max(1, l.lineNumber - 3);
    const ext = extOf(l.path);
    if (lines) {
      const to = Math.min(lines.length, l.lineNumber + 6);
      for (let i = from; i <= to; i++) snippet += '<span class="r' + (i === l.lineNumber ? ' hl' : '') + '"><span class="n">' + i + '</span>' + hl(lines[i - 1], ext) + '</span>';
    } else if (l.snippet) {
      l.snippet.code.split('\n').slice(0, 10).forEach((t, i) => {
        const no = l.snippet.startLine + i;
        snippet += '<span class="r' + (no === l.lineNumber ? ' hl' : '') + '"><span class="n">' + no + '</span>' + hl(t, ext) + '</span>';
      });
    }
    const ed = editorUrl(l);
    const rm = remoteUrl(l);
    dgCard.style.setProperty('--tc', l.trace.color);
    dgCard.innerHTML =
      '<div class="ch"><span class="lid">' + l.id + '</span><h3>' + esc(l.title) + '</h3><button class="x" data-close title="Close">×</button></div>' +
      '<div class="where">' + esc(l.path) + ':' + l.lineNumber + '</div>' +
      '<div class="cdesc">' + inline(l.description) + '</div>' +
      '<div class="expl md" style="--tc:' + l.trace.color + '">' + explanationHtml(l) + '</div>' + extrasHtml(l) +
      (snippet ? '<pre>' + snippet + '</pre>' : '') +
      '<div class="acts"><button class="pill" data-open-code>Open in code view</button>' +
      (host ? '<button class="pill" data-open-editor="' + l.id + '">Open in editor</button>' : ed ? '<a class="pill" href="' + esc(ed) + '">Open in editor</a>' : '') +
      '<button class="pill" data-copy-node="' + l.id + '">Copy context</button>' +
      (rm ? '<a class="pill" href="' + esc(rm) + '" target="_blank" rel="noopener">View on remote</a>' : '') + '</div>';
    dgCard.hidden = false;
  }
  dgCard.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return clearFocus();
    const cn = e.target.closest('[data-copy-node]');
    if (cn) return copy(cn, (DATA.nodeMd || {})[cn.dataset.copyNode] || '', 'Copy context');
    const an = e.target.closest('[data-add-note]');
    if (an) return addNote(an.dataset.addNote);
    const om = e.target.closest('[data-open-map]');
    if (om && host) return host.postMessage({ type: 'openMap', ref: om.dataset.openMap });
    const oe = e.target.closest('[data-open-editor]');
    if (oe && host) return openInHost(oe.dataset.openEditor);
    if (e.target.closest('[data-open-code]')) return setView('code');
    const r = e.target.closest('[data-ref]');
    if (r) select(r.dataset.ref, { from: 'diagram' });
  });

  function renderLegend() {
    $('#legend').innerHTML = traces.map((t) =>
      '<button class="lg' + (hidden.has(t.id) ? ' off' : '') + '" data-lg="' + esc(t.id) + '" style="--tc:' + t.color + '" title="Show/hide trace ' + esc(t.id) + '"><span class="dot"></span><span>' + esc(t.id + '. ' + t.title) + '</span></button>').join('');
  }
  function applyHidden() {
    $$('[data-t]', vp).forEach((e) => {
      const ts = e.getAttribute('data-t').split(' ');
      e.classList.toggle('hid', ts.some((t) => hidden.has(t)));
    });
  }
  $('#legend').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lg]');
    if (!b) return;
    const id = b.dataset.lg;
    if (hidden.has(id)) hidden.delete(id); else if (hidden.size < traces.length - 1) hidden.add(id);
    renderLegend();
    applyHidden();
    fit(true);
  });
  $('#zin').onclick = () => zoomBy(1.25);
  $('#zout').onclick = () => zoomBy(0.8);
  $('#zfit').onclick = () => fit(true);
  $('#zsel').onclick = () => { const n = state.sel && dg && dg.primary.get(state.sel); if (n) centerOn(n); };

  // ---------------------------------------------------------------- search
  const searchEl = $('#search');
  const resultsEl = $('#searchResults');
  let matches = [];
  function haystack(l) {
    return [l.id, l.title, l.description, l.explanation, l.path, l.lineContent, l.symbol, l.trace.title].join(' ').toLowerCase();
  }
  function runSearch() {
    const q = searchEl.value.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    matches = terms.length ? locs.filter((l) => terms.every((t) => haystack(l).includes(t))) : [];
    document.body.classList.toggle('searching', terms.length > 0);
    const hit = new Set(matches.map((m) => m.id));
    $$('.loc[data-id]', mapPane).forEach((c) => c.classList.toggle('match', hit.has(c.dataset.id)));
    if (dg) $$('.node', svg).forEach((g) => {
      const d = g.querySelector('.dn[data-id]');
      g.classList.toggle('nomatch', terms.length > 0 && !(d && hit.has(d.dataset.id)));
    });
    svg.classList.toggle('searching', terms.length > 0);
    if (!terms.length) { resultsEl.hidden = true; return; }
    resultsEl.innerHTML = matches.length
      ? matches.slice(0, 14).map((l, i) =>
          '<div class="sr' + (i === 0 ? ' on' : '') + '" data-ref="' + l.id + '" style="--tc:' + l.trace.color + '"><span class="lid">' + l.id + '</span><span class="srt">' + esc(l.title) +
          '</span><span class="srf">' + esc(base(l.path)) + ':' + l.lineNumber + '</span></div>').join('') + (matches.length > 14 ? '<div class="sr more">+' + (matches.length - 14) + ' more</div>' : '')
      : '<div class="sr more">No nodes match</div>';
    resultsEl.hidden = false;
  }
  searchEl.addEventListener('input', runSearch);
  searchEl.addEventListener('keydown', (e) => {
    const items = $$('.sr[data-ref]', resultsEl);
    const cur = items.findIndex((x) => x.classList.contains('on'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      const next = (cur + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((x, i) => x.classList.toggle('on', i === next));
      items[next].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      const it = items[cur >= 0 ? cur : 0];
      if (it) { select(it.dataset.ref); resultsEl.hidden = true; }
    } else if (e.key === 'Escape') {
      searchEl.value = '';
      runSearch();
      searchEl.blur();
    }
  });
  resultsEl.addEventListener('mousedown', (e) => {
    const it = e.target.closest('[data-ref]');
    if (it) { e.preventDefault(); select(it.dataset.ref); resultsEl.hidden = true; }
  });
  searchEl.addEventListener('blur', () => setTimeout(() => (resultsEl.hidden = true), 120));
  searchEl.addEventListener('focus', () => { if (searchEl.value.trim()) runSearch(); });

  // ---------------------------------------------------------------- VS Code bridge
  function openInHost(id) {
    const l = byId.get(id);
    if (host && l) host.postMessage({ type: 'open', id: l.id, path: l.path, line: l.lineNumber });
  }
  if (host) {
    window.addEventListener('message', (e) => {
      const m = e.data || {};
      if (m.type === 'select' && byId.has(m.id) && m.id !== state.sel) select(m.id, { from: 'host' });
      if (m.type === 'explain' && byId.has(m.id)) {
        state.annoExpl = true;
        select(m.id, { from: 'host' });
        toggleExplain(m.id, true);
        if (state.view === 'diagram') renderCard(byId.get(m.id));
      }
      if (m.type === 'view' && (m.view === 'code' || m.view === 'diagram')) setView(m.view);
    });
  }

  // ---------------------------------------------------------------- selection & views
  function select(id, opts = {}) {
    const l = byId.get(id);
    if (!l) return;
    state.sel = id;
    if (host && opts.from !== 'host' && opts.from !== 'boot') host.postMessage({ type: 'select', id, path: l.path, line: l.lineNumber });
    $$('.loc.sel', mapPane).forEach((e) => e.classList.remove('sel'));
    const card = $('.loc[data-id="' + id + '"]:not(.ref-again)', mapPane);
    if (card) {
      card.classList.add('sel');
      card.closest('.trace').classList.remove('closed');
      if (opts.from !== 'map') card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    showInCode(l);
    if (dg) {
      const n = focusDiagram(id);
      if (state.view === 'diagram') {
        renderCard(l);
        if (n && opts.from !== 'diagram') centerOn(n);
      }
    }
    history.replaceState(null, '', '#' + id);
  }

  function setView(v) {
    state.view = v;
    prefs.view = v;
    savePrefs();
    $('#vCode').classList.toggle('on', v === 'code');
    $('#vDiagram').classList.toggle('on', v === 'diagram');
    $('#codeView').hidden = v !== 'code';
    $('#diagramView').hidden = v !== 'diagram';
    if (v === 'diagram') {
      if (!dg) renderDiagram();
      if (state.sel) {
        const n = focusDiagram(state.sel);
        renderCard(byId.get(state.sel));
        if (n) centerOn(n);
      }
    } else if (state.sel) {
      showInCode(byId.get(state.sel));
    }
  }
  $('#vCode').onclick = () => setView('code');
  $('#vDiagram').onclick = () => setView('diagram');

  document.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    const i = locs.findIndex((x) => x.id === state.sel);
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); if (locs[i + 1]) select(locs[i + 1].id); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); if (i > 0) select(locs[i - 1].id); }
    else if (e.key === 'e' && state.sel) toggleExplain(state.sel);
    else if (e.key === 'd') setView(state.view === 'code' ? 'diagram' : 'code');
    else if (e.key === 'f' && state.view === 'diagram') fit(true);
    else if (e.key === 'Escape') clearFocus();
    else if (e.key === '/') { e.preventDefault(); searchEl.focus(); searchEl.select(); }
  });

  // ---------------------------------------------------------------- splitter, settings, copy
  const splitter = $('#splitter');
  if (prefs.mapW) document.documentElement.style.setProperty('--map-w', prefs.mapW);
  splitter.addEventListener('pointerdown', (e) => {
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add('drag');
    const move = (ev) => {
      const pct = clamp((ev.clientX / window.innerWidth) * 100, 22, 75).toFixed(1) + '%';
      document.documentElement.style.setProperty('--map-w', pct);
      prefs.mapW = pct;
    };
    const up = () => {
      splitter.classList.remove('drag');
      splitter.removeEventListener('pointermove', move);
      savePrefs();
      window.dispatchEvent(new Event('resize'));
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up, { once: true });
  });

  $('#settingsBtn').onclick = () => { $('#settings').hidden = !$('#settings').hidden; };
  $('#setRoot').value = prefs.root;
  $('#setEditor').value = prefs.editor;
  const onPrefs = () => {
    prefs.root = $('#setRoot').value.trim();
    prefs.editor = $('#setEditor').value;
    savePrefs();
    if (state.sel && state.view === 'diagram') renderCard(byId.get(state.sel));
  };
  $('#setRoot').onchange = onPrefs;
  $('#setEditor').onchange = onPrefs;

  async function copy(btn, text, label) {
    try { await navigator.clipboard.writeText(text); btn.textContent = '✓'; } catch { btn.textContent = '✗'; }
    if (label.length > 2) btn.textContent = btn.textContent === '✓' ? 'Copied ✓' : 'Copy failed';
    setTimeout(() => (btn.textContent = label), 1400);
  }
  $('#copyCtx').onclick = (e) => copy(e.currentTarget, DATA.markdown || '', 'Copy context');
  $('#copyMmd').onclick = (e) => copy(e.currentTarget, DATA.mermaid || '', '⧉');

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!dg) return;
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // Only re-flow clusters when the viewport shape really changed; keep the user's pan/zoom otherwise.
      const ratio = r.width / r.height / dg.aspect;
      if (ratio > 0.75 && ratio < 1.33) return;
      if (state.view !== 'diagram') { dg = null; return; } // rebuilt with the new aspect on next open
      renderDiagram();
      if (state.sel) focusDiagram(state.sel);
    }, 250);
  });

  // ---------------------------------------------------------------- boot
  if (host || !MAPS.size) $('#allMaps').hidden = true;
  $('.top-title').textContent = doc.title;
  document.title = 'Waymark · ' + doc.title;
  renderMapPane();
  renderLegend();
  setView(state.view);
  const initial = decodeURIComponent(location.hash.slice(1));
  select(byId.has(initial) ? initial : locs[0].id, { from: 'boot' });
})();
