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

### Opción recomendada: plugin de Claude Code (sin clonar nada)

```text
/plugin install waymark --marketplace h0w4r/waymark
```

(En versiones anteriores a 2.1.275: `/plugin marketplace add h0w4r/waymark` y luego `/plugin install waymark@waymark`.)

El plugin trae todo empaquetado (servidor MCP, CLI y hooks en `plugin/dist/waymark.mjs`, sin `node_modules`), la skill `/waymark` y el subagente. Se actualiza con `/plugin marketplace update waymark` (o con auto-update). **Usa el plugin o la instalación desde el clon, no ambos** (duplicarías servidor y hooks).

### Desde el clon (desarrollo, Codex, otros harnesses)

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

## Instalar y actualizar (sin agente)

Waymark tiene dos piezas que se actualizan distinto:

| Pieza | Dónde vive | Cómo se actualiza |
|---|---|---|
| **MCP + CLI + hooks + skill** | se ejecutan **directamente desde tu clon** del repo (las configs apuntan a `<clon>/src/…`) | `git pull` en el clon. Si cambiaron la skill, el subagente o los hooks, vuelve a correr el install |
| **Extensión de VS Code** | instalada en VS Code (`~/.vscode/extensions`) a partir de un `.vsix` | instalar el `.vsix` nuevo (VS Code reemplaza la versión anterior) |

**Opción A — un solo comando desde el clon** (MCP, skill, hooks y extensión):

```bash
cd <clon-de-waymark>
npm run update          # = waymark update --claude-global --vscode
```

`waymark update` hace `git pull --ff-only`, corre `npm ci` si cambió el lockfile, reinstala la skill/subagente/hooks de Claude Code y empaqueta e instala la extensión. Se niega a actualizar si tienes cambios sin commitear en el clon.

**Opción B — sólo la extensión, desde el clon:**

```bash
npm run vscode:install  # empaqueta vscode/ y ejecuta code --install-extension <vsix> --force
```

**Opción C — sin clonar nada, desde GitHub Releases:**

1. Descarga `waymark-vscode-<versión>.vsix` de la página de [Releases](https://github.com/h0w4r/waymark/releases).
2. En VS Code: vista *Extensions* → menú `…` → **Install from VSIX…** → elige el archivo. O en una terminal:
   ```bash
   code --install-extension waymark-vscode-0.2.0.vsix --force
   ```
   (Cursor: `cursor --install-extension …`; Windsurf: `windsurf --install-extension …`.)
3. *Developer: Reload Window*.

**Opción D — automática:** la extensión consulta GitHub Releases una vez al día; si hay una versión más nueva muestra *"Waymark X is available"* → **Install** → **Reload**. También a mano con *Waymark: Check for updates*. Se desactiva con `waymark.updates.check: false`.

Desinstalar: `code --uninstall-extension h0w4r.waymark-vscode`.

### Canales de distribución

| Canal | Estado | Qué hace falta |
|---|---|---|
| Plugin de Claude Code (marketplace en este repo) | ✅ activo | nada |
| GitHub Releases (`.vsix`) + auto-update de la extensión | ✅ activo | nada |
| VS Code Marketplace | listo en CI | secreto `VSCE_PAT` (publisher `h0w4r` en marketplace.visualstudio.com + PAT de Azure DevOps con scope *Marketplace › Manage*) |
| Open VSX (Cursor, Windsurf, VSCodium) | listo en CI | secreto `OVSX_PAT` (cuenta en open-vsx.org + namespace `h0w4r`) |
| npm (`@h0w4r/waymark`) | listo en CI | secreto `NPM_TOKEN` (token *Automation* de npmjs.com) |

Cada secreto se agrega en GitHub → *Settings › Secrets and variables › Actions*; el siguiente tag publica en ese canal automáticamente.

### Publicar una versión nueva (mantenedores)

```bash
npm run version:set -- 0.3.0           # versión en package.json, vscode, servidor MCP y plugin (y reconstruye plugin/dist)
git commit -am "Release v0.3.0"
git tag v0.3.0
git push && git push origin v0.3.0
```

El workflow [`release`](.github/workflows/release.yml) corre los tests, comprueba que las versiones coinciden con el tag, empaqueta el `.vsix` y crea el GitHub Release con el archivo adjunto. A partir de ahí la opción D lo ofrece a todas las extensiones instaladas.

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

### Skill portable `using-waymark` (cualquier agente, cualquier harness)

[`skills/using-waymark`](skills/using-waymark/SKILL.md) es el *playbook* que un agente sigue **por iniciativa propia** mientras trabaja: antes de editar un archivo cubierto por un mapa, al depurar, al revisar un PR, al refactorizar, al terminar un cambio (verificar/refrescar), al hacer onboarding o un hand-off. La skill `waymark` sigue siendo la de los comandos que pide el usuario (`/waymark <tema>`, `list`, `check`…).

- `SKILL.md`: tabla situación → acción, cómo interpretar las señales de confianza (anclas, drift, fact-check, ejecución) y las reglas.
- `references/`: playbooks paso a paso (`workflows.md`), todas las tools MCP con su gemelo CLI (`tools.md`), el formato del mapa (`map-format.md`) y cómo conectarla en cada harness (`harnesses.md`).
- `scripts/wm.mjs`: wrapper del CLI para harnesses **sin MCP** (`node <skill>/scripts/wm.mjs for-file src/app.ts 42`). Resuelve el CLI en este orden: `WAYMARK_CLI`, `wm.config.json` (lo escribe el instalador), el bundle del plugin, el clon del repo, `waymark` en el PATH y por último `npx github:h0w4r/waymark`. `wm.mjs where` muestra cuál usó.

Se instala sola con `--claude-global` (`~/.claude/skills/using-waymark`), `--codex-global` (`~/.agents/skills/using-waymark`), la instalación por proyecto (`.claude/skills`, `.agents/skills`) y el plugin. Para cualquier otro harness que lea skills de una carpeta:

```bash
node src/cli.js install --no-claude --no-codex --no-agents-md --skill-dir <carpeta-de-skills-del-harness>
```

Si el harness no soporta skills, pega `SKILL.md` en su archivo de reglas (AGENTS.md, `.cursor/rules`, etc.) y deja el resto de la carpeta accesible.

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

### Verificar las afirmaciones (fact-check)

`/waymark check <id>` (o `waymark check <id>`) lanza un agente **distinto** del que escribió el mapa, en modo escéptico: abre el código de cada nodo, contrasta cada afirmación (qué llama a qué, datos, condiciones, efectos), **corrige** la prosa errónea y registra un veredicto por nodo, guía y historia: ✓ `supported`, ◑ `partial` (no verificable desde el código) o ✗ `unsupported`. El veredicto queda atado al código y a la prosa que juzgó: si cualquiera cambia, pasa a "sin verificar". `unsupported` es error de `lint`. En el visor: insignias ✓/◑/✗ y chip "N/M verified".

### Generación en paralelo

`waymark generate "<tema>" --parallel [--jobs 4] [--coordinator-model sonnet]`: un agente planifica las trazas, uno por traza las construye **a la vez** (cada uno con su propio contexto, así cada traza sale más profunda) y un editor final escribe la historia y los enlaces. En Claude Code la skill hace lo mismo con subagentes en paralelo (`waymark_plan` → `waymark_add_trace` × N → `waymark_finalize`). En mapas medianos el tiempo total es similar al secuencial (plan + cierre ≈ 2 min fijos); la ganancia es profundidad y que mapas grandes no saturan el contexto de un solo agente.

### Impacto de cambios y PRs

```bash
waymark diff                       # cambios sin commitear
waymark diff origin/main --range   # una rama o PR
waymark install --pr-action        # .github/workflows/waymark-pr.yml en tu repo
```

Cruza las líneas cambiadas con el **bloque** de código de cada nodo y lista nodos tocados, anclas rotas y prosa a revisar. La GitHub Action publica (y actualiza) un comentario en cada PR. `--fail-on touched|broken|drift` para usarlo como gate.

### Notas humanas

Conocimiento del equipo que la IA no reescribe nunca: `waymark note <id> <nodo> "texto"`, botón **+ Note** en el visor, *Waymark: Add team note* / hover en VS Code, o `waymark_note`. Sobreviven a que el agente regenere el mapa y aparecen en el contexto que reciben los agentes (incluidos los hooks).

### Verificado por ejecución

```bash
waymark exec <id> -- npm test               # Node/JS: cobertura V8 (incluye procesos hijos)
waymark exec <id> --lcov coverage/lcov.info # cualquier lenguaje con LCOV (Jest, coverage.py, JaCoCo…)
```

Marca qué nodos **se ejecutaron realmente** en los tests (▶) y cuáles no (○). Igual que los veredictos, el resultado caduca si el código del nodo cambia.

### Mapa de mapas

`/waymark overview` o `waymark generate "<tema>" --overview`: un mapa de arquitectura (`kind: "overview"`) cuyos nodos enlazan (`mapRef`) a los mapas detallados; abrirlos es un clic (o doble clic en el diagrama). `.waymark/index.html` lista todos los mapas con su salud (verificados, ejecutados, a revisar), con el overview primero.

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
