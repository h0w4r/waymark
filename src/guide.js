// The procedure the "Waymark agent" follows. Shared by the MCP prompt, the
// waymark_start tool, the headless `waymark generate` command and the skill files.

export const EXAMPLE = {
  title: 'Login request to session cookie',
  description:
    'How a POST /login travels from the HTTP router to a persisted session. Key takeaway: credentials are checked in AuthService, the session store is the only writer of the cookie.',
  query: 'how does login work?',
  traces: [
    {
      id: '1',
      title: 'HTTP entry and validation',
      description: 'Routing of the request and input validation before any auth logic runs.',
      locations: [
        {
          id: '1a',
          title: 'Route registration',
          description: 'POST /login is bound to LoginController.handle with the rate-limit middleware.',
          path: 'src/routes/auth.ts',
          lineNumber: 18,
          lineContent: "router.post('/login', rateLimit(5), loginController.handle);",
        },
        {
          id: '1b',
          title: 'Controller entry',
          description: 'Parses the body with LoginSchema; invalid input returns 400 before touching the DB.',
          path: 'src/controllers/login.ts',
          lineNumber: 22,
          lineContent: 'async handle(req: Request, res: Response) {',
          symbol: 'LoginController.handle',
        },
      ],
      tree: [{ ref: '1a', children: [{ ref: '1b' }] }],
      guide: 'The router [1a] wraps the controller with a rate limiter. [1b] validates input and delegates to AuthService ([2a]).',
    },
  ],
  links: [{ from: '1b', to: '2a', label: 'authService.login(credentials)' }],
};

export function waymarkGuide(query) {
  return `You are the **Waymark agent**. Build a hierarchical, precise map of how the code works for:

> ${query || '<topic chosen by the user>'}

A map is a set of **traces**. Each trace is one coherent execution path or component relationship, made of numbered **locations** (1a, 1b, …) that point at exact lines of code, arranged as a **tree** (call nesting / containment), plus a short markdown **guide**.

Explore with read-only means only: your harness's read/search tools (Read/Grep/Glob in Claude Code; \`rg\`, \`sed -n\`, \`git grep\` in a read-only shell in Codex). Do not edit files; the \`waymark_*\` tools do all the writing.

## Procedure

1. **Scope.** Turn the topic into 1–5 traces (e.g. "request entry → handler", "token validation", "persistence", "background job"). Prefer depth on the asked flow over breadth.
2. **Find entry points.** Search for routes, main/CLI handlers, exported APIs, event/queue subscribers, UI event handlers related to the topic. Use \`waymark_suggest_topics\` for recently touched files when the topic is vague.
3. **Follow the execution.** Read the real code and follow calls step by step across files. **Never invent a location**: every node must be a line you actually read. Note async boundaries, branches that change the flow, state mutations and I/O (DB, network, filesystem).
4. **Pick the nodes** (4–12 per trace). Choose lines that carry understanding: the definition when the point is "B does X"; the call site when the point is "A hands off to B"; the branch/condition when it decides the path; the write when state changes. Skip boilerplate.
5. **Shape the hierarchy.** Order locations by execution. In \`tree\`, children are what the parent calls or contains. Use label-only nodes (\`{"label": "async: queue consumer", "children": [...]}\`) to group. Add \`links\` for relations between traces.
6. **Write tight prose.**
   - location.title ≤ 6 words; location.description 1–2 sentences: what happens, what data moves, why it matters.
   - trace.description: one paragraph. trace.guide: markdown walkthrough (1–3 short paragraphs) referencing nodes as [1a], [2c].
   - map.description: scope + the key takeaway a newcomer must remember.
7. **Submit** with \`waymark_create\`. \`path\` is relative to the repo root; \`lineContent\` is the EXACT text of that line (it is used to verify and re-anchor). Use \`waymark_find_anchor\` if unsure of a line number.
8. **Fix anchors.** Read the anchor report. For \`unresolved\`/\`missing\` (and doubtful \`fuzzy\`) locations, look up the right line and call \`waymark_create\` again with the same \`id\` and the corrected map. Stop when the report is healthy.
9. **Answer** with the map id, the HTML viewer path, and a 3–5 line summary of the traces. The map can then be reused as context via the \`waymark://<id>\` resource or \`waymark_get\`.

## Input shape (example)

\`\`\`json
${JSON.stringify(EXAMPLE, null, 2)}
\`\`\`
`;
}
