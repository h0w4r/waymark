import { execFileSync } from 'node:child_process';
import path from 'node:path';

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** Repo root: explicit arg > WAYMARK_ROOT > git toplevel of cwd > cwd. */
export function resolveRoot(root) {
  const start = path.resolve(root || process.env.WAYMARK_ROOT || process.cwd());
  const top = git(start, ['rev-parse', '--show-toplevel']);
  return path.resolve(top || start);
}

export function headCommit(root) {
  return git(root, ['rev-parse', 'HEAD']);
}

export function currentBranch(root) {
  return git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

/** Converts the origin remote into a browsable base URL, when it is a known host. */
export function remoteWebUrl(root) {
  let url = git(root, ['remote', 'get-url', 'origin']);
  if (!url) return null;
  url = url.replace(/\.git$/, '');
  const ssh = url.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/);
  if (ssh) url = `https://${ssh[1]}/${ssh[2]}`;
  url = url.replace(/^https?:\/\/[^@/]+@/, 'https://'); // drop embedded credentials
  if (!/^https?:\/\//.test(url)) return null;
  return url;
}

/** Permalink for a file/line on the remote host, pinned to a commit. */
export function permalink(webUrl, commit, file, line) {
  if (!webUrl || !commit) return null;
  if (/dev\.azure\.com|visualstudio\.com/.test(webUrl)) {
    return `${webUrl}?path=/${file}&version=GC${commit}&line=${line}&lineEnd=${line}&lineStartColumn=1&lineEndColumn=1`;
  }
  if (/bitbucket\./.test(webUrl)) return `${webUrl}/src/${commit}/${file}#lines-${line}`;
  if (/gitlab\./.test(webUrl)) return `${webUrl}/-/blob/${commit}/${file}#L${line}`;
  return `${webUrl}/blob/${commit}/${file}#L${line}`;
}

/** Files touched recently (uncommitted first, then recent commits), most relevant first. */
export function recentFiles(root, { days = 21, limit = 40 } = {}) {
  const scores = new Map();
  const bump = (f, s) => f && scores.set(f, (scores.get(f) || 0) + s);
  const status = git(root, ['status', '--porcelain']) || '';
  for (const line of status.split('\n')) bump(line.slice(3).trim().split(' -> ').pop(), 5);
  const log = git(root, ['log', `--since=${days}.days`, '-n', '200', '--name-only', '--pretty=format:']) || '';
  log.split('\n').forEach((f, i) => bump(f.trim(), 1 + 1 / (1 + i / 50)));
  return [...scores.entries()]
    .filter(([f]) => f && !f.startsWith('.waymark/'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([file, score]) => ({ file, score: Math.round(score * 10) / 10 }));
}

export function recentSubjects(root, n = 15) {
  const out = git(root, ['log', '-n', String(n), '--pretty=format:%s']);
  return out ? out.split('\n') : [];
}

export function trackedFiles(root) {
  const out = git(root, ['ls-files']);
  return out ? out.split('\n').filter(Boolean) : null;
}
