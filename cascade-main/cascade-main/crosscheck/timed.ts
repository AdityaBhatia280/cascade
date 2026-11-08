// Timed what-if: does a thermal "down" survive an overload trip that sheds load first?
import { analyze } from '../core/src/analysis/analysis.js';
import { assemble } from '../core/src/facility/assemble.js';
import { siteId, tagOf } from '../core/src/facility/ids.js';
import { loadDfw1 } from '../core/src/testing/dfw1.js';

const docs = loadDfw1();
const { facility } = assemble({ site: siteId('dfw1'), statements: docs.statements, completed: [] });
const an = analyze(facility);
const all = [...facility.list('switchgear'), ...facility.list('ats'), ...facility.list('loop'), ...facility.list('breaker')];
for (const tag of process.argv.slice(2)) {
  const id = all.find((e) => tagOf(e.id) === tag)!.id;
  const r = an.whatIf({ events: [{ target: id, how: 'fails', atMin: 0 }] });
  const notable = r.timeline
    .filter((t) => t.cause.kind === 'overload' || t.cause.kind === 'thermal')
    .map((t) => {
      const c = t.cause as { kind: string; deficitKw?: number; loadKw?: number; ratedKw?: number };
      return `t=${t.tMin} ${tagOf(t.id)} ${t.state} ${c.kind}${c.deficitKw !== undefined ? ` deficit ${c.deficitKw}` : ''}${c.loadKw !== undefined ? ` ${c.loadKw}/${c.ratedKw} kW` : ''}`;
    });
  const last = r.moments.at(-1)!;
  console.log(`\n${tag}: revenue exposed $${r.revenueExposed}/mo`);
  console.log([...new Set(notable)].slice(0, 6).join('\n'));
  console.log('final:', last.customers.map((c) => `${tagOf(c.customer)} ${c.state} ${c.cabinets.length}`).join(', '));
}
