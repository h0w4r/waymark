import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveRoot } from './git.js';
import { mapDir } from './store.js';
import { mapsForFile, renderFileContext } from './context.js';
import { verifyMap } from './verify.js';

/*
 * Claude Code hooks (settings.json → command: `waymark hook <kind>`):
 *   pre-edit  (PreToolUse  Edit|Write|MultiEdit|NotebookEdit): inject the traces covering the file
 *   post-read (PostToolUse Read): same, so the agent knows the flow before planning a change
 *   post-edit (PostToolUse Edit|Write|MultiEdit|NotebookEdit): re-anchor maps, report narrative drift
 * Context is injected once per session per trace; hooks never block and never fail loudly.
 */

const EVENTS = { 'pre-edit': 'PreToolUse', 'post-read': 'PostToolUse', 'post-edit': 'PostToolUse' };

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function stateFile(sessionId) {
  const dir = path.join(os.tmpdir(), 'waymark-hooks');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${String(sessionId || 'nosession').replace(/[^\w-]/g, '_')}.json`);
}
function loadState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(sessionId), 'utf8'));
  } catch {
    return { seen: {}, drift: {} };
  }
}
function saveState(sessionId, st) {
  try {
    fs.writeFileSync(stateFile(sessionId), JSON.stringify(st));
  } catch {
    /* best effort */
  }
}

function emit(kind, text) {
  if (!text) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: EVENTS[kind], additionalContext: text } }));
}

export function hookOutput(kind, input) {
  const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
  if (!file) return '';
  const abs = path.isAbsolute(file) ? file : path.resolve(input.cwd || process.cwd(), file);
  const root = resolveRoot(path.dirname(abs));
  if (!fs.existsSync(mapDir(root))) return '';
  const res = mapsForFile(root, abs);
  if (!res.maps.length) return '';
  const st = loadState(input.session_id);

  if (kind === 'post-edit') {
    const notes = [];
    for (const m of res.maps) {
      const v = verifyMap(root, m.id, { fix: true });
      const moved = v.changes.filter((c) => c.status !== 'unresolved' && c.status !== 'missing');
      const broken = v.changes.filter((c) => c.status === 'unresolved' || c.status === 'missing');
      const key = m.id;
      const driftNow = v.narrative.nodes.join(',');
      const lines = [];
      if (moved.length) lines.push(`anchors re-synced: ${moved.map((c) => `[${c.id}] ${c.from} → ${c.to}`).join('; ')}`);
      if (broken.length) lines.push(`anchors no longer found: ${broken.map((c) => `[${c.id}] ${c.from}`).join(', ')} (the map needs updating with waymark_create)`);
      if (v.narrative.nodes.length && st.drift[key] !== driftNow) {
        lines.push(
          `the code around ${v.narrative.nodes.map((n) => `[${n}]`).join(', ')} changed after those nodes were explained, so their description/explanation may be outdated; waymark_refresh(id: "${m.id}") lists what to review`,
        );
        st.drift[key] = driftNow;
      }
      if (lines.length) notes.push(`Waymark map \`${m.id}\` (${m.title}): ${lines.join('. ')}.`);
    }
    saveState(input.session_id, st);
    return notes.join('\n');
  }

  // pre-edit / post-read: provide the flow context once per (map, trace) per session.
  const fresh = [];
  for (const m of res.maps) {
    const unseen = m.traces.filter((t) => !st.seen[`${m.id}:${t}`]);
    if (unseen.length) fresh.push({ ...m, traces: unseen, nodes: m.nodes.filter((n) => unseen.includes(n.trace)) });
    for (const t of unseen) st.seen[`${m.id}:${t}`] = true;
  }
  saveState(input.session_id, st);
  if (fresh.length) {
    const intro =
      kind === 'pre-edit'
        ? 'This file is part of documented execution flows (Waymark maps). Keep them in mind while editing; the maps are re-anchored automatically after the edit.'
        : 'This file is part of documented execution flows (Waymark maps).';
    return `${intro}\n\n${renderFileContext({ path: res.path, maps: fresh }, { maxChars: 3500 })}`;
  }
  if (kind === 'pre-edit') {
    const ids = res.maps.map((m) => `\`${m.id}\` (${m.nodes.map((n) => `[${n.id}]`).join(', ')})`).join('; ');
    return `This file is covered by Waymark map(s) ${ids}; their context was provided earlier in this session.`;
  }
  return '';
}

export function runHook(kind) {
  if (!EVENTS[kind]) {
    process.stderr.write(`unknown hook kind "${kind}" (use pre-edit | post-edit | post-read)\n`);
    return;
  }
  try {
    emit(kind, hookOutput(kind, readStdin()));
  } catch {
    /* never break the user's tool call */
  }
}
