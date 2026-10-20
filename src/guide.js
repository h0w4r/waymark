// The procedure the "Waymark agent" follows. Shared by the MCP prompt, the
// waymark_start tool, the headless `waymark generate` command and the skill files.

export const EXAMPLE = {
  title: 'Login: from POST /login to session cookie',
  description:
    'Traces a login request from the HTTP router [1a] through credential checks in AuthService [2b] to the session store that issues the cookie [3c]. Rate limiting [1b] and password hashing [2c] are the two security gates.',
  query: 'how does login work?',
  language: 'en',
  story:
    '## The big picture\n\nEvery login is a small negotiation: the browser offers credentials, and the server must decide — quickly and safely — whether to hand back a long-lived session. The code splits that negotiation into three acts.\n\nFirst the request has to get in the door. The router [1a] places a rate limiter [1b] in front of the controller, so brute-force attempts are cut off before any database work happens.\n\nThen comes the actual question, "is this really you?". AuthService [2a] looks the user up and compares password hashes [2c] in constant time, so timing does not leak which part failed.\n\nFinally the session store [3a] is the only component allowed to mint cookies [3c]. Keeping that power in one place is what makes logout and session revocation trivial.\n\n**Takeaways:** a failed login never touches the session store; if you add a new login method (SSO, magic link), it must end in `sessionStore.create` [3b] or users will be logged in without a revocable session.',
  traces: [
    {
      id: '1',
      title: 'HTTP entry and validation',
      description: 'How the request is routed, rate-limited and validated before auth runs.',
      diagramTitle: 'Login Request Entry',
      motivation:
        'Login is the most attacked endpoint of any app. Before spending a database round-trip or a slow password hash, the server must reject floods and malformed input cheaply.',
      details:
        'The router [1a] binds `POST /login` and wraps the controller with `rateLimit(5)` [1b], a sliding window keyed by IP.\n\nOnly requests that survive reach the controller [1c], which parses the body with `LoginSchema`; invalid payloads get a 400 immediately, so AuthService ([2a]) only ever sees well-formed credentials.',
      locations: [
        {
          id: '1a',
          title: 'Route registration',
          description: 'Binds POST /login to the controller behind a rate limiter.',
          explanation:
            'This single line is the front door of the whole flow. Express evaluates the middlewares left to right, so `rateLimit(5)` [1b] runs before the controller ever sees the request. Think of it as a bouncer checking how many times you have knocked before letting you talk to the receptionist ([1c]).',
          path: 'src/routes/auth.ts',
          lineNumber: 18,
          lineContent: "router.post('/login', rateLimit(5), loginController.handle);",
        },
        {
          id: '1b',
          title: 'Rate limiter',
          description: 'Allows 5 attempts per minute per IP.',
          explanation:
            'The limiter keeps a per-IP counter in Redis with a 60-second TTL. Once the counter passes 5 it answers 429 itself and the request stops here. Because it runs before any auth logic, an attacker cannot use timing to learn which emails exist.',
          path: 'src/middleware/rateLimit.ts',
          lineNumber: 7,
          lineContent: 'export function rateLimit(max: number) {',
          symbol: 'rateLimit',
        },
        {
          id: '1c',
          title: 'Controller entry',
          description: 'Validates the body and delegates to AuthService.',
          explanation:
            'Here the request becomes typed data. `LoginSchema.parse` throws on missing or malformed fields, which the error middleware turns into a 400. Everything after this point can trust the shape of `email` and `password`.',
          path: 'src/controllers/login.ts',
          lineNumber: 22,
          lineContent: 'async handle(req: Request, res: Response) {',
          symbol: 'LoginController.handle',
        },
      ],
      tree: [
        {
          ref: '1a',
          children: [
            { ref: '1b', via: 'every request' },
            { label: 'Parse JSON body' },
            { ref: '1c', via: 'if under limit', children: [{ label: 'LoginSchema.parse(req.body)' }, { label: '400 on invalid input' }] },
          ],
        },
      ],
    },
  ],
  links: [{ from: '1c', to: '2a', label: 'credentials' }],
};

const MODES = {
  fast: 'FAST mode: 1-3 traces, 3-6 locations each. Keep motivation/details to one short paragraph each and explanations to 2-3 sentences. Optimize for speed.',
  smart:
    'SMART mode: 2-6 traces, 4-12 locations each. Explore thoroughly (follow every hop of the flow), write full storytelling: story 3-6 paragraphs, motivation 1 paragraph, details 2-4 paragraphs, explanation 3-6 sentences per location.',
};

export function waymarkGuide(query, { mode = 'smart' } = {}) {
  return `You are the **Waymark agent**. Build a hierarchical, precise **and narrated** map of how the code works for:

> ${query || '<topic chosen by the user>'}

${MODES[mode] || MODES.smart}

A map is a set of **traces**. Each trace is one coherent execution path or component relationship, made of numbered **locations** (1a, 1b, …) that point at exact lines of code, arranged as an annotated **tree** that mixes anchored locations with short label-only steps. Every level carries prose: a summary and a holistic **story** for the whole map, a **Motivation** + **Details** guide per trace, a one-line **description** and a storytelling **explanation** per location. Readers should understand the system from the prose alone, and verify it by clicking through to the code.

Explore with read-only means only: your harness's read/search tools (Read/Grep/Glob in Claude Code; \`rg\`, \`sed -n\`, \`git grep\` in a read-only shell in Codex). Do not edit files; the \`waymark_*\` tools do all the writing.

## Procedure

1. **Scope.** Turn the topic into traces (e.g. "request entry → handler", "token validation", "persistence", "background job"). Order them as the story unfolds. Prefer depth on the asked flow over breadth.
2. **Find entry points.** Search for routes, main/CLI handlers, exported APIs, event/queue subscribers, UI handlers, config/scripts related to the topic. Use \`waymark_suggest_topics\` when the topic is vague.
3. **Follow the execution.** Read the real code and follow calls step by step across files. **Never invent a location**: every anchored node must be a line you actually read. Note async boundaries, branches that change the flow, state mutations and I/O (DB, network, filesystem), and the data handed from step to step.
4. **Pick the anchored nodes.** Choose lines that carry understanding: the definition when the point is "B does X"; the call site when the point is "A hands off to B"; the branch/condition when it decides the path; the write when state changes. Skip boilerplate.
5. **Shape the annotated tree** (per trace, like a call tree you would sketch on a whiteboard):
   - Children are what the parent calls, contains or triggers. Order by execution.
   - Add **label-only nodes** for meaningful intermediate steps that do not deserve an anchor: short phrases ("Load individual tasks", "Accumulate tokens in buffer") or pseudo-code (\`num_heads = ceil(model_dim / 128)\`). They make the tree read like a story.
   - A location may appear again later in the tree as a reference (\`{"ref": "1a"}\`) when the flow comes back to it.
   - Use \`via\` on a child to label the edge with the data/control that flows ("streams text", "on success").
   - Give the tree a \`diagramTitle\` (e.g. "Mid-training Data Pipeline").
   - Add \`links\` (with labels) for data flowing between traces ("provides tokenizer").
6. **Write the prose — storytelling, not API docs.** Write as a senior engineer walking a new teammate through the code: start from the *why*, follow the journey of the data/request, make cause and effect explicit, name the trade-offs and gotchas, cite nodes as [1a] or [2e, 3e] so every claim is clickable. Avoid restating the code line by line. Write ALL prose — titles, \`diagramTitle\`, label nodes and \`via\` labels included — in **the language of the query** (set \`language\`); keep code identifiers as they are.
   - **map.description** (summary): 2-3 sentences citing the key nodes.
   - **map.story** (holistic): 3-6 short paragraphs: the problem the system solves → the journey through the traces in order → how the pieces fit → **Takeaways** (what a newcomer must remember / what breaks if changed).
   - **trace.description**: one sentence. **trace.motivation**: why this part exists, the problem or constraint behind it. **trace.details**: narrative walkthrough citing every node of the trace (bullets allowed for lists).
   - **location.title** ≤ 5 words. **location.description**: ONE sentence ≤ 15 words (shown inline next to the code). **location.explanation**: 3-6 sentences — what happens at this exact point, where the data/control comes from and where it goes next, why it is written this way, pitfalls; an analogy is welcome when it clarifies.
7. **Submit** with \`waymark_create\`. \`path\` is relative to the repo root; \`lineContent\` is the EXACT text of that line (it is used to verify and re-anchor). Use \`waymark_find_anchor\` if unsure of a line number.
8. **Fix anchors and gaps.** Read the report. For \`unresolved\`/\`missing\` (and doubtful \`fuzzy\`) locations, look up the right line and call \`waymark_create\` again with the same \`id\`. If the report lists missing narrative (story/motivation/details/explanations), fill it with \`waymark_annotate\` (no need to resend the map).
9. **Answer** with the map id, the HTML viewer path, and a 3-5 line summary. The map can be reused as context via \`waymark://<id>\` or \`waymark_get\`.

## Input shape (example)

\`\`\`json
${JSON.stringify(EXAMPLE, null, 2)}
\`\`\`
`;
}

/** Procedure to add/upgrade the narrative of an existing map without re-mapping it. */
export function enrichGuide(id) {
  return `You are the **Waymark agent**. Upgrade the narrative of the existing map \`${id}\` to full storytelling quality.

1. Call \`waymark_get(id: "${id}", format: "markdown")\` and read the map, including code snippets. Open the referenced files around each location to understand what really happens (read-only).
2. Write, in the map's language (or the user's): a holistic **story** for the map; **motivation** and **details** for every trace; a storytelling **explanation** (3-6 sentences: what happens here, where data comes from and goes next, why it is written this way, pitfalls) for every location. Tighten \`description\` to one sentence ≤ 15 words where needed. Cite nodes as [1a].
3. Save with \`waymark_annotate\` (only the fields you change). Do not change anchors.
4. Reply with a short summary of what you added.`;
}
