// Dumps the engine's answer to "fail X alone, steady state: what happens to each cabinet?"
// for every power/cooling component in the assembled DFW1 model. The oracle in oracle.py answers
// the same question from the raw documents with no shared code; compare.py diffs the two.
import { writeFileSync } from 'node:fs';
import { analyze } from '../core/src/analysis/analysis.js';
import { assemble } from '../core/src/facility/assemble.js';
import { siteId, tagOf, kindOf } from '../core/src/facility/ids.js';
import { loadDfw1 } from '../core/src/testing/dfw1.js';
import { internalsOf } from '../core/src/analysis/analysis.js';
import { propagate } from '../core/src/physics/supply.js';

const docs = loadDfw1();
const { facility } = assemble({ site: siteId('dfw1'), statements: docs.statements, completed: [] });
const an = analyze(facility);
const g = internalsOf(an).graph;

const cabinets = [...g.nodes.values()].filter((n) => n.supply.rule === 'any-cord').map((n) => n.id);
const skip = new Set(['cabinet', 'cord', 'customer', 'contract', 'site', 'room', 'hall', 'zone']);
const components = [...g.nodes.keys()].filter((id) => !skip.has(kindOf(id)));

const baseline: Record<string, string> = {};
{
  const p = propagate(g, [], { timed: false });
  for (const c of cabinets) baseline[tagOf(c)] = p.final.get(c)?.state ?? 'up';
}

const runs: Record<string, Record<string, string>> = {};
for (const x of components) {
  const p = propagate(g, [{ target: x, how: 'fails', atMin: 0 }], { timed: false });
  const hit: Record<string, string> = {};
  for (const c of cabinets) {
    const s = p.final.get(c)?.state ?? 'up';
    if (s !== 'up') hit[tagOf(c)] = s;
  }
  runs[`${kindOf(x)}:${tagOf(x)}`] = hit;
}

// Per cord: which circuit/panel the engine landed it on (after source precedence).
const cords: Record<string, string[]> = {};
for (const c of cabinets) {
  const s = g.nodes.get(c)!.supply;
  if (s.rule !== 'any-cord') continue;
  for (const cord of s.cords) {
    const n = g.nodes.get(cord)!.supply;
    cords[tagOf(cord)] = n.rule === 'series' ? n.input.to.map(tagOf) : [];
  }
}
writeFileSync(new URL('./engine.json', import.meta.url), JSON.stringify({ baseline, runs, cords }, null, 1));
console.log(`components ${components.length}, cabinets ${cabinets.length}`);
