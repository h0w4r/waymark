import * as z from 'zod';

// A tree node inside a trace. `ref` points at a location id ("1a"); nodes without
// `ref` are plain labels (e.g. "middleware chain", "async boundary").
const TreeNode = z.lazy(() =>
  z.object({
    ref: z.string().optional().describe('Location id this node represents, e.g. "1a"'),
    label: z.string().optional().describe('Text shown for the node; defaults to the location title'),
    children: z.array(TreeNode).optional(),
  }),
);

export const LocationInput = z.object({
  id: z.string().optional().describe('Stable id "<traceId><letter>", e.g. "1a". Auto-assigned if omitted'),
  title: z.string().describe('Short name of the step, e.g. "Validate JWT"'),
  description: z.string().describe('What happens here and why it matters in the flow (1-3 sentences)'),
  path: z.string().describe('File path relative to repo root (forward slashes)'),
  lineNumber: z.number().int().positive().describe('1-based line of the anchor'),
  lineContent: z
    .string()
    .describe('EXACT text of that line as it appears in the file (used to verify and re-anchor)'),
  symbol: z.string().optional().describe('Function/class/method name, if any'),
});

export const TraceInput = z.object({
  id: z.string().optional().describe('Trace id "1", "2"... Auto-assigned if omitted'),
  title: z.string(),
  description: z.string().describe('One paragraph: what this trace explains'),
  locations: z.array(LocationInput).min(1).describe('Ordered by execution / reading order'),
  tree: z
    .array(TreeNode)
    .optional()
    .describe('Hierarchy (call tree / containment) over the locations. Linear chain if omitted'),
  guide: z
    .string()
    .optional()
    .describe('Markdown walkthrough of the trace; reference nodes as [1a], [1b]'),
});

export const LinkInput = z.object({
  from: z.string().describe('Location id'),
  to: z.string().describe('Location id'),
  label: z.string().optional(),
});

export const MapInput = z.object({
  title: z.string(),
  description: z.string().describe('Overview: what the map covers and the key takeaway'),
  query: z.string().optional().describe('The user prompt / topic that produced this map'),
  traces: z.array(TraceInput).min(1),
  links: z.array(LinkInput).optional().describe('Cross-trace relationships between locations'),
  diagram: z.string().optional().describe('Optional Mermaid diagram; generated automatically if omitted'),
  tags: z.array(z.string()).optional(),
});

const letters = 'abcdefghijklmnopqrstuvwxyz';
const letterId = (i) => (i < 26 ? letters[i] : letters[Math.floor(i / 26) - 1] + letters[i % 26]);

/** Assigns ids, normalizes paths and fills in a default linear tree. */
export function normalizeMap(input) {
  const map = MapInput.parse(input);
  const seen = new Set();
  map.traces.forEach((trace, ti) => {
    trace.id = trace.id || String(ti + 1);
    trace.locations.forEach((loc, li) => {
      loc.id = loc.id || `${trace.id}${letterId(li)}`;
      if (seen.has(loc.id)) throw new Error(`Duplicate location id "${loc.id}"`);
      seen.add(loc.id);
      loc.path = loc.path.replace(/\\/g, '/').replace(/^\.\//, '');
    });
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
