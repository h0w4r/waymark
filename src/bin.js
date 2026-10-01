import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolves a CLI so it can be spawned without a shell (no quoting issues with long prompts).
 * On Windows, npm installs `.cmd`/`.ps1` shims; we unwrap them to `node <script.js>`.
 */
export function resolveCommand(name) {
  if (process.platform !== 'win32') return { command: name, args: [] };
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const exe = path.join(dir, `${name}.exe`);
    if (fs.existsSync(exe)) return { command: exe, args: [] };
    const cmd = path.join(dir, `${name}.cmd`);
    if (fs.existsSync(cmd)) {
      const m = fs.readFileSync(cmd, 'utf8').match(/"%~?dp0%?\\([^"]+\.(?:c|m)?js)"/i);
      if (m) return { command: process.execPath, args: [path.join(dir, m[1])] };
      return { command: cmd, args: [], shell: true };
    }
  }
  return null;
}
