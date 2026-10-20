import * as z from 'zod';

// Titles are short labels. Reject markup that agents sometimes leak from their own tool calls
// (e.g. '</title> <parameter name="query">…') so a broken call cannot corrupt a map.
const LEAK = /<\/?(parameter|invoke|function_calls|antml|title)\b|<\/[a-z]+>/i;
export const Title = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => !LEAK.test(v), 'title contains tool-call markup (e.g. "</title>" or "<parameter"); send a plain title');

// A tree node inside a trace. `ref` points at a location id ("1a"); nodes without
// `ref` are plain labels (e.g. "middleware chain", "async boundary").
const TreeNode = z.lazy(() =>
  z.object({
    ref: z.string().optional().describe('Location id this node represents, e.g. "1a"'),
    label: z
      .string()
      .optional()
      .describe('Text shown for the node; defaults to the location title. Label-only nodes describe intermediate steps (short phrase or pseudo-code)'),
    via: z.string().optional().describe('Label of the edge from the parent (data/control that flows), e.g. "streams text"'),
    children: z.array(TreeNode).optional(),
  }),
);

export const LocationInput = z.object({
  id: z.string().optional().describe('Stable id "<traceId><letter>", e.g. "1a". Auto-assigned if omitted'),
  title: Title.describe('Short name of the step (<= 5 words), e.g. "Validate JWT"'),
  description: z
    .string()
    .describe('ONE short sentence (<= 15 words) shown inline next to the code, e.g. "Dual learning rate for embeddings vs matrices"'),
  explanation: z
    .string()
    .optional()
    .describe(
      'Storytelling explanation (markdown, 3-6 sentences) shown when the reader clicks "Explain": what happens at this exact point, where control/data comes from and goes next, why it is written this way, pitfalls. Plain language, may use an analogy; reference other nodes as [1b]',
    ),
  path: z.string().describe('File path relative to repo root (forward slashes)'),
  lineNumber: z.number().int().positive().describe('1-based line of the anchor'),
  lineContent: z
    .string()
    .describe('EXACT text of that line as it appears in the file (used to verify and re-anchor)'),
  symbol: z.string().optional().describe('Function/class/method name, if any'),
  mapRef: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,80}(#[A-Za-z0-9_-]{1,16})?$/)
    .optional()
    .describe('Overview maps: id of a detailed map that explains this part ("auth-flow" or "auth-flow#2b")'),
});

export const TraceInput = z.object({
  id: z.string().optional().describe('Trace id "1", "2"... Auto-assigned if omitted'),
  title: Title,
  description: z.string().describe('One sentence: what this trace shows (shown under the trace title)'),
  diagramTitle: z.string().optional().describe('Title above the trace tree, e.g. "Mid-training Data Pipeline"'),
  motivation: z
    .string()
    .optional()
    .describe('Guide "Motivation" (markdown, 1 paragraph): why this part exists, the problem or constraint that drives it'),
  details: z
    .string()
    .optional()
    .describe('Guide "Details" (markdown, 2-4 paragraphs): narrative walkthrough of the trace referencing every node as [1a], [1b]'),
  locations: z.array(LocationInput).min(1).describe('Ordered by execution / reading order'),
  tree: z
    .array(TreeNode)
    .optional()
    .describe('Hierarchy (call tree / containment) over the locations. Linear chain if omitted'),
  guide: z
    .string()
    .optional()
    .describe('Deprecated alias of "details"'),
});

export const LinkInput = z.object({
  from: z.string().describe('Location id'),
  to: z.string().describe('Location id'),
  label: z.string().optional(),
});

export const MapInput = z.object({
  title: Title,
  description: z
    .string()
    .describe('Summary (2-3 sentences) of what the map covers, citing key nodes inline as [1b], [2c], [3d, 4a]'),
  story: z
    .string()
    .optional()
    .describe(
      'Holistic storytelling narrative (markdown, 3-6 short paragraphs) for a newcomer: the problem the system solves, the journey of the request/data through the traces in order (cite nodes), how the pieces fit, and key takeaways/gotchas',
    ),
  language: z.string().optional().describe('Language of the prose, e.g. "es" or "en" (use the language of the query)'),
  query: z.string().optional().describe('The user prompt / topic that produced this map'),
  traces: z.array(TraceInput).min(1),
  links: z.array(LinkInput).optional().describe('Cross-trace relationships between locations'),
  diagram: z.string().optional().describe('Optional Mermaid diagram; generated automatically if omitted'),
  tags: z.array(z.string()).optional(),
  kind: z
    .enum(['flow', 'overview'])
    .optional()
    .describe('"overview": a map of the whole system whose nodes link (mapRef) to detailed maps. Default "flow"'),
});

const letters = 'abcdefghijklmnopqrstuvwxyz';
export const letterId = (i) => (i < 26 ? letters[i] : letters[Math.floor(i / 26) - 1] + letters[i % 26]);

/** Assigns ids, normalizes paths and fills in a default linear tree. */
export function normalizeMap(input) {
  const map = MapInput.parse(input);
  const seen = new Set();
  map.traces.forEach((trace, ti) => {
    trace.id = trace.id || String(ti + 1);
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(trace.id)) throw new Error(`Invalid trace id "${trace.id}" (use e.g. "1")`);
    trace.locations.forEach((loc, li) => {
      loc.id = loc.id || `${trace.id}${letterId(li)}`;
      if (!/^[A-Za-z0-9_-]{1,16}$/.test(loc.id)) throw new Error(`Invalid location id "${loc.id}" (use e.g. "1a")`);
      if (seen.has(loc.id)) throw new Error(`Duplicate location id "${loc.id}"`);
      seen.add(loc.id);
      loc.path = loc.path.replace(/\\/g, '/').replace(/^\.\//, '');
    });
    if (trace.guide && !trace.details) trace.details = trace.guide;
    delete trace.guide;
    if (!trace.tree || trace.tree.length === 0) trace.tree = linearTree(trace.locations);
    for (const ref of treeRefs(trace.tree)) {
      if (!seen.has(ref)) throw new Error(`Trace ${trace.id} tree references unknown location "${ref}"`);
    }
  });
  for (const link of map.links || []) {
    if (!seen.has(link.from) || !seen.has(link.to)) {
      throw new Error(`Link ${link.from} -> ${link.to} references an unknown location`);
    }
  }
  return map;
}

function linearTree(locations) {
  // Nest each step under the previous one: reads as an execution chain.
  let root = null;
  for (let i = locations.length - 1; i >= 0; i--) {
    root = { ref: locations[i].id, children: root ? [root] : [] };
  }
  return [root];
}

export function* treeRefs(nodes) {
  for (const n of nodes || []) {
    if (n.ref) yield n.ref;
    yield* treeRefs(n.children);
  }
}

export function allLocations(map) {
  return map.traces.flatMap((t) => t.locations.map((l) => ({ ...l, traceId: t.id })));
}
