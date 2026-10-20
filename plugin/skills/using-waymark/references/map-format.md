# Map format and quality bar

`waymark_start` returns the authoritative procedure and an example; this is the short version.

```jsonc
{
  "title": "Login: from POST /login to session cookie",       // <= ~10 words
  "description": "Summary citing key nodes [1a], [2b, 2c].",  // 2-3 sentences
  "story": "## The problem\n…\n**Takeaways:** …",             // holistic narrative, markdown
  "language": "es",                                           // language of the user's query
  "kind": "flow",                                             // or "overview" (map of maps)
  "traces": [{
    "id": "1", "title": "HTTP entry", "description": "One sentence.",
    "diagramTitle": "Login Request Entry",
    "motivation": "Why this part exists (1 paragraph).",
    "details": "Narrative walkthrough citing EVERY node [1a], [1b]…",
    "locations": [{
      "id": "1a", "title": "Route registration",              // <= 5 words
      "description": "One sentence <= 15 words.",
      "explanation": "3-6 sentences: what happens here, where data comes from and goes next, why, pitfalls.",
      "path": "src/routes/auth.ts", "lineNumber": 18,
      "lineContent": "router.post('/login', rateLimit(5), loginController.handle);",  // EXACT line text
      "symbol": "loginController.handle",
      "mapRef": "auth-session#2a"                             // overview maps: link to a detailed map
    }],
    "tree": [{ "ref": "1a", "children": [
      { "label": "Parse JSON body" },                         // label-only intermediate step
      { "ref": "1b", "via": "if under limit" }                // edge label: data/condition that flows
    ]}]
  }],
  "links": [{ "from": "1b", "to": "2a", "label": "credentials" }]  // data flowing between traces
}
```

## Quality bar (what `waymark_lint` and reviewers check)

- **Every anchored node is a line you read.** `lineContent` must be the exact text; Waymark re-anchors moved lines with it.
- **Pick lines that carry understanding:** the definition ("B does X"), the call site ("A hands off to B"), the deciding branch, the state write. Skip boilerplate.
- **Trees read like a whiteboard sketch:** children = what the parent calls/contains/triggers, in execution order; label-only nodes for meaningful steps without an anchor; `via` for what flows.
- **Storytelling, not API docs:** start from the *why*, follow the data, make cause and effect explicit, name trade-offs and gotchas. Cite nodes (`[1a]`, `[2e, 3e]`) so every claim is clickable. Only cite ids that exist.
- **Every node cited in its trace's `details`**; every node placed in the tree.
- **One language** for all prose (titles, labels and `via` included); code identifiers stay as they are.
- **Size:** fast = 1-3 traces × 3-6 nodes; smart = 2-6 traces × 4-12 nodes.
