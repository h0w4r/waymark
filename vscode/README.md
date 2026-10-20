# Waymark for VS Code

Brings [Waymark](https://github.com/h0w4r/waymark) maps (narrated, line-anchored maps of how code executes) into the editor:

- **Maps view** in the Activity Bar: map → trace → node; click a node to jump to its line. Nodes whose code changed after they were explained are flagged.
- **Gutter markers** (`1a`, `2b`…) in each trace's colour on anchored lines, with the node's description and storytelling explanation on hover.
- **CodeLens walkthrough** above anchored lines of the active map: `2b · description · Explain · ← prev · next →`.
- **`Alt+]` / `Alt+[`** walk the active map's nodes in reading order.
- **Embedded viewer** (story, guides, explanations, code view, interactive diagram) synced both ways: selecting a node reveals it in the editor, moving the cursor onto an anchored line selects it in the viewer.
- **Navigation history** (kept in `.waymark/.local/`, git-ignored) so `/waymark` topic suggestions follow what you have been reading.
- **Agent commands** (create / add storytelling / refresh outdated explanations / verify) run `claude "/waymark …"` in a terminal (`waymark.agentCommand`).

Maps are created by your agent (`/waymark <topic>` in Claude Code); the extension only reads `.waymark/*.json` and the generated `.waymark/<id>.html`.
