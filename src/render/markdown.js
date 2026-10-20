import { renderMermaid } from './mermaid.js';
import { checkState, execState } from '../state.js';

/** ASCII call tree, e.g. "├── [1a] handleLogin  auth/login.ts:42". */
export function renderTextTree(trace) {
  const byId = new Map(trace.locations.map((l) => [l.id, l]));
  const lines = [];
  const walk = (nodes, prefix) => {
    (nodes || []).forEach((n, i) => {
      const last = i === nodes.length - 1;
      const loc = n.ref ? byId.get(n.ref) : null;
      const text = loc
        ? `[${loc.id}] ${n.label || loc.title}  ${loc.path}:${loc.lineNumber}`
        : n.label || '(group)';
      lines.push(`${prefix}${last ? '└── ' : '├── '}${n.via ? `(${n.via}) ` : ''}${text}`);
      walk(n.children, prefix + (last ? '    ' : '│   '));
    });
  };
  walk(trace.tree, '');
  return lines.join('\n');
}

const STATUS_MARK = { ok: '', moved: '', relocated: '', fuzzy: ' (~approx)', unresolved: ' (!unverified)', missing: ' (!missing)' };

function header(doc, o) {
  const m = doc.meta || {};
  o.push(`# Waymark: ${doc.title}`, '', doc.description, '');
  o.push(
    `_id: \`${doc.id}\`${m.commit ? ` · commit ${m.commit.slice(0, 8)}` : ''}${m.branch ? ` (${m.branch})` : ''}` +
      `${m.updatedAt ? ` · updated ${m.updatedAt.slice(0, 10)}` : ''}${doc.query ? ` · query: "${doc.query}"` : ''}_`,
  );
}

function renderLoc(loc, o, full, stale) {
  o.push(
    `- **[${loc.id}] ${loc.title}** — \`${loc.path}:${loc.lineNumber}\`${loc.symbol ? ` (\`${loc.symbol}\`)` : ''}${STATUS_MARK[loc.status] || ''}` +
      `${stale ? ' (⚠ code changed since this was explained)' : ''}`,
  );
  o.push(`  ${loc.description}`);
  const flags = [];
  const cs = checkState(loc);
  if (cs === 'supported') flags.push('✓ fact-checked');
  else if (cs === 'partial') flags.push(`◑ partially verified: ${(loc.check.issues || []).join('; ')}`);
  else if (cs === 'unsupported') flags.push(`✗ fact-check failed: ${(loc.check.issues || []).join('; ')}`);
  const es = execState(loc);
  if (es === 'hit') flags.push(`▶ executed by the tests (${loc.exec.count}×)`);
  else if (es === 'miss') flags.push('○ not executed by the tests');
  if (loc.mapRef) flags.push(`→ detailed map: waymark://${loc.mapRef.replace('#', '/')}`);
  if (flags.length) o.push(`  _${flags.join(' · ')}_`);
  if (full && loc.explanation) o.push(`  ${loc.explanation.replace(/\n/g, '\n  ')}`);
  for (const n of loc.notes || []) o.push(`  > 📝 Team note (${n.author}, ${String(n.at).slice(0, 10)}): ${n.text}`);
  if (full && loc.snippet?.code) {
    const numbered = loc.snippet.code
      .split('\n')
      .map((l, i) => {
        const n = loc.snippet.startLine + i;
        return `${n === loc.lineNumber ? '>' : ' '}${String(n).padStart(5)}  ${l}`;
      })
      .join('\n');
    o.push('  ```', numbered.replace(/^/gm, '  '), '  ```');
  } else if (loc.lineContent) {
    o.push(`  \`${loc.lineContent}\``);
  }
}

function renderTrace(trace, o, full, staleNodes) {
  o.push('', `## Trace ${trace.id}: ${trace.title}`, '', trace.description);
  if (full && trace.motivation) o.push('', '### Motivation', '', trace.motivation);
  if (full && (trace.details || trace.guide)) o.push('', '### Details', '', trace.details || trace.guide);
  o.push('', `### ${trace.diagramTitle || 'Tree'}`, '', '```text', renderTextTree(trace), '```', '');
  for (const loc of trace.locations) renderLoc(loc, o, full, staleNodes.has(loc.id));
}

/** Parent and children of a location inside its trace tree (first occurrence). */
function neighbours(trace, id) {
  let found = null;
  const walk = (nodes, parent) => {
    for (const n of nodes || []) {
      if (found) return;
      if (n.ref === id) {
        found = { parent, children: n.children || [] };
        return;
      }
      walk(n.children, n);
    }
  };
  walk(trace.tree, null);
  return found || { parent: null, children: [] };
}

/**
 * Context-oriented rendering for agents (what an @-mention injects).
 * detail: "full" includes the narrative (story, guides, explanations) and snippets;
 * "compact" keeps only structure, one-line descriptions and anchors.
 * trace / node: render only that trace, or one node with its trace context.
 */
export function renderMarkdown(doc, { detail = 'full', diagram = false, trace: traceId = null, node: nodeId = null } = {}) {
  const o = [];
  const full = detail === 'full';
  const staleNodes = new Set(doc.meta?.narrativeDrift?.nodes || []);
  header(doc, o);

  if (nodeId) {
    const trace = doc.traces.find((t) => t.locations.some((l) => l.id === nodeId));
    if (!trace) throw new Error(`Node "${nodeId}" not found in ${doc.id}`);
    const loc = trace.locations.find((l) => l.id === nodeId);
    const byId = new Map(trace.locations.map((l) => [l.id, l]));
    const label = (n) => (n.ref && byId.get(n.ref) ? `[${n.ref}] ${byId.get(n.ref).title}` : n.label || '(group)');
    o.push('', `## Trace ${trace.id}: ${trace.title}`, '', trace.description);
    if (full && trace.motivation) o.push('', '### Motivation', '', trace.motivation);
    o.push('', `## Node [${loc.id}]`, '');
    renderLoc(loc, o, true, staleNodes.has(loc.id));
    const nb = neighbours(trace, nodeId);
    if (nb.parent) o.push('', `Called from / part of: ${label(nb.parent)}`);
    if (nb.children.length) o.push(`Next steps: ${nb.children.map((c) => `${c.via ? `(${c.via}) ` : ''}${label(c)}`).join('; ')}`);
    const links = (doc.links || []).filter((l) => l.from === nodeId || l.to === nodeId);
    for (const l of links) o.push(`Link: [${l.from}] → [${l.to}]${l.label ? ` (${l.label})` : ''}`);
    return o.join('\n');
  }

  if (traceId) {
    const trace = doc.traces.find((t) => t.id === String(traceId));
    if (!trace) throw new Error(`Trace "${traceId}" not found in ${doc.id}`);
    renderTrace(trace, o, full, staleNodes);
    const ids = new Set(trace.locations.map((l) => l.id));
    const links = (doc.links || []).filter((l) => ids.has(l.from) || ids.has(l.to));
    if (links.length) {
      o.push('', '## Links to other traces', '');
      for (const l of links) o.push(`- [${l.from}] → [${l.to}]${l.label ? `: ${l.label}` : ''}`);
    }
    return o.join('\n');
  }

  if (full && doc.story) o.push('', '## The story', '', doc.story);
  for (const trace of doc.traces) renderTrace(trace, o, full, staleNodes);
  if (doc.links?.length) {
    o.push('', '## Cross-trace links', '');
    for (const l of doc.links) o.push(`- [${l.from}] → [${l.to}]${l.label ? `: ${l.label}` : ''}`);
  }
  if (diagram) o.push('', '## Diagram', '', '```mermaid', renderMermaid(doc), '```');
  return o.join('\n');
}
