#!/usr/bin/env node
// Sets the same version in package.json (CLI/MCP) and vscode/package.json (extension).
// Usage: npm run version:set -- 0.3.0     (then commit, tag v0.3.0 and push the tag)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version || '')) {
  console.error('Usage: npm run version:set -- <x.y.z>');
  process.exit(1);
}
for (const rel of ['package.json', 'vscode/package.json']) {
  const file = path.join(root, rel);
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const prev = pkg.version;
  pkg.version = version;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`${rel}: ${prev} → ${version}`);
}
const VERSION_RE = /const VERSION = '[^']*';/;
const mcp = path.join(root, 'src', 'mcp.js');
fs.writeFileSync(mcp, fs.readFileSync(mcp, 'utf8').replace(VERSION_RE, `const VERSION = '${version}';`));
console.log(`src/mcp.js: VERSION → ${version}`);
console.log(`\nNext: git commit -am "Release v${version}" && git tag v${version} && git push && git push origin v${version}`);
