import { renderMermaid } from './mermaid.js';

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
      lines.push(`${prefix}${last ? '└── ' : '├── '}${text}`);
      walk(n.children, prefix + (last ? '    ' : '│   '));
    });
  };
  walk(trace.tree, '');
  return lines.join('\n');
}

const STATUS_MARK = { ok: '', moved: '', relocated: '', fuzzy: ' (~approx)', unresolved: ' (!unverified)', missing: ' (!missing)' };

/**
 * Context-oriented rendering for agents (what an @-mention injects).
 * detail: "full" includes snippets; "compact" keeps only structure + anchors.
 */
export function renderMarkdown(doc, { detail = 'full', diagram = false } = {}) {
  const o = [];
  o.push(`# Waymark: ${doc.title}`);
  o.push('');
  o.push(doc.description);
  const m = doc.meta || {};
  o.push('');
  o.push(
    `_id: \`${doc.id}\`${m.commit ? ` · commit ${m.commit.slice(0, 8)}` : ''}${m.branch ? ` (${m.branch})` : ''}` +
      `${m.updatedAt ? ` · updated ${m.updatedAt.slice(0, 10)}` : ''}${doc.query ? ` · query: "${doc.query}"` : ''}_`,
  );

  for (const trace of doc.traces) {
    o.push('', `## Trace ${trace.id}: ${trace.title}`, '', trace.description, '', '```text', renderTextTree(trace), '```', '');
    for (const loc of trace.locations) {
      o.push(
        `- **[${loc.id}] ${loc.title}** — \`${loc.path}:${loc.lineNumber}\`${loc.symbol ? ` (\`${loc.symbol}\`)` : ''}${STATUS_MARK[loc.status] || ''}`,
      );
      o.push(`  ${loc.description}`);
      if (detail === 'full' && loc.snippet?.code) {
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
    if (trace.guide) o.push('', `### Guide`, '', trace.guide);
  }
  if (doc.links?.length) {
    o.push('', '## Cross-trace links', '');
    for (const l of doc.links) o.push(`- [${l.from}] → [${l.to}]${l.label ? `: ${l.label}` : ''}`);
  }
  if (diagram) o.push('', '## Diagram', '', '```mermaid', renderMermaid(doc), '```');
  return o.join('\n');
}
