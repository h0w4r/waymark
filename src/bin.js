import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolves a CLI so it can be spawned without a shell (no quoting issues with long prompts).
 * On Windows, npm installs `.cmd` shims; we unwrap them to `node <script.js>`. Other `.cmd`
 * launchers (e.g. VS Code's code.cmd, which needs Electron) run through the shell, quoted.
 */
export function resolveCommand(name) {
  if (process.platform !== 'win32') return { command: name, args: [] };
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const exe = path.join(dir, `${name}.exe`);
    if (fs.existsSync(exe)) return { command: exe, args: [] };
    const cmd = path.join(dir, `${name}.cmd`);
    if (fs.existsSync(cmd)) {
      const text = fs.readFileSync(cmd, 'utf8');
      if (!/ELECTRON_RUN_AS_NODE|\.exe"\s+"%~dp0/i.test(text)) {
        // npm shims reference their entry script relative to %~dp0 (quoted or inside SET "X=...").
        const scripts = [...text.matchAll(/%~?dp0%?\\?([^"%\s]+\.(?:c|m)?js)/gi)].map((m) => m[1]).filter((p) => !/prefix/i.test(p));
        if (scripts.length) return { command: process.execPath, args: [path.join(dir, scripts[scripts.length - 1])] };
      }
      return { command: `"${cmd}"`, args: [], shell: true };
    }
  }
  return null;
}

/** Arguments for a resolved command: quoted when it has to go through the Windows shell. */
export function argsFor(bin, args) {
  const all = [...bin.args, ...args];
  if (!bin.shell) return all;
  return all.map((a) => (/[\s"&|<>^]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a));
}
