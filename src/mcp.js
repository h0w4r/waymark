#!/usr/bin/env node
import * as z from 'zod';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MapInput } from './schema.js';
import { fileURLToPath } from 'node:url';
import { resolveRoot } from './git.js';
import { saveMap, loadMap, listMaps, writeHtml, deleteMap } from './store.js';
import { verifyMap } from './verify.js';
import { findInFile } from './anchor.js';
import { suggestTopics } from './suggest.js';
import { waymarkGuide } from './guide.js';
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
        'Begin generating a waymark for a topic/question. Returns the Waymark agent procedure, the input format, repo hints (recent files, entry points) and existing maps. Call this first, then explore the code and submit with waymark_create.',
      inputSchema: { query: z.string().describe('Topic or question, e.g. "how does checkout payment work?"'), root: rootArg },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ query, root }) => {
      const r = rootOf(root);
      const hints = suggestTopics(r, { limit: 5 });
      const existing = listMaps(r).slice(0, 15).map(({ id, title, query: q, updatedAt }) => ({ id, title, query: q, updatedAt }));
      return text(
        `${waymarkGuide(query)}\n## Repository\n\nroot: ${r}\n\n` +
          `Entry points: ${hints.entryPoints.join(', ') || '(none detected)'}\n\n` +
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
      const { doc, report, jsonPath, htmlPath } = saveMap(r, map, { id });
      server.sendResourceListChanged();
      return text({
        id: doc.id,
        resource: `waymark://${doc.id}`,
        html: htmlPath,
        json: jsonPath,
        anchors: report,
        next: report.healthy
          ? 'All anchors verified. Share the HTML file or reference waymark://' + doc.id
          : 'Some locations could not be verified. Fix them (waymark_find_anchor helps) and call waymark_create again with id="' + doc.id + '".',
      });
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
        'Returns a waymark for use as context. format: "markdown" (structure + code snippets, default), "compact" (structure + anchor lines only), "json", "mermaid".',
      inputSchema: {
        id: z.string().describe('Waymark id (a unique prefix is enough)'),
        format: z.enum(['markdown', 'compact', 'json', 'mermaid']).optional(),
        root: rootArg,
      },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ id, format = 'markdown', root }) => {
      const doc = loadMap(rootOf(root), id);
      if (format === 'json') return text(doc);
      if (format === 'mermaid') return text(renderMermaid(doc));
      return text(renderMarkdown(doc, { detail: format === 'compact' ? 'compact' : 'full' }));
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
