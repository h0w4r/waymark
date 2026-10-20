#!/usr/bin/env node
// Builds the self-contained distribution:
//   plugin/dist/waymark.mjs  CLI + MCP server (all dependencies bundled, no node_modules needed)
//   plugin/dist/lib.mjs      library for editors (VS Code extension)
//   plugin/dist/viewer.*     viewer assets read at runtime
//   plugin/.claude-plugin/plugin.json, plugin/skills, plugin/agents   Claude Code plugin
//   vscode/dist/             copy of the bundle for the VSIX
// Usage: npm run build   (CI checks that plugin/ is committed up to date)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const plugin = path.join(root, 'plugin');
const dist = path.join(plugin, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// CommonJS dependencies inside an ESM bundle need `require`.
const banner = { js: "import { createRequire as __waymarkCreateRequire } from 'module'; const require = __waymarkCreateRequire(import.meta.url);" };
const common = { bundle: true, platform: 'node', format: 'esm', target: 'node20', banner, logLevel: 'warning', legalComments: 'none' };
await build({ ...common, entryPoints: [path.join(root, 'src', 'cli.js')], outfile: path.join(dist, 'waymark.mjs') });
await build({ ...common, entryPoints: [path.join(root, 'src', 'lib.js')], outfile: path.join(dist, 'lib.mjs') });
for (const f of ['viewer.css', 'viewer.client.js']) fs.copyFileSync(path.join(root, 'src', 'render', f), path.join(dist, f));

// Claude Code plugin: skill + agent from the same templates as `waymark install`.
const { pluginTemplates } = await import(new URL('../src/install.js', import.meta.url));
// Plugin MCP tools are exposed as mcp__plugin_<plugin>_<server>__<tool>.
const t = pluginTemplates('mcp__plugin_waymark_waymark__');
const strip = (s) => s.replace(/^<!-- waymark:managed -->\n/m, '');
fs.mkdirSync(path.join(plugin, 'skills', 'waymark'), { recursive: true });
fs.mkdirSync(path.join(plugin, 'agents'), { recursive: true });
fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
fs.writeFileSync(path.join(plugin, 'skills', 'waymark', 'SKILL.md'), strip(t.skill));
fs.writeFileSync(path.join(plugin, 'agents', 'waymark.md'), strip(t.agent));
// Portable playbook skill: its scripts/wm.mjs finds ../../../dist/waymark.mjs inside the plugin.
const playbook = path.join(plugin, 'skills', 'using-waymark');
fs.rmSync(playbook, { recursive: true, force: true });
fs.cpSync(path.join(root, 'skills', 'using-waymark'), playbook, {
  recursive: true,
  filter: (src) => path.basename(src) !== 'wm.config.json',
});

const hook = (kind) => ({ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/waymark.mjs', 'hook', kind], timeout: 20 });
const manifest = {
  name: 'waymark',
  displayName: 'Waymark',
  version: pkg.version,
  description: 'Narrated, line-anchored maps of how code executes: traces, storytelling guides, per-node explanations, fact-checking, interactive viewer, drift detection and agent hooks.',
  author: { name: 'h0w4r', url: 'https://github.com/h0w4r' },
  homepage: 'https://github.com/h0w4r/waymark',
  repository: 'https://github.com/h0w4r/waymark',
  license: 'MIT',
  keywords: ['codemap', 'code-map', 'architecture', 'onboarding', 'documentation', 'mcp'],
  mcpServers: {
    waymark: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/waymark.mjs', 'mcp'] },
  },
  hooks: {
    PreToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [hook('pre-edit')] }],
    PostToolUse: [
      { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [hook('post-edit')] },
      { matcher: 'Read', hooks: [hook('post-read')] },
    ],
  },
};
fs.writeFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');

// VSIX gets the same bundle (its own copy; not committed).
const vsDist = path.join(root, 'vscode', 'dist');
fs.rmSync(vsDist, { recursive: true, force: true });
fs.cpSync(dist, vsDist, { recursive: true });

const size = (f) => (fs.statSync(path.join(dist, f)).size / 1024).toFixed(0) + ' KB';
console.log(`built plugin ${pkg.version}: waymark.mjs ${size('waymark.mjs')}, lib.mjs ${size('lib.mjs')}`);
