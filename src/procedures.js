// Agent procedures for fact-checking, parallel generation and overview maps.
// (The base procedure — waymarkGuide — lives in guide.js.)

const STYLE_REMINDER =
  'Prose is storytelling for a new teammate, in the language of the query; cite nodes as [1a]. Every anchored node must be a line you actually read (read-only exploration).';

/** Skeptical verifier: checks every claim against the code and records verdicts. */
export function checkGuide(id) {
  return `You are the **Waymark fact-checker** for map \`${id}\`. You did NOT write this map; your job is to find what is wrong with it.

Work read-only. For each location (and then each trace guide and the story):

1. Open the code around the anchor (the map below has snippets; read more of the file when needed).
2. List the concrete claims in its \`description\` and \`explanation\`: what calls what, what data is passed or returned, conditions and branches, side effects, numbers, names, ordering, "only/always/never" statements.
3. Verify each claim against the code you read. A claim about runtime behaviour you cannot see in code (performance, external services) is *unverifiable*.
4. If a claim is **wrong**, fix the prose first with \`waymark_annotate\` (keep the style and language), then judge the corrected text.
5. Record verdicts with \`waymark_record_check\`:
   - \`supported\` — every claim is backed by code you read;
   - \`partial\` — something is unverifiable or imprecise (say what in \`issues\`);
   - \`unsupported\` — a claim is wrong and you could not fix it (say why).
   Be strict: when unsure, use \`partial\`. Put each problem in \`issues\` as one short sentence ("fixed: said X, code does Y" for corrections).
6. Check every trace's motivation/details and the story the same way (\`traces\` and \`story\` in \`waymark_record_check\`).

Finish with a summary: how many nodes supported / partial / unsupported and the main corrections you made.`;
}

/** Phase 1 of parallel generation: plan the traces quickly, without deep exploration. */
export function planGuide(query, { mode = 'smart', kind = 'flow' } = {}) {
  return `You are the **Waymark planner**. Plan a map for:

> ${query}

Explore just enough (entry points, main modules) to split the topic into ${mode === 'fast' ? '2-3' : '3-6'} **independent traces** that separate agents can build in parallel. Each trace is one coherent execution path or component relationship. Do NOT build the traces yourself.

Call \`waymark_plan\` with: \`query\`, a \`title\`, the \`language\` of the query, \`kind: "${kind}"\`, and \`traces\`: for each one a \`title\`, a \`focus\` (2-4 sentences: what this trace must explain, where it starts and ends, what it must NOT cover because another trace does) and \`hints\` (entry files/symbols you found). Order the traces as the story unfolds. Then reply with the draft id.`;
}

/** Phase 2: build exactly one trace of a plan. */
export function traceGuide(draft, n, plan) {
  const t = plan.traces.find((x) => x.n === Number(n));
  const others = plan.traces.filter((x) => x.n !== Number(n)).map((x) => `${x.n}. ${x.title}`).join('; ');
  return `You are a **Waymark trace builder**. Build ONLY trace ${n} of the plan for "${plan.query}" (draft \`${draft}\`).

- Trace ${n}: **${t.title}** — ${t.focus}
- Start from: ${(t.hints || []).join(', ') || '(find the entry point)'}
- Other traces (built by other agents, do not cover them): ${others || 'none'}

Follow the Waymark structure for a single trace: ordered \`locations\` (ids ${n}a, ${n}b, …; 4-12 nodes; exact \`lineContent\`), an annotated \`tree\` with label-only intermediate steps and \`via\` edge labels, a \`diagramTitle\`, a one-sentence \`description\`, \`motivation\` and \`details\` (narrative citing every node), and per location a one-line \`description\` and a 3-6 sentence storytelling \`explanation\`. ${STYLE_REMINDER} Language: ${plan.language || 'the language of the query'}.

Submit with \`waymark_add_trace(draft: "${draft}", n: ${n}, trace)\`. Fix unresolved anchors and resubmit until healthy. Reply with a 2-line summary of the trace.`;
}

/** Phase 3: merge, then write the map-level prose and the cross-trace links. */
export function finalizeGuide(draft) {
  return `You are the **Waymark editor** for draft \`${draft}\`. Several agents built its traces in parallel.

1. Call \`waymark_draft(draft: "${draft}")\` to read every finished trace (and which, if any, are missing).
2. Write the map-level prose in the plan's language: \`description\` (2-3 sentences citing key nodes), a holistic \`story\` (the problem → the journey through the traces in order → how they connect → **Takeaways**), and \`links\` between traces (\`{from, to, label}\` with the data that flows), using only node ids that exist.
3. Call \`waymark_finalize(draft: "${draft}", description, story, links)\`. Then run \`waymark_lint\` on the resulting map and fix any error with \`waymark_annotate\`.
4. Reply with the map id and a 3-line summary.`;
}

/** Overview ("map of maps"): the system's architecture, linking to detailed maps. */
export function overviewGuide(query) {
  return `You are the **Waymark agent** building an **overview map** ("map of maps")${query ? ` for: ${query}` : ' of this repository'}.

Purpose: a newcomer opens this first. It shows the system's main parts and how a typical request/job flows between them; each part links to the detailed map that explains it.

1. Call \`waymark_list\` to see existing maps (their titles/descriptions tell you what is already documented).
2. Explore the repository structure: entry points, main modules/packages, boundaries (API, workers, storage, UI, CLI…).
3. Traces = subsystems or layers (2-6). Nodes = the key entry point of each part (anchored lines you read: the router, the main service class, the queue consumer…). Keep each trace short (2-6 nodes).
4. For every node covered by an existing detailed map, set \`mapRef\` to that map's id (or "id#node" for a specific node). Use \`waymark_for_file\` to find which maps cover a file.
5. In the \`story\`, explain the architecture end to end and finish with a **"Maps to create next"** list for important parts that have no detailed map yet.
6. Submit with \`waymark_create\` and \`kind: "overview"\`. ${STYLE_REMINDER}`;
}
