#!/usr/bin/env node
import * as z from 'zod';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MapInput } from './schema.js';
import { fileURLToPath } from 'node:url';
import { resolveRoot } from './git.js';
import { saveMap, loadMap, listMaps, writeHtml, deleteMap, annotateMap, narrativeGaps } from './store.js';
import { lintMap } from './lint.js';
import { mapsForFile, renderFileContext, forFileSummary } from './context.js';
import { verifyMap } from './verify.js';
import { findInFile } from './anchor.js';
import { suggestTopics } from './suggest.js';
import { waymarkGuide, enrichGuide, refreshGuide } from './guide.js';
import { renderMarkdown } from './render/markdown.js';
import { renderMermaid } from './render/mermaid.js';
import { openFile } from './open.js';

const VERSION = '0.1.0';
const rootArg = z.string().optional().describe('Repository root. Defaults to the server working directory / WAYMARK_ROOT');

const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: String(e?.message || e) }] });
const safe = (fn) => async (args) => {
  try {
    return await fn(args);
  } catch (e) {
    return fail(e);
  }
};

// Workspace announced by the client (MCP roots). Lets a globally installed server
// (e.g. ~/.codex/config.toml used by Codex desktop) target the open project.
let clientRoot = null;
const rootOf = (root) => resolveRoot(root || process.env.WAYMARK_ROOT || clientRoot || undefined);

export function createServer() {
  const server = new McpServer(
    { name: 'waymark', version: VERSION },
    {
      instructions:
        'Waymark: hierarchical, line-anchored maps of how code executes. To create one, call waymark_start(query) and follow the returned procedure, then waymark_create. ' +
        'To use an existing map as context, read resource waymark://<id> or call waymark_get. Run waymark_verify before trusting an old map.',
    },
  );

  server.registerTool(
    'waymark_start',
    {
      title: 'Start a waymark',
      description:
        'Begin generating a waymark map for a topic/question. Returns the Waymark agent procedure (structure + storytelling rules), the input format, repo hints (recent files, entry points) and existing maps. Call this first, then explore the code and submit with waymark_create.',
      inputSchema: {
        query: z.string().describe('Topic or question, e.g. "how does checkout payment work?"'),
        mode: z.enum(['fast', 'smart']).optional().describe('fast: short map quickly; smart (default): thorough map with full storytelling'),
        root: rootArg,
      },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ query, mode, root }) => {
      const r = rootOf(root);
      const hints = suggestTopics(r, { limit: 5 });
      const existing = listMaps(r).slice(0, 15).map(({ id, title, query: q, updatedAt }) => ({ id, title, query: q, updatedAt }));
      return text(
        `${waymarkGuide(query, { mode })}\n## Repository\n\nroot: ${r}\n\n` +
          `Entry points: ${hints.entryPoints.join(', ') || '(none detected)'}\n\n` +
          (hints.viewedFiles.length ? `Recently viewed in the editor: ${hints.viewedFiles.map((f) => f.file).join(', ')}\n\n` : '') +
          `Recently touched: ${hints.recentFiles.slice(0, 12).map((f) => f.file).join(', ') || '(none)'}\n\n` +
          `Existing waymark (reuse/update instead of duplicating): ${existing.length ? JSON.stringify(existing) : 'none'}`,
      );
    }),
  );

  server.registerTool(
    'waymark_suggest_topics',
    {
      title: 'Suggest waymark topics',
      description: 'Suggests waymark topics from recent work (uncommitted and recently committed files, commit subjects) and detected entry points.',
      inputSchema: { root: rootArg, limit: z.number().int().min(1).max(20).optional() },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ root, limit }) => text(suggestTopics(rootOf(root), { limit }))),
  );

  server.registerTool(
    'waymark_find_anchor',
    {
      title: 'Find anchor lines',
      description: 'Returns line numbers and exact line text in a file matching a literal string or regex. Use it to get precise lineNumber/lineContent for locations.',
      inputSchema: {
        path: z.string().describe('File path relative to repo root'),
        pattern: z.string(),
        regex: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        root: rootArg,
      },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ path, pattern, regex, limit, root }) => text(findInFile(rootOf(root), path, pattern, { regex, limit }))),
  );

  server.registerTool(
    'waymark_create',
    {
      title: 'Create or update a waymark',
      description:
        'Validates a waymark, verifies every location against the working tree (auto-correcting shifted line numbers), stores it under .waymark/ and writes a shareable HTML viewer. Pass `id` to overwrite an existing map. Returns an anchor report: fix any unresolved/missing locations and resubmit.',
      inputSchema: {
        ...MapInput.shape,
        id: z.string().optional().describe('Existing waymark id to overwrite'),
        root: rootArg,
      },
    },
    safe(async ({ id, root, ...map }) => {
      const r = rootOf(root);
      const { doc, report, narrative, jsonPath, htmlPath } = saveMap(r, map, { id });
      server.sendResourceListChanged();
      const next = [];
      if (!report.healthy) {
        next.push('Some locations could not be verified. Fix them (waymark_find_anchor helps) and call waymark_create again with id="' + doc.id + '".');
      }
      if (!narrative.complete) {
        next.push('Narrative is incomplete (see "narrative"). Fill the story, trace motivation/details and per-location explanations with waymark_annotate(id="' + doc.id + '").');
      }
      const lint = lintMap(doc);
      if (lint.errors) next.push('Lint found ' + lint.errors + ' error(s) (e.g. references to unknown nodes): fix them with waymark_annotate.');
      if (!next.length) next.push('All anchors verified and narrative complete. Share the HTML file or reference waymark://' + doc.id);
      return text({
        id: doc.id,
        resource: `waymark://${doc.id}`,
        html: htmlPath,
        json: jsonPath,
        anchors: report,
        narrative,
        lint: { errors: lint.errors, warnings: lint.warnings, issues: lint.issues.slice(0, 15) },
        next,
      });
    }),
  );

  const prose = () => z.string().optional();
  server.registerTool(
    'waymark_annotate',
    {
      title: 'Annotate a waymark (narrative)',
      description:
        'Adds or rewrites the prose of an existing map without re-sending or re-anchoring it: map story/description/title, trace motivation/details/description/diagramTitle, location explanation/description/title. Only the fields you pass change. Regenerates the HTML viewer and returns which narrative fields are still missing.',
      inputSchema: {
        id: z.string().describe('Map id (a unique prefix is enough)'),
        title: prose(),
        description: prose().describe('Map summary citing nodes as [1a]'),
        story: prose().describe('Holistic storytelling narrative (markdown)'),
        language: prose(),
        traces: z
          .array(
            z.object({
              id: z.string(),
              title: prose(),
              description: prose(),
              diagramTitle: prose(),
              motivation: prose().describe('Why this part exists (markdown)'),
              details: prose().describe('Narrative walkthrough citing nodes (markdown)'),
            }),
          )
          .optional(),
        locations: z
          .array(
            z.object({
              id: z.string(),
              title: prose(),
              description: prose().describe('One sentence <= 15 words'),
              explanation: prose().describe('Storytelling explanation, 3-6 sentences (markdown)'),
            }),
          )
          .optional(),
        reviewed: z
          .array(z.string())
          .optional()
          .describe('Prose confirmed still accurate after a code change: node ids ("2b"), "trace:<id>" or "story"'),
        root: rootArg,
      },
    },
    safe(async ({ id, root, ...patch }) => text(annotateMap(rootOf(root), id, patch))),
  );

  server.registerTool(
    'waymark_enrich',
    {
      title: 'Enrich a waymark with storytelling',
      description:
        'Returns the procedure to upgrade an existing map with full storytelling (holistic story, Motivation/Details guides per trace, an explanation per location), the list of missing narrative and the map itself. Follow it and save with waymark_annotate.',
      inputSchema: { id: z.string(), root: rootArg },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ id, root }) => {
      const doc = loadMap(rootOf(root), id);
      return text(
        enrichGuide(doc.id) +
          '\n\n## Missing narrative\n\n' +
          JSON.stringify(narrativeGaps(doc)) +
          '\n\n## Current map\n\n' +
          renderMarkdown(doc, { detail: 'full' }),
      );
    }),
  );

  server.registerTool(
    'waymark_list',
    {
      title: 'List waymark',
      description: 'Lists waymark stored in the repository (.waymark/).',
      inputSchema: { root: rootArg },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ root }) => text(listMaps(rootOf(root)))),
  );

  server.registerTool(
    'waymark_get',
    {
      title: 'Get a waymark',
      description:
        'Returns a map for use as context. format: "markdown" (narrative + structure + snippets, default), "compact" (structure + one-line descriptions), "json", "mermaid". Pass trace ("2") or node ("2b") to get only that part — much smaller context.',
      inputSchema: {
        id: z.string().describe('Map id (a unique prefix is enough)'),
        format: z.enum(['markdown', 'compact', 'json', 'mermaid']).optional(),
        trace: z.string().optional().describe('Only this trace, e.g. "2"'),
        node: z.string().optional().describe('Only this node with its trace context, e.g. "2b"'),
        root: rootArg,
      },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ id, format = 'markdown', trace, node, root }) => {
      const doc = loadMap(rootOf(root), id);
      if (format === 'json') return text(doc);
      if (format === 'mermaid') return text(renderMermaid(doc));
      return text(renderMarkdown(doc, { detail: format === 'compact' ? 'compact' : 'full', trace, node }));
    }),
  );

  server.registerTool(
    'waymark_for_file',
    {
      title: 'Maps covering a file',
      description:
        'Lists the maps, traces and nodes that cover a file (optionally the node nearest to a line), with their one-line descriptions, the explanation of the nearest node and a flag when the code changed since a node was explained. Call it before modifying a file to understand the flow it belongs to.',
      inputSchema: {
        path: z.string().describe('File path (absolute or relative to the repo root)'),
        line: z.number().int().positive().optional(),
        format: z.enum(['markdown', 'json']).optional(),
        root: rootArg,
      },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ path: file, line, format = 'markdown', root }) => {
      const res = mapsForFile(rootOf(root), file, { line });
      if (format === 'json') return text(forFileSummary(res));
      return text(renderFileContext(res, { maxChars: 12000 }) || `No waymark map covers ${res.path}.`);
    }),
  );

  server.registerTool(
    'waymark_lint',
    {
      title: 'Lint maps',
      description:
        'Static quality checks on maps: references to unknown nodes (errors), missing narrative, nodes not cited in their trace details, nodes missing from the tree, over-long titles/descriptions, very short explanations. Omit id to lint all maps.',
      inputSchema: { id: z.string().optional(), root: rootArg },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ id, root }) => {
      const r = rootOf(root);
      const ids = id ? [loadMap(r, id).id] : listMaps(r).map((m) => m.id);
      return text(ids.map((i) => lintMap(loadMap(r, i))));
    }),
  );

  server.registerTool(
    'waymark_refresh',
    {
      title: 'Refresh outdated narrative',
      description:
        'Finds prose whose code changed since it was written (narrative drift: nodes, trace guides, story) and returns the procedure to bring it back in sync with waymark_annotate (or mark it reviewed). Use after code changes in areas covered by a map.',
      inputSchema: { id: z.string(), root: rootArg },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ id, root }) => {
      const r = rootOf(root);
      const v = verifyMap(r, id);
      const doc = loadMap(r, v.id);
      if (!v.narrative.stale && !v.broken) return text(`Map ${v.id}: narrative is in sync with the code. Nothing to refresh.`);
      const brokenIds = v.changes.filter((c) => c.status === 'unresolved' || c.status === 'missing').map((c) => c.id);
      const nodes = [...new Set([...brokenIds, ...v.narrative.nodes])].map((n) => renderMarkdown(doc, { node: n })).join('\n\n---\n\n');
      return text(
        refreshGuide(v.id, v.narrative, brokenIds) +
          (nodes ? '\n\n## Stale nodes (stored prose + last snippet)\n\n' + nodes : ''),
      );
    }),
  );

  server.registerTool(
    'waymark_verify',
    {
      title: 'Verify waymark anchors',
      description:
        'Re-checks waymark locations against the current code: detects moved lines, renamed files and removed code. With fix=true, writes corrected anchors back. Omit id to verify all maps.',
      inputSchema: { id: z.string().optional(), fix: z.boolean().optional(), root: rootArg },
    },
    safe(async ({ id, fix, root }) => {
      const r = rootOf(root);
      const ids = id ? [id] : listMaps(r).map((m) => m.id);
      return text(ids.map((i) => verifyMap(r, i, { fix })));
    }),
  );

  server.registerTool(
    'waymark_render',
    {
      title: 'Render waymark viewer',
      description: 'Regenerates the self-contained HTML viewer of a waymark and optionally opens it in the default browser.',
      inputSchema: { id: z.string(), open: z.boolean().optional(), root: rootArg },
    },
    safe(async ({ id, open, root }) => {
      const r = rootOf(root);
      const p = writeHtml(r, loadMap(r, id));
      if (open) openFile(p);
      return text({ html: p });
    }),
  );

  server.registerTool(
    'waymark_delete',
    {
      title: 'Delete a waymark',
      description: 'Deletes a waymark (JSON and HTML) from .waymark/. Only use when the user asks.',
      inputSchema: { id: z.string(), root: rootArg },
      annotations: { destructiveHint: true },
    },
    safe(async ({ id, root }) => {
      const removed = deleteMap(rootOf(root), id);
      server.sendResourceListChanged();
      return text({ deleted: removed });
    }),
  );

  // @-mentionable context: waymark://<id>
  server.registerResource(
    'waymark',
    new ResourceTemplate('waymark://{id}', {
      list: async () => ({
        resources: listMaps(rootOf()).map((m) => ({
          uri: `waymark://${m.id}`,
          name: m.title,
          description: m.description,
          mimeType: 'text/markdown',
        })),
      }),
      complete: { id: (v) => listMaps(rootOf()).map((m) => m.id).filter((i) => i.startsWith(v)) },
    }),
    { title: 'Waymark', description: 'A waymark rendered as markdown context', mimeType: 'text/markdown' },
    async (uri, { id }) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: renderMarkdown(loadMap(rootOf(), String(id))) }],
    }),
  );

  // @-mention a single trace or node: waymark://<id>/<trace> or waymark://<id>/<node>
  server.registerResource(
    'waymark-part',
    new ResourceTemplate('waymark://{id}/{part}', {
      list: async () => ({
        resources: listMaps(rootOf()).flatMap((m) => {
          try {
            return loadMap(rootOf(), m.id).traces.map((t) => ({
              uri: `waymark://${m.id}/${t.id}`,
              name: `${m.title} › ${t.id}. ${t.title}`,
              description: t.description,
              mimeType: 'text/markdown',
            }));
          } catch {
            return [];
          }
        }),
      }),
    }),
    { title: 'Waymark trace or node', description: 'One trace ("2") or one node ("2b") of a map, as markdown context', mimeType: 'text/markdown' },
    async (uri, { id, part }) => {
      const doc = loadMap(rootOf(), String(id));
      const isTrace = doc.traces.some((t) => t.id === String(part));
      const md = renderMarkdown(doc, isTrace ? { trace: String(part) } : { node: String(part) });
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: md }] };
    },
  );

  server.registerPrompt(
    'create_waymark',
    {
      title: 'Create a waymark',
      description: 'Generate a hierarchical waymark of how the code works for a topic',
      argsSchema: { query: z.string().describe('Topic or question') },
    },
    ({ query }) => ({ messages: [{ role: 'user', content: { type: 'text', text: waymarkGuide(query) } }] }),
  );

  server.server.oninitialized = async () => {
    if (!server.server.getClientCapabilities()?.roots) return;
    try {
      const { roots } = await server.server.listRoots();
      const first = roots.find((x) => x.uri.startsWith('file://'));
      if (first) clientRoot = fileURLToPath(first.uri);
    } catch {
      /* client advertised roots but failed to list them: fall back to cwd */
    }
  };

  return server;
}

export async function startStdio() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('mcp.js')) {
  startStdio().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
