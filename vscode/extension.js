'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const M = require('./lib/model');
const { pathToFileURL } = require('url');

let libPromise = null;
/** Loads the Waymark library (notes, HTML regeneration…) lazily. */
function waymarkLib() {
  if (!libPromise) {
    const candidates = [path.join(__dirname, 'dist', 'lib.mjs'), path.join(__dirname, '..', 'src', 'lib.js')];
    const file = candidates.find((f) => fs.existsSync(f));
    libPromise = file ? import(pathToFileURL(file).href) : Promise.reject(new Error('Waymark library not found in the extension'));
  }
  return libPromise;
}

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
      const verified = el.m.nodes.filter((n) => n.check === 'supported').length;
      const ran = el.m.nodes.filter((n) => n.exec === 'hit').length;
      it.description = [
        el.m.kind === 'overview' ? 'overview' : null,
        `${el.m.nodes.length} nodes`,
        verified ? `✓${verified}` : null,
        ran ? `▶${ran}` : null,
        stale ? `◔${stale}` : null,
        el.key === activeMap()?.key ? 'active' : null,
      ].filter(Boolean).join(' · ');
      it.tooltip = new vscode.MarkdownString(`**${el.m.title}**\n\n${el.m.description || ''}\n\n\`${el.m.id}\``);
      it.iconPath = new vscode.ThemeIcon(el.m.kind === 'overview' ? 'globe' : el.key === activeMap()?.key ? 'map-filled' : 'map');
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
    it.iconPath = new vscode.ThemeIcon(
      n.stale ? 'warning'
        : n.status === 'unresolved' || n.status === 'missing' || n.check === 'unsupported' ? 'error'
        : n.mapRef ? 'link-external'
        : n.check === 'supported' ? 'pass'
        : 'debug-breakpoint-log',
    );
    if (n.notes.length) it.description += `  ✎${n.notes.length}`;
    it.command = { command: 'waymark.revealNode', title: 'Reveal', arguments: [el.key, n.id] };
    it.contextValue = n.mapRef ? 'waymarkNodeLinked' : 'waymarkNode';
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
  const links = [cmdLink('Open in Waymark', 'waymark.openViewer', [key, n.id]), cmdLink('Explain', 'waymark.explain', [key, n.id]), cmdLink('Add note', 'waymark.addNote', [key, n.id])];
  if (n.mapRef) links.push(cmdLink('Open detailed map', 'waymark.openMapRef', [key, n.mapRef]));
  md.appendMarkdown('\n\n' + links.join(' · '));
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
        if (n.mapRef) out.push(new vscode.CodeLens(range, { title: '↗ map', command: 'waymark.openMapRef', arguments: [key, n.mapRef] }));
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
      if (m.type === 'addNote') addNote(state.panelKey, m.id);
      if (m.type === 'openMap') openMapRef(state.panelKey, m.ref);
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

// ------------------------------------------------------------------ human notes and links between maps
async function addNote(key, id) {
  const x = findMap(key);
  if (!x) return;
  const n = x.m.nodes.find((y) => y.id === id);
  const text = await vscode.window.showInputBox({ prompt: `Team note for [${id}] ${n ? n.title : ''} (not AI-generated, kept across map updates)`, placeHolder: 'Gotcha, decision, link…' });
  if (!text) return;
  try {
    const lib = await waymarkLib();
    lib.noteMap(x.w.root, x.m.id, id, { text });
    vscode.window.setStatusBarMessage(`Waymark: note added to [${id}]`, 3000);
    reload(); // watcher would also catch it; reload now so the viewer updates immediately
  } catch (e) {
    vscode.window.showErrorMessage(`Waymark: could not save the note (${e.message})`);
  }
}

function openMapRef(fromKey, ref) {
  const from = findMap(fromKey);
  if (!from || !ref) return;
  const [id, node] = String(ref).split('#');
  const target = keyOf(from.w, { id });
  if (!findMap(target)) return vscode.window.showWarningMessage(`Waymark: map "${id}" not found.`);
  state.panelKey = null; // force loading the other map in the panel
  openViewer(target, node);
}

// ------------------------------------------------------------------ self-update from GitHub Releases
const RELEASES_API = 'https://api.github.com/repos/h0w4r/waymark/releases/latest';
const DAY = 24 * 60 * 60 * 1000;

async function checkForUpdates(context, { manual = false } = {}) {
  if (!manual) {
    if (!cfg().get('updates.check', true)) return;
    const last = context.globalState.get('waymark.lastUpdateCheck', 0);
    if (Date.now() - last < DAY) return;
  }
  await context.globalState.update('waymark.lastUpdateCheck', Date.now());
  const current = context.extension?.packageJSON?.version || '0.0.0';
  let info = null;
  try {
    const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'waymark-vscode' } });
    if (res.ok) info = M.releaseInfo(await res.json());
  } catch (e) {
    if (manual) vscode.window.showWarningMessage(`Waymark: could not check for updates (${e.message}).`);
    return;
  }
  if (!info || !M.isNewer(info.version, current)) {
    if (manual) vscode.window.showInformationMessage(`Waymark ${current} is up to date.`);
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    `Waymark ${info.version} is available (installed: ${current}).`,
    'Install',
    'Release notes',
    'Later',
  );
  if (choice === 'Release notes') return vscode.env.openExternal(vscode.Uri.parse(info.notes));
  if (choice !== 'Install') return;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Installing Waymark ${info.version}…` }, async () => {
    const res = await fetch(info.url, { headers: { 'User-Agent': 'waymark-vscode' } });
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const file = path.join(require('os').tmpdir(), info.name);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(file));
  });
  const reload = await vscode.window.showInformationMessage(`Waymark ${info.version} installed. Reload the window to use it.`, 'Reload');
  if (reload === 'Reload') vscode.commands.executeCommand('workbench.action.reloadWindow');
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
    vscode.commands.registerCommand('waymark.addNote', async (key, id) => {
      if (key && id) return addNote(key, id);
      const ed = vscode.window.activeTextEditor;
      const info = ed && relOf(ed.document.uri);
      const nodes = info ? info.w.byFile.get(info.rel) || [] : [];
      if (!nodes.length) return vscode.window.showInformationMessage('Waymark: no map node in this file.');
      const line = ed.selection.active.line + 1;
      const n = nodes.reduce((a, b) => (Math.abs(b.line - line) < Math.abs(a.line - line) ? b : a));
      return addNote(info.w.root + '::' + n.mapId, n.id);
    }),
    vscode.commands.registerCommand('waymark.openMapRef', (key, ref) => openMapRef(key, ref)),
    vscode.commands.registerCommand('waymark.checkMap', (arg) => {
      const x = mapArg(arg);
      if (x) runAgent(`/waymark check ${x.m.id}`);
    }),
    vscode.commands.registerCommand('waymark.checkForUpdates', () =>
      checkForUpdates(context, { manual: true }).catch((e) => vscode.window.showErrorMessage(`Waymark update failed: ${e.message}`)),
    ),
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
  // Daily, silent unless an update exists; never blocks activation.
  const upd = setTimeout(() => checkForUpdates(context).catch(() => {}), 5000);
  if (upd.unref) upd.unref();
  // Lightweight introspection for tests / troubleshooting.
  return { state, reload, allMaps };
}

function deactivate() {
  for (const t of iconTypes.values()) t.dispose();
}

module.exports = { activate, deactivate };
