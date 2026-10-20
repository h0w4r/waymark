# Waymark

[![ci](https://github.com/h0w4r/waymark/actions/workflows/ci.yml/badge.svg)](https://github.com/h0w4r/waymark/actions/workflows/ci.yml)

> *waymark*: marca que señala el camino en una ruta.

Réplica abierta de [Devin Codemaps](https://docs.devin.ai/desktop/codemaps) para cualquier harness agéntico: mapas **jerárquicos, narrados y anclados a líneas** de cómo se ejecuta el código (trazas → nodos numerados `1a, 1b…` → `archivo:línea`), con una historia holística, guías *Motivation/Details* por traza, una explicación tipo storytelling por nodo, un visor de código con los archivos embebidos y un diagrama interactivo. Funciona en **Claude Code**, **Codex CLI / IDE / desktop** y cualquier cliente MCP.

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
| Modos *Fast* / *Smart* | `mode: "fast" \| "smart"` en `waymark_start`, `--mode` en `generate`, `--fast` en la skill |
| Resumen del mapa con referencias `[1b]`, `[2e, 3e]` | `description` con referencias clicables (también listas `[2e, 3e]`) |
| Narrativa holística | `story`: la historia completa del sistema (problema → recorrido → cómo encaja → takeaways), botón *Read the full story* |
| *See more* → "AI generated guide" con **Motivation** y **Details** | `motivation` + `details` por traza, mismo layout |
| Explicación por nodo | `explanation` (3-6 frases, storytelling) en cada nodo; botón **Explain** en la tarjeta, en la anotación del código y en el diagrama; *Explain all nodes* |
| Árbol anotado por traza (nodos anclados + pasos intermedios) | `tree` con nodos-etiqueta, referencias repetidas, `diagramTitle` y aristas etiquetadas `via` |
| Visor de código: pestañas por archivo, marcadores en el canalón, anotación "← prev · next →" | Igual, con los **archivos completos embebidos** en el HTML (snapshot) |
| Diagrama visual con clusters por traza; click → código | **Diagrama interactivo propio (sin CDN)**: pan/zoom, cajas de color por traza, aristas con etiqueta, enlaces entre trazas, foco de ruta (atenúa el resto), tooltip, tarjeta de detalle con explicación y código, leyenda para ocultar trazas, doble click → código |
| Sugerencias según historial de navegación | `waymark_suggest_topics`: archivos sin commitear + commits recientes + entry points |
| Crear desde una conversación | `/waymark from-chat` · `$waymark from-chat` |
| Compartir como link | HTML autocontenido 100% offline. Deep-links `#1a` |
| `@`-mention como contexto | Claude Code: `@waymark:waymark://<id>`. Codex y otros: `waymark_get(id)` (incluye la narrativa) |
| — | **Extra:** `/waymark enrich <id>` añade el storytelling a mapas existentes; `waymark_annotate` edita la prosa sin re-anclar |
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
| `.claude/agents/waymark.md`, `.claude/skills/waymark/` | Claude Code: subagente y skill (aparece como `/waymark`) |
| `.codex/config.toml` (bloque gestionado) | Codex: servidor MCP `waymark` a nivel proyecto |
| `.codex/agents/waymark.toml` | Codex: subagente `waymark` (sandbox read-only) |
| `.agents/skills/waymark/` (+ `agents/openai.yaml`) | Codex: skill `$waymark` |
| `AGENTS.md` (sección gestionada) | Codex y cualquier harness que lea AGENTS.md |

Flags: `--no-claude`, `--no-codex`, `--no-agents-md`, `--global-bin` (usa el bin `waymark-mcp` tras `npm link`), `--claude-global`, `--codex-global`, `--global` (ambos).

> **¿No ves `/waymark`?** La instalación por defecto es **por proyecto**: sólo aparece en el repo donde corriste `install` (y en la CLI el servidor de `.mcp.json` queda *pending approval* hasta que lo apruebas). Para tenerlo en **todos** tus proyectos usa el modo global.

### Claude Code (global)

```bash
waymark install --claude-global
```

Registra el servidor con `claude mcp add -s user waymark …` (disponible en todos los proyectos, sin aprobación por repo), copia la skill y el subagente a `~/.claude/skills/waymark` y `~/.claude/agents/waymark.md`, y añade los **hooks** a `~/.claude/settings.json` (con backup, sin tocar tus otros hooks; `--no-hooks` para omitirlos). Abre una sesión nueva y escribe `/waymark`.

**Hooks (los mapas como memoria del agente):**

| Cuándo | Qué hace |
|---|---|
| El agente **lee** un archivo cubierto por un mapa (`PostToolUse Read`) | Le inyecta las trazas a las que pertenece ese archivo (árbol + descripciones + explicación del nodo más cercano), una vez por sesión |
| Antes de **editarlo** (`PreToolUse Edit/Write`) | Igual si aún no lo vio; si ya lo vio, un recordatorio corto |
| Después de **editarlo** (`PostToolUse Edit/Write`) | Re-ancla los mapas y avisa qué nodos quedaron con la explicación desactualizada (→ `waymark_refresh`) |

Nunca bloquean la herramienta y fallan en silencio.

### Extensión de VS Code (también Cursor / Windsurf)

```bash
waymark install --vscode      # empaqueta vscode/ como VSIX y lo instala con `code`
```

- Vista **Waymark** en la Activity Bar: mapa → traza → nodo (marca los nodos a revisar).
- **Marcas en el margen** (`1a`, `2b`… con el color de la traza) y **hover** con la explicación.
- **CodeLens** sobre cada línea anclada del mapa activo: `2b · descripción · Explain · ← prev · next →`.
- **`Alt+]` / `Alt+[`** recorren los nodos del mapa activo.
- **Visor embebido** sincronizado en ambos sentidos (nodo → editor, cursor → nodo).
- **Historial de navegación** (en `.waymark/.local/`, ignorado por git) que alimenta las sugerencias de `/waymark`.
- Comandos que lanzan `claude "/waymark …"` (crear, añadir storytelling, refrescar explicaciones, verificar).

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
| Crear (smart) | `/waymark cómo funciona el checkout` | `$waymark cómo funciona el checkout` |
| Crear rápido | `/waymark cómo funciona el checkout --fast` | `$waymark … --fast` |
| Añadir storytelling a un mapa existente | `/waymark enrich <id>` | `$waymark enrich <id>` |
| Sugerencias | `/waymark` | `$waymark` |
| Listar / ver | `/waymark list` · `/waymark show <id>` | `$waymark list` · `$waymark show <id>` |
| Drift (anclas + narrativa) | `/waymark verify` | `$waymark verify` |
| Reescribir explicaciones desactualizadas | `/waymark refresh <id>` | `$waymark refresh <id>` |
| Calidad de la narrativa | `/waymark lint` | `$waymark lint` |
| Como contexto | `@waymark:waymark://<id>`, una traza `…/<id>/2` o un nodo `…/<id>/2b` | `waymark_get(id, trace?, node?)` |

CLI:

```bash
waymark generate "how does auth work?" --open                 # claude si está instalado, si no codex
waymark generate "how does auth work?" --engine codex -m <modelo> --mode fast
waymark enrich <id> --open                                     # añade story, Motivation/Details y explicaciones
waymark annotate <id> patch.json                               # edita la prosa sin re-anclar ("reviewed": ["2b"] confirma sin cambios)
waymark refresh <id>                                           # el agente reescribe sólo lo que quedó desactualizado
waymark lint [id] [--strict]                                   # [refs] rotas, nodos no citados, narrativa faltante…
waymark for-file src/x.ts [linea]                              # qué mapas/trazas/nodos cubren un archivo
waymark list
waymark show <id> --format compact|markdown|json|mermaid
waymark verify [id] --fix [--strict] [--strict-narrative]
waymark render <id> --open
waymark suggest
```

`generate --engine codex` ejecuta `codex exec --sandbox read-only` inyectando el servidor con `-c mcp_servers.waymark.*` (no toca tu config global); el agente sólo lee y el servidor MCP —fuera del sandbox— escribe en `.waymark/`.

### CI (detectar mapas desactualizados)

```yaml
- run: npx waymark verify --strict   # falla si algún nodo ya no existe o se movió
- run: npx waymark lint             # falla si la prosa cita nodos inexistentes
```

### Narrativa al día (drift narrativo)

Cada nodo guarda el hash del **bloque de código del que habla** (la línea + su cuerpo por indentación, o unas líneas hermanas si es una sentencia). Mover código no cuenta; **editarlo sí**. `verify` reporta los nodos, guías de traza e historia escritos para código que ya cambió; el visor y la extensión los marcan con ◔; `waymark refresh <id>` / `waymark_refresh` hace que el agente reescriba sólo eso (o lo confirme con `reviewed`).

## Herramientas MCP

| Tool | Para qué |
|---|---|
| `waymark_start(query, mode?)` | Procedimiento del agente (estructura + reglas de storytelling) + formato + pistas del repo + mapas existentes |
| `waymark_create({...map, id?})` | Valida, ancla, guarda JSON+HTML; devuelve reporte de anclas y de narrativa faltante |
| `waymark_annotate(id, {story, traces[], locations[]})` | Escribe/edita la prosa (story, motivation, details, explanation…) sin re-anclar |
| `waymark_enrich(id)` | Procedimiento + huecos de narrativa + mapa actual, para añadir storytelling a un mapa existente |
| `waymark_find_anchor(path, pattern)` | Líneas exactas para anclar |
| `waymark_get(id, format, trace?, node?)` / resources `waymark://{id}`, `waymark://{id}/{traza o nodo}` | Mapa (o sólo una traza / un nodo) como contexto |
| `waymark_for_file(path, line?)` | Qué mapas, trazas y nodos cubren un archivo, con la explicación del nodo más cercano |
| `waymark_verify(id?, fix?)` | Drift de anclas (líneas movidas, archivos renombrados, código borrado) y **drift narrativo** |
| `waymark_refresh(id)` | Procedimiento + nodos/guías a revisar para reescribir sólo la prosa desactualizada |
| `waymark_lint(id?)` | Calidad: referencias rotas, narrativa faltante, nodos no citados o fuera del árbol, textos demasiado largos |
| `waymark_suggest_topics`, `waymark_list`, `waymark_render`, `waymark_delete` | — |

Todas aceptan `root` opcional. Estados de ancla: `ok`, `moved`, `relocated` (archivo renombrado), `fuzzy` (revisar), `unresolved`, `missing`. Las rutas fuera del repo se rechazan.

## Formato

Ver `src/schema.js` y el ejemplo en `src/guide.js`:

```jsonc
{
  "title": "...", "query": "...", "language": "es",
  "description": "resumen de 2-3 frases que cita [1a], [2b, 2c]",
  "story": "historia holística en markdown (problema → recorrido → cómo encaja → takeaways)",
  "traces": [{
    "id": "1", "title": "...", "description": "una frase", "diagramTitle": "Título del árbol",
    "motivation": "por qué existe esta parte (markdown)",
    "details": "recorrido narrado que cita cada nodo [1a] (markdown)",
    "locations": [{ "id": "1a", "title": "≤ 5 palabras", "description": "una frase ≤ 15 palabras",
                    "explanation": "3-6 frases tipo storytelling (markdown)",
                    "path": "src/x.ts", "lineNumber": 42, "lineContent": "exact line text", "symbol": "fn" }],
    "tree": [{ "ref": "1a", "children": [{ "label": "paso intermedio" }, { "ref": "1b", "via": "devuelve el token" }] }]
  }],
  "links": [{ "from": "1b", "to": "2a", "label": "..." }]
}
```

Se recomienda commitear `.waymark/` para compartir los mapas con el equipo. Este repo incluye mapas de ejemplo sobre su propio código en [`.waymark/`](.waymark/) (generados con Claude Code y con Codex, uno en español con 49 nodos narrados); CI los verifica con `verify --strict`. Mapas antiguos sin narrativa siguen funcionando (`guide` se lee como `details`); `waymark enrich <id>` les añade el storytelling.

## Licencia

MIT. Inspirado en Devin Codemaps; no afiliado a Cognition ni Windsurf.

## Desarrollo

```bash
npm test     # cliente MCP real sobre repos git temporales, hooks, instalador, drift y la extensión de VS Code (con un stub de la API)
```
