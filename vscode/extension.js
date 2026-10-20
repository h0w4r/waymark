'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const M = require('./lib/model');

/** @type {{workspaces: ReturnType<typeof M.loadWorkspace>[], activeKey: string|null, lastIndex: number, panel: vscode.WebviewPanel|null, panelKey: string|null, lastPosted: string|null}} */
const state = { workspaces: [], activeKey: null, lastIndex: -1, panel: null, panelKey: null, lastPosted: null };
const cfg = () => vscode.workspace.getConfiguration('waymark');
const keyOf = (w, m) => w.root + '::' + m.id;

function allMaps() {
  return state.workspaces.flatMap((w) => w.maps.map((m) => ({ w, m, key: keyOf(w, m) })));
}
function findMap(key) {
  return allMaps().find((x) => x.key === key) || null;
}
function activeMap() {
  return findMap(state.activeKey) || allMaps()[0] || null;
}
/** Workspace + repo-relative path of a document, if it belongs to a workspace with maps. */
function relOf(uri) {
  if (!uri || uri.scheme !== 'file') return null;
  const p = uri.fsPath;
  for (const w of state.workspaces) {
    const rel = path.relative(w.root, p);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return { w, rel: rel.split(path.sep).join('/') };
  }
  return null;
}

// ------------------------------------------------------------------ tree view
class MapsTree {
  constructor() {
    this._em = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._em.event;
  }
  refresh() {
    this._em.fire();
  }
  getChildren(el) {
    if (!el) return allMaps().map((x) => ({ kind: 'map', ...x }));
    if (el.kind === 'map') return el.m.traces.map((t) => ({ kind: 'trace', w: el.w, m: el.m, key: el.key, t }));
    if (el.kind === 'trace') return el.m.nodes.filter((n) => n.traceId === el.t.id).map((n) => ({ kind: 'node', w: el.w, m: el.m, key: el.key, n }));
    return [];
  }
  getTreeItem(el) {
    if (el.kind === 'map') {
      const it = new vscode.TreeItem(el.m.title, vscode.TreeItemCollapsibleState.Collapsed);
      const stale = el.m.nodes.filter((n) => n.stale).length;
      it.description = `${el.m.nodes.length} nodes${stale ? ` · ${stale} to review` : ''}${el.key === activeMap()?.key ? ' · active' : ''}`;
      it.tooltip = new vscode.MarkdownString(`**${el.m.title}**\n\n${el.m.description || ''}\n\n\`${el.m.id}\``);
      it.iconPath = new vscode.ThemeIcon(el.key === activeMap()?.key ? 'map-filled' : 'map');
      it.contextValue = 'waymarkMap';
      it.id = el.key;
      return it;
    }
    if (el.kind === 'trace') {
      const it = new vscode.TreeItem(`${el.t.id}. ${el.t.title}`, vscode.TreeItemCollapsibleState.Collapsed);
      it.tooltip = el.t.description;
      it.iconPath = new vscode.ThemeIcon('git-commit');
      it.id = el.key + '::t' + el.t.id;
      return it;
    }
    const n = el.n;
    const it = new vscode.TreeItem(`${n.id}  ${n.title}`, vscode.TreeItemCollapsibleState.None);
    it.description = `${path.posix.basename(n.path)}:${n.line}`;
    const md = new vscode.MarkdownString(M.nodeMarkdown(n));
    it.tooltip = md;
    it.iconPath = new vscode.ThemeIcon(n.stale ? 'warning' : n.status === 'unresolved' || n.status === 'missing' ? 'error' : 'debug-breakpoint-log');
    it.command = { command: 'waymark.revealNode', title: 'Reveal', arguments: [el.key, n.id] };
    it.contextValue = 'waymarkNode';
    it.id = el.key + '::n' + n.id;
    return it;
  }
}
const tree = new MapsTree();

// ------------------------------------------------------------------ decorations (gutter + hover)
const iconTypes = new Map();
let lineType = null;
function iconType(n) {
  const k = n.id + '|' + n.color;
  if (!iconTypes.has(k)) {
    iconTypes.set(
      k,
      vscode.window.createTextEditorDecorationType({
        gutterIconPath: vscode.Uri.parse(M.gutterSvg(n.id, n.color)),
        gutterIconSize: 'contain',
        overviewRulerColor: n.color,
        overviewRulerLane: vscode.OverviewRulerLane.Right,
      }),
    );
  }
  return iconTypes.get(k);
}
function cmdLink(label, command, args) {
  return `[${label}](command:${command}?${encodeURIComponent(JSON.stringify(args))})`;
}
function hoverFor(key, n) {
  const md = new vscode.MarkdownString(M.nodeMarkdown(n));
  md.appendMarkdown('\n\n' + [cmdLink('Open in Waymark', 'waymark.openViewer', [key, n.id]), cmdLink('Explain', 'waymark.explain', [key, n.id])].join(' · '));
  md.isTrusted = true;
  return md;
}
function decorate(editor) {
  if (!editor) return;
  const info = relOf(editor.document.uri);
  const byType = new Map();
  const lines = [];
  if (info && cfg().get('gutter.enabled', true)) {
    const active = activeMap();
    const nodes = [...(info.w.byFile.get(info.rel) || [])].sort((a, b) => (b.mapId === active?.m.id) - (a.mapId === active?.m.id));
    const seenLine = new Set();
    for (const n of nodes) {
      const key = info.w.root + '::' + n.mapId;
      const range = new vscode.Range(n.line - 1, 0, n.line - 1, 0);
      lines.push({ range, hoverMessage: hoverFor(key, n) });
      if (seenLine.has(n.line)) continue; // one icon per line; hovers stack
      seenLine.add(n.line);
      const t = iconType(n);
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push({ range });
    }
  }
  for (const t of iconTypes.values()) editor.setDecorations(t, byType.get(t) || []);
  editor.setDecorations(lineType, lines);
}
function refreshDecorations() {
  for (const e of vscode.window.visibleTextEditors) decorate(e);
}

// ------------------------------------------------------------------ code lenses ("2b · description · Explain · ← prev · next →")
class Lenses {
  constructor() {
    this._em = new vscode.EventEmitter();
    this.onDidChangeCodeLenses = this._em.event;
  }
  fire() {
    this._em.fire();
  }
  provideCodeLenses(document) {
    if (!cfg().get('codeLens.enabled', true)) return [];
    const info = relOf(document.uri);
    if (!info) return [];
    const scope = cfg().get('codeLens.scope', 'activeMap');
    const maps = scope === 'allMaps' ? info.w.maps : [activeMap()?.w === info.w ? activeMap().m : null].filter(Boolean);
    const out = [];
    for (const m of maps) {
      const key = keyOf(info.w, m);
      m.nodes.forEach((n, i) => {
        if (n.path !== info.rel) return;
        const range = new vscode.Range(n.line - 1, 0, n.line - 1, 0);
        const desc = n.description.length > 90 ? n.description.slice(0, 87) + '…' : n.description;
        out.push(new vscode.CodeLens(range, { title: `${n.id} · ${desc}${n.stale ? '  ◔ review' : ''}`, command: 'waymark.openViewer', arguments: [key, n.id], tooltip: `${m.title} › ${n.traceTitle}` }));
        out.push(new vscode.CodeLens(range, { title: 'Explain', command: 'waymark.explain', arguments: [key, n.id] }));
        if (i > 0) out.push(new vscode.CodeLens(range, { title: '← prev', command: 'waymark.goto', arguments: [key, i - 1] }));
        if (i < m.nodes.length - 1) out.push(new vscode.CodeLens(range, { title: 'next →', command: 'waymark.goto', arguments: [key, i + 1] }));
      });
    }
    return out;
  }
}
const lenses = new Lenses();

// ------------------------------------------------------------------ navigation
async function revealNode(key, id, { preserveFocus = false, fromViewer = false } = {}) {
  const x = findMap(key);
  if (!x) return;
  const idx = x.m.nodes.findIndex((n) => n.id === id);
  if (idx < 0) return;
  const n = x.m.nodes[idx];
  setActive(key);
  state.lastIndex = idx;
  const uri = vscode.Uri.file(path.join(x.w.root, n.path));
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const column = state.panel ? vscode.ViewColumn.One : undefined;
    const ed = await vscode.window.showTextDocument(doc, { viewColumn: column, preserveFocus });
    const pos = new vscode.Position(n.line - 1, 0);
    ed.selection = new vscode.Selection(pos, pos);
    ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  } catch (e) {
    vscode.window.showWarningMessage(`Waymark: cannot open ${n.path} (${e.message})`);
  }
  if (!fromViewer) postToViewer(key, { type: 'select', id });
}
function gotoIndex(key, i) {
  const x = findMap(key);
  if (x && x.m.nodes[i]) return revealNode(key, x.m.nodes[i].id);
}
function stepNode(dir) {
  const a = activeMap();
  if (!a) return vscode.window.showInformationMessage('Waymark: no maps in this workspace.');
  const ed = vscode.window.activeTextEditor;
  let from = state.lastIndex;
  const info = ed && relOf(ed.document.uri);
  if (info) {
    const here = M.nodeAt(a.m, info.rel, ed.selection.active.line + 1);
    if (here >= 0) from = here;
  }
  const i = M.step(a.m, from, dir);
  if (i < 0) return vscode.window.setStatusBarMessage(`Waymark: ${dir > 0 ? 'last' : 'first'} node of the map`, 2500);
  return gotoIndex(a.key, i);
}

// ------------------------------------------------------------------ viewer webview (two-way sync)
function postToViewer(key, msg) {
  if (state.panel && state.panelKey === key) {
    if (msg.type === 'select') state.lastPosted = msg.id;
    state.panel.webview.postMessage(msg);
  }
}
function viewerHtml(x) {
  const file = path.join(x.w.root, '.waymark', `${x.m.id}.html`);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}
async function openViewer(key, id, { explain = false } = {}) {
  if (!key) {
    const pick = await pickMap();
    if (!pick) return;
    key = pick;
  }
  const x = findMap(key);
  if (!x) return;
  const html = viewerHtml(x);
  if (!html) return vscode.window.showWarningMessage(`Waymark: viewer not found for ${x.m.id}. Run "waymark render ${x.m.id}".`);
  setActive(key);
  if (!state.panel) {
    state.panel = vscode.window.createWebviewPanel('waymark.viewer', 'Waymark', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    state.panel.onDidDispose(() => {
      state.panel = null;
      state.panelKey = null;
    });
    state.panel.webview.onDidReceiveMessage((m) => {
      if (!m || !state.panelKey) return;
      if (m.type === 'select' && cfg().get('viewer.syncEditor', true)) revealNode(state.panelKey, m.id, { preserveFocus: true, fromViewer: true });
      if (m.type === 'open') revealNode(state.panelKey, m.id, { preserveFocus: false, fromViewer: true });
    });
  }
  if (state.panelKey !== key) {
    state.panelKey = key;
    state.panel.title = `Waymark · ${x.m.title}`;
    state.panel.webview.html = html;
  }
  state.panel.reveal(vscode.ViewColumn.Beside, true);
  if (id) setTimeout(() => postToViewer(key, explain ? { type: 'explain', id } : { type: 'select', id }), 350);
}

// Editor cursor on an anchored line → select that node in the viewer.
let selTimer = null;
function onSelection(e) {
  if (!state.panel || !state.panelKey) return;
  clearTimeout(selTimer);
  selTimer = setTimeout(() => {
    const x = findMap(state.panelKey);
    const info = relOf(e.textEditor.document.uri);
    if (!x || !info || info.w !== x.w) return;
    const i = M.nodeAt(x.m, info.rel, e.selections[0].active.line + 1);
    if (i >= 0 && x.m.nodes[i].id !== state.lastPosted) {
      state.lastIndex = i;
      postToViewer(state.panelKey, { type: 'select', id: x.m.nodes[i].id });
    }
  }, 150);
}

// ------------------------------------------------------------------ active map, status bar, pickers
let status = null;
function setActive(key) {
  if (state.activeKey === key) return;
  state.activeKey = key;
  updateStatus();
  tree.refresh();
  lenses.fire();
  refreshDecorations();
}
function updateStatus() {
  const a = activeMap();
  if (!a) return status.hide();
  status.text = `$(map) ${a.m.title.length > 40 ? a.m.title.slice(0, 37) + '…' : a.m.title}`;
  status.tooltip = 'Waymark: active map (click to change). Alt+] / Alt+[ walk its nodes.';
  status.show();
}
async function pickMap() {
  const items = allMaps().map((x) => ({ label: x.m.title, description: `${x.m.nodes.length} nodes`, detail: x.m.id, key: x.key }));
  if (!items.length) {
    vscode.window.showInformationMessage('Waymark: no maps in this workspace yet.');
    return null;
  }
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Choose a Waymark map' });
  return pick ? pick.key : null;
}

// ------------------------------------------------------------------ agent commands (Claude Code in the terminal)
function runAgent(prompt) {
  const cmd = cfg().get('agentCommand', 'claude');
  const t = vscode.window.createTerminal({ name: 'Waymark', cwd: state.workspaces[0]?.root || (vscode.workspace.workspaceFolders || [])[0]?.uri.fsPath });
  t.show();
  t.sendText(`${cmd} ${JSON.stringify(prompt)}`);
}
function mapArg(arg) {
  if (typeof arg === 'string') return findMap(arg);
  if (arg && arg.key) return findMap(arg.key);
  return activeMap();
}

// ------------------------------------------------------------------ lifecycle
function reload() {
  state.workspaces = (vscode.workspace.workspaceFolders || []).map((f) => M.loadWorkspace(f.uri.fsPath));
  if (state.activeKey && !findMap(state.activeKey)) state.activeKey = null;
  vscode.commands.executeCommand('setContext', 'waymark.hasMaps', allMaps().length > 0);
  tree.refresh();
  lenses.fire();
  refreshDecorations();
  updateStatus();
  if (state.panel && state.panelKey) {
    const x = findMap(state.panelKey);
    const html = x && viewerHtml(x);
    if (html && html !== state.panel.webview.html) state.panel.webview.html = html;
  }
}

function activate(context) {
  lineType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
  });
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'waymark.setActiveMap';
  context.subscriptions.push(lineType, status);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('waymark.maps', tree),
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, lenses),
    vscode.commands.registerCommand('waymark.refresh', reload),
    vscode.commands.registerCommand('waymark.revealNode', (key, id) => revealNode(key, id)),
    vscode.commands.registerCommand('waymark.goto', (key, i) => gotoIndex(key, i)),
    vscode.commands.registerCommand('waymark.next', () => stepNode(1)),
    vscode.commands.registerCommand('waymark.prev', () => stepNode(-1)),
    vscode.commands.registerCommand('waymark.openViewer', (key, id) => openViewer(typeof key === 'string' ? key : key?.key, id)),
    vscode.commands.registerCommand('waymark.explain', (key, id) => openViewer(key, id, { explain: true })),
    vscode.commands.registerCommand('waymark.setActiveMap', async (arg) => {
      const key = arg?.key || (typeof arg === 'string' ? arg : await pickMap());
      if (key) setActive(key);
    }),
    vscode.commands.registerCommand('waymark.explainAtCursor', () => {
      const ed = vscode.window.activeTextEditor;
      const info = ed && relOf(ed.document.uri);
      if (!info) return;
      const line = ed.selection.active.line + 1;
      const nodes = info.w.byFile.get(info.rel) || [];
      if (!nodes.length) return vscode.window.showInformationMessage('Waymark: no map covers this file.');
      const n = nodes.reduce((a, b) => (Math.abs(b.line - line) < Math.abs(a.line - line) ? b : a));
      openViewer(info.w.root + '::' + n.mapId, n.id, { explain: true });
    }),
    vscode.commands.registerCommand('waymark.createMap', async () => {
      const topic = await vscode.window.showInputBox({ prompt: 'What should the map explain?', placeHolder: 'e.g. how does checkout payment work?' });
      if (topic) runAgent(`/waymark ${topic}`);
    }),
    vscode.commands.registerCommand('waymark.enrichMap', (arg) => {
      const x = mapArg(arg);
      if (x) runAgent(`/waymark enrich ${x.m.id}`);
    }),
    vscode.commands.registerCommand('waymark.refreshNarrative', (arg) => {
      const x = mapArg(arg);
      if (x) runAgent(`/waymark refresh ${x.m.id}`);
    }),
    vscode.commands.registerCommand('waymark.verifyMaps', () => runAgent('/waymark verify')),
    vscode.window.onDidChangeVisibleTextEditors(refreshDecorations),
    vscode.window.onDidChangeTextEditorSelection(onSelection),
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (!ed || !cfg().get('history.enabled', true)) return;
      const info = relOf(ed.document.uri);
      if (info && !info.rel.startsWith('.waymark/')) {
        try {
          M.recordVisit(info.w.root, info.rel);
        } catch {
          /* history is best effort */
        }
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('waymark')) {
        lenses.fire();
        refreshDecorations();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(reload),
  );

  let timer = null;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(reload, 300);
  };
  const watcher = vscode.workspace.createFileSystemWatcher('**/.waymark/*.{json,html}');
  watcher.onDidChange(later);
  watcher.onDidCreate(later);
  watcher.onDidDelete(later);
  context.subscriptions.push(watcher);

  reload();
  // Lightweight introspection for tests / troubleshooting.
  return { state, reload, allMaps };
}

function deactivate() {
  for (const t of iconTypes.values()) t.dispose();
}

module.exports = { activate, deactivate };
