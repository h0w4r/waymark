const nodeId = (id) => `n_${id.replace(/[^A-Za-z0-9]/g, '_')}`;
const esc = (s) => String(s).replace(/"/g, '#quot;').replace(/[<>]/g, (c) => (c === '<' ? '#lt;' : '#gt;'));

/** Flowchart: one subgraph per trace, edges follow the trace tree, plus cross-trace links. */
export function renderMermaid(doc, { clickable = false } = {}) {
  if (doc.diagram && !clickable) return doc.diagram;
  const out = ['flowchart TD'];
  const byId = new Map(doc.traces.flatMap((t) => t.locations.map((l) => [l.id, l])));
  let labelSeq = 0;

  for (const trace of doc.traces) {
    out.push(`  subgraph T${trace.id}["${trace.id}. ${esc(trace.title)}"]`);
    out.push('    direction TB');
    for (const loc of trace.locations) {
      const file = loc.path.split('/').pop();
      out.push(`    ${nodeId(loc.id)}["<b>${loc.id}</b> ${esc(loc.title)}<br/><small>${esc(file)}:${loc.lineNumber}</small>"]`);
    }
    const walk = (nodes, parent) => {
      for (const n of nodes || []) {
        let me = parent;
        if (n.ref && byId.has(n.ref)) me = nodeId(n.ref);
        else if (n.label) {
          me = `L${trace.id}_${labelSeq++}`;
          out.push(`    ${me}(["${esc(n.label)}"])`);
        }
        if (parent && me && me !== parent) out.push(`    ${parent} --> ${me}`);
        walk(n.children, me);
      }
    };
    walk(trace.tree, null);
    out.push('  end');
  }
  for (const link of doc.links || []) {
    const label = link.label ? `|"${esc(link.label)}"|` : '';
    out.push(`  ${nodeId(link.from)} -.->${label} ${nodeId(link.to)}`);
  }
  if (clickable) {
    for (const id of byId.keys()) out.push(`  click ${nodeId(id)} call waymarkSelect("${id}")`);
  }
  return out.join('\n');
}
