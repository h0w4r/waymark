import { spawn } from 'node:child_process';

/** Opens a file with the OS default handler (browser for .html). */
export function openFile(p) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', `"${p}"`]]
      : process.platform === 'darwin'
        ? ['open', [p]]
        : ['xdg-open', [p]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: process.platform === 'win32' }).unref();
}
