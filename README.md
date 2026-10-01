# Waymark

[![ci](https://github.com/h0w4r/waymark/actions/workflows/ci.yml/badge.svg)](https://github.com/h0w4r/waymark/actions/workflows/ci.yml)

> *waymark*: marca que señala el camino en una ruta.

Réplica abierta de [Devin Codemaps](https://docs.devin.ai/desktop/codemaps) para cualquier harness agéntico: mapas **jerárquicos y anclados a líneas** de cómo se ejecuta el código (trazas → nodos numerados `1a, 1b…` → `archivo:línea`), con guía, diagrama y un visor HTML compartible. Funciona en **Claude Code**, **Codex CLI / IDE / desktop** y cualquier cliente MCP.

```
┌──────── harness (Claude Code, Codex CLI/desktop, Cursor, Agent SDK, CI…) ────────┐
│  agente "waymark" (subagente / skill)  ── explora en solo-lectura ──┐            │
└─────────────────────────────────────────────────────────────────────┼────────────┘
                               MCP (stdio)                            │
┌─ waymark-mcp ───────────────────────────────────────────────────────▼────────────┐
│ waymark_start → waymark_create ─► normalizar ─► ANCLAR contra el código real      │
│                                     (líneas movidas, archivos renombrados)        │
│ resource waymark://<id>  (@-mention)        waymark_verify (drift / CI)           │
└────────────► .waymark/<id>.json  +  .waymark/<id>.html (visor) ◄─────────────────┘
```

## Paridad con Devin Codemaps

| Devin Codemaps | Waymark |
|---|---|
| Agente especializado que explora el repo | Subagente `waymark` (Claude Code y Codex), skill `waymark`, tool `waymark_start`, o `waymark generate` headless (`claude -p` / `codex exec`) |
| Vista jerárquica de ejecución y relaciones | Trazas con `tree` anidado (+ nodos-etiqueta), `links` entre trazas, diagrama Mermaid |
| Click en un nodo → archivo y función | Visor: snippet con línea resaltada, *Open in editor* (VS Code/Cursor/Windsurf/JetBrains) y *View on remote* (GitHub/GitLab/Bitbucket/Azure, fijado al commit) |
| Sugerencias según historial de navegación | `waymark_suggest_topics`: archivos sin commitear + commits recientes + entry points |
| Crear desde una conversación | `/waymark from-chat` · `$waymark from-chat` |
| Compartir como link | HTML autocontenido (offline; sólo el diagrama usa CDN). Deep-links `#1a` |
| `@`-mention como contexto | Claude Code: `@waymark:waymark://<id>`. Codex y otros: `waymark_get(id)` |
| — | **Extra:** cada nodo se verifica contra el código (`lineContent` exacto) y se re-ancla; `waymark verify --strict` detecta mapas desactualizados en CI |

Diferencias: no hay panel nativo en el IDE (el visor es HTML + links al editor) y el "historial de navegación" se aproxima con git.

## Instalación

```bash
git clone https://github.com/h0w4r/waymark.git
cd waymark && npm install
npm link            # opcional: deja `waymark` y `waymark-mcp` en el PATH
```

En el repo donde quieras usarlo:

```bash
waymark install --target <ruta-del-repo>        # o: node <waymark>/src/cli.js install …
```

Escribe (respetando archivos que no son suyos y sin duplicar en reinstalaciones):

| Archivo | Para |
|---|---|
| `.mcp.json` | Claude Code: servidor MCP `waymark` |
| `.claude/agents/waymark.md`, `.claude/commands/waymark.md`, `.claude/skills/waymark/` | Claude Code: subagente, `/waymark`, skill |
| `.codex/config.toml` (bloque gestionado) | Codex: servidor MCP `waymark` a nivel proyecto |
| `.codex/agents/waymark.toml` | Codex: subagente `waymark` (sandbox read-only) |
| `.agents/skills/waymark/` (+ `agents/openai.yaml`) | Codex: skill `$waymark` |
| `AGENTS.md` (sección gestionada) | Codex y cualquier harness que lea AGENTS.md |

Flags: `--no-claude`, `--no-codex`, `--no-agents-md`, `--global-bin` (usa el bin `waymark-mcp` tras `npm link`), `--codex-global`.

### Codex CLI, IDE y desktop

Los tres comparten `~/.codex/config.toml` y además leen `.codex/config.toml` del proyecto **solo si el proyecto es de confianza** (Codex lo pregunta al abrir la carpeta).

- **Por proyecto** (lo que hace `install`): abre la carpeta en Codex y acepta "trust". Usa `$waymark <tema>` o `/skills`.
- **Global** (recomendado para Codex desktop, sirve en cualquier workspace):
  ```bash
  waymark install --target <repo> --codex-global
  ```
  Añade un bloque gestionado `[mcp_servers.waymark]` al final de `~/.codex/config.toml` (con backup previo; no reformatea el resto del archivo, a diferencia de `codex mcp add`) y copia la skill a `~/.agents/skills/waymark`. El servidor resuelve el repo abierto solo (workspace del cliente vía MCP roots, `cwd`, o el argumento `root`).
- **Subagente**: requiere `[features] multi_agent = true` en tu config de Codex; sin eso la skill hace el trabajo en el hilo principal.
- Las tools de solo lectura declaran `readOnlyHint`; si quieres que Codex no pregunte por las de escritura, añade `default_tools_approval_mode = "approve"` al bloque `[mcp_servers.waymark]`.

### Otros harnesses

- **Cursor / Windsurf / VS Code**: mismo bloque `mcpServers` de `.mcp.json` en su archivo de MCP.
- **Claude Agent SDK**: `mcpServers: { waymark: { command: "node", args: [".../src/mcp.js"] } }` y el prompt MCP `create_waymark` o la tool `waymark_start`.
- **Sin MCP**: `waymark guide "<tema>"` imprime el procedimiento; el agente escribe el JSON y ejecuta `waymark create map.json` (exit 2 si hay anclas sin verificar).

## Uso

| | Claude Code | Codex (CLI / IDE / desktop) |
|---|---|---|
| Crear | `/waymark cómo funciona el checkout` | `$waymark cómo funciona el checkout` |
| Sugerencias | `/waymark` | `$waymark` |
| Listar / ver | `/waymark list` · `/waymark show <id>` | `$waymark list` · `$waymark show <id>` |
| Drift | `/waymark verify` | `$waymark verify` |
| Como contexto | `@waymark:waymark://<id>` | "usa el mapa `<id>`" → `waymark_get` |

CLI:

```bash
waymark generate "how does auth work?" --open                 # claude si está instalado, si no codex
waymark generate "how does auth work?" --engine codex -m <modelo>
waymark list
waymark show <id> --format compact|markdown|json|mermaid
waymark verify [id] --fix [--strict]
waymark render <id> --open
waymark suggest
```

`generate --engine codex` ejecuta `codex exec --sandbox read-only` inyectando el servidor con `-c mcp_servers.waymark.*` (no toca tu config global); el agente sólo lee y el servidor MCP —fuera del sandbox— escribe en `.waymark/`.

### CI (detectar mapas desactualizados)

```yaml
- run: npx waymark verify --strict   # falla si algún nodo ya no existe o se movió
```

## Herramientas MCP

| Tool | Para qué |
|---|---|
| `waymark_start(query)` | Procedimiento del agente + formato + pistas del repo + mapas existentes |
| `waymark_create({...map, id?})` | Valida, ancla, guarda JSON+HTML; devuelve reporte de anclas |
| `waymark_find_anchor(path, pattern)` | Líneas exactas para anclar |
| `waymark_get(id, format)` / resource `waymark://{id}` | Mapa como contexto |
| `waymark_verify(id?, fix?)` | Drift: líneas movidas, archivos renombrados, código borrado |
| `waymark_suggest_topics`, `waymark_list`, `waymark_render`, `waymark_delete` | — |

Todas aceptan `root` opcional. Estados de ancla: `ok`, `moved`, `relocated` (archivo renombrado), `fuzzy` (revisar), `unresolved`, `missing`. Las rutas fuera del repo se rechazan.

## Formato

Ver `src/schema.js` y el ejemplo en `src/guide.js`:

```jsonc
{
  "title": "...", "description": "...", "query": "...",
  "traces": [{
    "id": "1", "title": "...", "description": "...",
    "locations": [{ "id": "1a", "title": "...", "description": "...",
                    "path": "src/x.ts", "lineNumber": 42, "lineContent": "exact line text", "symbol": "fn" }],
    "tree": [{ "ref": "1a", "children": [{ "label": "async", "children": [{ "ref": "1b" }] }] }],
    "guide": "markdown que referencia [1a]"
  }],
  "links": [{ "from": "1b", "to": "2a", "label": "..." }]
}
```

Se recomienda commitear `.waymark/` para compartir los mapas con el equipo. Este repo incluye tres mapas de ejemplo sobre su propio código en [`.waymark/`](.waymark/) (dos generados con Claude Code y uno con Codex); CI los verifica con `verify --strict`.

## Licencia

MIT. Inspirado en Devin Codemaps; no afiliado a Cognition ni Windsurf.

## Desarrollo

```bash
npm test     # cliente MCP real contra el servidor sobre un repo git temporal + instalador
```
