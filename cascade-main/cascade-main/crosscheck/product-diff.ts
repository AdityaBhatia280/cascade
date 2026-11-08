// What a facilities manager sees: audit findings and this week's work-order grades.
// Run from a checkout's root; diff the output of two checkouts.
import { analyze } from '../core/src/analysis/analysis.js';
import { assemble } from '../core/src/facility/assemble.js';
import { siteId } from '../core/src/facility/ids.js';
import { loadDfw1 } from '../core/src/testing/dfw1.js';
import { assessWorkOrders } from '../core/src/maintenance/assessment.js';
import { upcomingWorkOrders, workOrdersOf } from '../core/src/maintenance/work-orders.js';

const docs = loadDfw1();
const { facility } = assemble({ site: siteId('dfw1'), statements: docs.statements, completed: [] });
const an = analyze(facility);
for (const x of an.audit().findings) console.log('finding', x.id, x.certainty, `${x.cabinets?.length ?? ''}`);
const all = workOrdersOf(docs.documents, facility);
for (const a of assessWorkOrders(an, upcomingWorkOrders(all, '2026-11-08T00:00'), all)) console.log('wo', a.workOrder.wonum, a.assessed ? a.grade : null);
