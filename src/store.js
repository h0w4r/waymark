import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeMap } from './schema.js';
import { anchorMap } from './anchor.js';
import { headCommit, currentBranch, remoteWebUrl } from './git.js';
import { renderHtml } from './render/html.js';

export const SCHEMA_VERSION = 1;

export function mapDir(root) {
  return path.join(root, process.env.WAYMARK_DIR || '.waymark');
}

const slugify = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'waymark';

const validId = (id) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(id);

function filePath(root, id, ext = 'json') {
  if (!validId(id)) throw new Error(`Invalid waymark id "${id}"`);
  return path.join(mapDir(root), `${id}.${ext}`);
}

/** Validates, anchors against the working tree, persists JSON (+ HTML viewer). */
export function saveMap(root, input, { id, html = true } = {}) {
  const map = normalizeMap(input);
  const report = anchorMap(root, map);
  const existing = id ? loadMap(root, id, { quiet: true }) : null;
  const now = new Date().toISOString();
  const doc = {
    schemaVersion: SCHEMA_VERSION,
    id: id || `${slugify(map.title)}-${crypto.randomBytes(3).toString('hex')}`,
    ...map,
    meta: {
      createdAt: existing?.meta?.createdAt || now,
      updatedAt: now,
      root,
      commit: headCommit(root),
      branch: currentBranch(root),
      remote: remoteWebUrl(root),
      anchors: { ...report, issues: undefined },
    },
  };
  fs.mkdirSync(mapDir(root), { recursive: true });
  fs.writeFileSync(filePath(root, doc.id), JSON.stringify(doc, null, 2));
  const htmlPath = html ? writeHtml(root, doc) : null;
  return { doc, report, jsonPath: filePath(root, doc.id), htmlPath };
}

export function writeHtml(root, doc) {
  const p = filePath(root, doc.id, 'html');
  fs.writeFileSync(p, renderHtml(doc));
  return p;
}

export function persist(root, doc) {
  fs.writeFileSync(filePath(root, doc.id), JSON.stringify(doc, null, 2));
}

export function loadMap(root, id, { quiet = false } = {}) {
  let p;
  try {
    p = filePath(root, id);
  } catch (e) {
    if (quiet) return null;
    throw e;
  }
  if (!fs.existsSync(p)) {
    // Allow unique prefix lookups ("auth-flow" -> "auth-flow-1a2b3c").
    const hit = listMaps(root).filter((m) => m.id.startsWith(id));
    if (hit.length === 1) return loadMap(root, hit[0].id);
    if (quiet) return null;
    throw new Error(
      hit.length > 1 ? `Ambiguous waymark id "${id}": ${hit.map((h) => h.id).join(', ')}` : `Waymark "${id}" not found`,
    );
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function listMaps(root) {
  const dir = mapDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        return {
          id: d.id,
          title: d.title,
          description: d.description,
          query: d.query,
          traces: d.traces.length,
          locations: d.traces.reduce((n, t) => n + t.locations.length, 0),
          updatedAt: d.meta?.updatedAt,
          commit: d.meta?.commit?.slice(0, 8),
          tags: d.tags,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function deleteMap(root, id) {
  const doc = loadMap(root, id);
  for (const ext of ['json', 'html']) {
    const p = filePath(root, doc.id, ext);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  return doc.id;
}
