import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listMaps, loadMap, recordExec } from './store.js';
import { relPath } from './context.js';
import { resolveCommand, argsFor } from './bin.js';

/*
 * "Verified by execution": which map nodes actually ran.
 *  - V8 (Node/Deno/Bun-free): run any command with NODE_V8_COVERAGE set — child processes are
 *    covered too — and map V8 byte ranges to lines.
 *  - LCOV: any language/tool that emits lcov.info (Jest, c8, coverage.py, JaCoCo via converters…).
 * Result per file: Map(line → hit count) for the lines the tool instrumented.
 */

/** Parses lcov.info → Map(relPath → Map(line → count)). */
export function parseLcov(text, root) {
  const out = new Map();
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      const file = line.slice(3);
      const rel = relPath(root, path.isAbsolute(file) ? file : path.resolve(root, file));
      cur = rel ? (out.get(rel) || out.set(rel, new Map()).get(rel)) : null;
    } else if (line.startsWith('DA:') && cur) {
      const [ln, count] = line.slice(3).split(',');
      cur.set(Number(ln), (cur.get(Number(ln)) || 0) + Number(count));
    } else if (line === 'end_of_record') {
      cur = null;
    }
  }
  return out;
}

/** Reads a NODE_V8_COVERAGE directory → Map(relPath → Map(line → count)). Block-level ranges. */
export function parseV8Dir(dir, root) {
  const out = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let json;
    try {
      json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    for (const script of json.result || []) {
      if (!script.url || !script.url.startsWith('file:')) continue;
      let abs;
      try {
        abs = fileURLToPath(script.url);
      } catch {
        continue;
      }
      if (abs.includes(`${path.sep}node_modules${path.sep}`)) continue;
      const rel = relPath(root, abs);
      if (!rel) continue;
      let src;
      try {
        src = fs.readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      // One probe offset per line: its LAST non-blank character. For "export function f() {" that is
      // the "{", inside f's own range (the first character, "export", belongs to the module range).
      const starts = [];
      let off = 0;
      for (const l of src.split('\n')) {
        const body = l.replace(/\s+$/, '');
        starts.push(body.trim() ? off + body.length - 1 : -1);
        off += l.length + 1;
      }
      const lines = out.get(rel) || out.set(rel, new Map()).get(rel);
      // Outer ranges first so inner (more specific) ranges override their counts.
      const ranges = (script.functions || []).flatMap((fn) => fn.ranges || []);
      ranges.sort((a, b) => b.endOffset - b.startOffset - (a.endOffset - a.startOffset));
      const perScript = new Map();
      for (const r of ranges) {
        for (let i = 0; i < starts.length; i++) {
          const s = starts[i];
          if (s >= r.startOffset && s < r.endOffset) perScript.set(i + 1, r.count);
        }
      }
      // Several processes may load the same file: sum their counts.
      for (const [ln, c] of perScript) lines.set(ln, (lines.get(ln) || 0) + c);
    }
  }
  return out;
}

/** Runs a command with V8 coverage enabled (children included) and returns the parsed coverage. */
export function runWithV8Coverage(root, command, args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-v8-'));
  // Absolute executables run directly; names like "npm" go through resolveCommand (Windows shims).
  const bin = fs.existsSync(command) ? { command, args: [] } : resolveCommand(command) || { command, args: [], shell: process.platform === 'win32' };
  const res = spawnSync(bin.command, argsFor(bin, args), {
    cwd: root,
    stdio: 'inherit',
    shell: !!bin.shell,
    env: { ...process.env, NODE_V8_COVERAGE: dir },
  });
  try {
    return { status: res.status, coverage: parseV8Dir(dir, root) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Node-level verdicts for one map: hit if the anchor line ran; miss if instrumented but 0. */
export function execResults(doc, coverage) {
  const results = {};
  for (const t of doc.traces) {
    for (const l of t.locations) {
      const lines = coverage.get(l.path);
      if (!lines) continue;
      // Declarations (e.g. "export function f() {") may not be a counted statement themselves;
      // fall back to the first instrumented line of the node's next few lines.
      let count = lines.get(l.lineNumber);
      for (let k = 1; count == null && k <= 3; k++) count = lines.get(l.lineNumber + k);
      if (count == null) continue;
      results[l.id] = { hit: count > 0, count };
    }
  }
  return results;
}

/** Applies coverage to the given maps (or all) and persists node exec state. */
export function applyCoverage(root, coverage, { ids = null, source = 'coverage', command = '' } = {}) {
  const targets = ids && ids.length ? ids.map((i) => loadMap(root, i).id) : listMaps(root).map((m) => m.id);
  return targets.map((id) => recordExec(root, id, execResults(loadMap(root, id), coverage), { source, command }));
}
