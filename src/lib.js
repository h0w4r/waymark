// Library entry point (bundled to dist/lib.mjs): what editors and other tools embed.
export { saveMap, loadMap, listMaps, annotateMap, noteMap, recordCheck, recordExec, writeHtml, writeIndex, checkSummary } from './store.js';
export { verifyMap } from './verify.js';
export { diffMaps, renderDiff } from './diff.js';
export { mapsForFile, renderFileContext } from './context.js';
export { lintMap } from './lint.js';
export { applyCoverage, parseLcov, parseV8Dir } from './coverage.js';
export { renderMarkdown } from './render/markdown.js';
export { checkState, execState, proseHash } from './state.js';
export { resolveRoot } from './git.js';
