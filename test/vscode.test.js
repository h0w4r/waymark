// Smoke test of the VS Code extension against a stub of the `vscode` API: activation, tree,
// gutter decorations, CodeLens, node navigation and the viewer webview two-way sync.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { saveMap } from '../src/store.js';

const require = createRequire(import.meta.url);
let repo;
const log = { decorations: [], posted: [], shown: [], commands: new Map(), providers: {}, panels: [] };

class EventEmitter {
  constructor() { this.listeners = []; this.event = (fn) => { this.listeners.push(fn); return { dispose() {} }; }; }
  fire(v) { for (const l of this.listeners) l(v); }
}
const noopEvent = () => ({ dispose() {} });
class Range { constructor(a, b, c, d) { this.start = { line: a, character: b }; this.end = { line: c, character: d }; } }
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Selection { constructor(a, b) { this.anchor = a; this.active = b; } }

function makeEditor(file, line = 0) {
  return {
    document: { uri: { scheme: 'file', fsPath: file } },
    selection: new Selection(new Position(line, 0), new Position(line, 0)),
    setDecorations(type, ranges) { log.decorations.push({ type, ranges, file }); },
    revealRange() {},
  };
}

const vscodeStub = {
  EventEmitter,
  Range,
  Position,
  Selection,
  TreeItem: class { constructor(label, state) { this.label = label; this.collapsibleState = state; } },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(id) { this.id = id; } },
  ThemeColor: class { constructor(id) { this.id = id; } },
  MarkdownString: class { constructor(v = '') { this.value = v; } appendMarkdown(s) { this.value += s; return this; } },
  CodeLens: class { constructor(range, command) { this.range = range; this.command = command; } },
  Uri: { file: (p) => ({ scheme: 'file', fsPath: p }), parse: (s) => ({ scheme: 'data', toString: () => s }) },
  ViewColumn: { One: 1, Beside: -2 },
  OverviewRulerLane: { Right: 4 },
  StatusBarAlignment: { Left: 1 },
  TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
  window: {
    visibleTextEditors: [],
    activeTextEditor: null,
    createTextEditorDecorationType: (o) => ({ o, dispose() {} }),
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
    registerTreeDataProvider: (id, p) => { log.providers.tree = p; return { dispose() {} }; },
    showInformationMessage: () => {},
    showWarningMessage: (m) => { throw new Error('unexpected warning: ' + m); },
    setStatusBarMessage: () => {},
    showQuickPick: async (items) => items[0],
    showInputBox: async () => null,
    async showTextDocument(doc, opts) {
      const ed = makeEditor(doc.uri.fsPath);
      log.shown.push({ file: doc.uri.fsPath, opts });
      vscodeStub.window.activeTextEditor = ed;
      return ed;
    },
    createWebviewPanel() {
      const emitter = new EventEmitter();
      const panel = {
        title: '',
        webview: { html: '', postMessage: (m) => log.posted.push(m), onDidReceiveMessage: emitter.event, _emit: (m) => emitter.fire(m) },
        reveal() {},
        onDidDispose: noopEvent,
      };
      log.panels.push(panel);
      return panel;
    },
    createTerminal: () => ({ show() {}, sendText(t) { log.terminal = t; } }),
    onDidChangeVisibleTextEditors: noopEvent,
    onDidChangeTextEditorSelection: (fn) => { log.onSelection = fn; return { dispose() {} }; },
    onDidChangeActiveTextEditor: (fn) => { log.onActive = fn; return { dispose() {} }; },
  },
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({ get: (k, d) => d }),
    createFileSystemWatcher: () => ({ onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {} }),
    onDidChangeConfiguration: noopEvent,
    onDidChangeWorkspaceFolders: noopEvent,
    openTextDocument: async (uri) => ({ uri }),
  },
  languages: { registerCodeLensProvider: (sel, p) => { log.providers.lens = p; return { dispose() {} }; } },
  commands: {
    registerCommand: (id, fn) => { log.commands.set(id, fn); return { dispose() {} }; },
    executeCommand: async () => {},
  },
};

let ext;
before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-vscode-'));
  fs.writeFileSync(path.join(repo, 'a.js'), 'export function a() {\n  return b();\n}\nexport function b() {\n  return 1;\n}\n');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  saveMap(repo, {
    title: 'A calls B',
    description: 'a [1a] calls b [1b].',
    traces: [{
      title: 'Call', description: 'a to b.',
      locations: [
        { title: 'a', description: 'Entry.', explanation: 'Starts here.', path: 'a.js', lineNumber: 1, lineContent: 'export function a() {' },
        { title: 'b', description: 'Returns one.', explanation: 'Ends here.', path: 'a.js', lineNumber: 4, lineContent: 'export function b() {' },
      ],
    }],
  }, { id: 'ab' });
  vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: repo } }];
  vscodeStub.window.visibleTextEditors = [makeEditor(path.join(repo, 'a.js'))];
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'vscode') return vscodeStub;
    return origLoad.call(this, request, ...rest);
  };
  ext = require('../vscode/extension.js');
});

after(() => fs.rmSync(repo, { recursive: true, force: true }));

test('activates, builds the tree and decorates anchored lines', () => {
  const api = ext.activate({ subscriptions: [] });
  assert.equal(api.allMaps().length, 1);
  const roots = log.providers.tree.getChildren();
  assert.equal(roots.length, 1);
  assert.equal(log.providers.tree.getTreeItem(roots[0]).label, 'A calls B');
  const traces = log.providers.tree.getChildren(roots[0]);
  const nodes = log.providers.tree.getChildren(traces[0]);
  const item = log.providers.tree.getTreeItem(nodes[1]);
  assert.equal(item.command.command, 'waymark.revealNode');
  const gutter = log.decorations.filter((d) => d.ranges.length && d.type.o.gutterIconPath);
  assert.equal(gutter.reduce((n, d) => n + d.ranges.length, 0), 2);
  const hover = log.decorations.find((d) => d.ranges.length && d.ranges[0].hoverMessage);
  assert.match(hover.ranges[0].hoverMessage.value, /command:waymark\.explain/);
});

test('CodeLens shows id · description, Explain and prev/next', () => {
  const lenses = log.providers.lens.provideCodeLenses({ uri: { scheme: 'file', fsPath: path.join(repo, 'a.js') } });
  const titles = lenses.map((l) => l.command.title);
  assert.ok(titles.includes('1a · Entry.'));
  assert.ok(titles.includes('Explain'));
  assert.ok(titles.includes('next →'));
  assert.ok(titles.includes('← prev'));
});

test('Alt+] walks nodes; viewer syncs both ways', async () => {
  vscodeStub.window.activeTextEditor = makeEditor(path.join(repo, 'a.js'), 0); // cursor on 1a
  await log.commands.get('waymark.next')();
  assert.equal(log.shown.at(-1).file, path.join(repo, 'a.js'));
  const key = repo + '::ab';
  await log.commands.get('waymark.openViewer')(key, '1b');
  const panel = log.panels[0];
  assert.match(panel.webview.html, /waymark-data/);
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(log.posted.at(-1), { type: 'select', id: '1b' });
  // viewer → editor
  const before = log.shown.length;
  panel.webview._emit({ type: 'select', id: '1a' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(log.shown.length, before + 1);
  assert.equal(log.shown.at(-1).opts.preserveFocus, true);
  // editor cursor → viewer
  log.onSelection({ textEditor: makeEditor(path.join(repo, 'a.js')), selections: [new Selection(new Position(3, 0), new Position(3, 0))] });
  await new Promise((r) => setTimeout(r, 250));
  assert.deepEqual(log.posted.at(-1), { type: 'select', id: '1b' });
  // explain from CodeLens
  await log.commands.get('waymark.explain')(key, '1a');
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(log.posted.at(-1), { type: 'explain', id: '1a' });
});

test('records navigation history for suggestions', () => {
  log.onActive(makeEditor(path.join(repo, 'a.js')));
  const h = JSON.parse(fs.readFileSync(path.join(repo, '.waymark', '.local', 'history.json'), 'utf8'));
  assert.equal(h.files['a.js'].visits, 1);
});
