// No-key mode: an ordered intent table over the same operations the model's tools call. The first
// intent whose pattern matches the last user message answers; the reply is code-written from the
// operation's result.

import type { AnyId } from '@cascade/core';
import type { CompanionAction, RiskGrade, WorkReasonKind } from '@cascade/core/contract';
import {
  auditTop, cabinetsOf, draftNotices, handoff, names, riskiest, submitFix, week, weekCheck, whatIf, whoText,
  type Done, type Job, type Names, type Sim, type Turn,
} from './ops.js';

export interface Answer {
  readonly reply: string;
  readonly actions: readonly CompanionAction[];
}

interface Intent {
  readonly name: string;
  readonly when: RegExp;
  answer(t: Turn, text: string, n: Names): Answer | Promise<Answer>;
}

const say = (d: Done<unknown>, reply: string): Answer => ({ reply, actions: d.actions });
const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

const VERDICT: { readonly [G in RiskGrade]: string } = {
  highest: 'This week is not safe.',
  high: 'This week needs care.',
  medium: 'This week is workable but thin.',
  low: 'This week looks safe.',
};

const VERB: { readonly [K in WorkReasonKind]: string } = {
  'loses-power': 'lose power',
  'loses-cooling': 'lose cooling',
  'one-cord-left': 'run on one cord',
  'new-single-fault': 'are one fault from losing power',
  'cooling-margin': 'lose spare cooling',
};

function jobSentence(j: Job): string {
  const when = j.when ? ` on ${j.when}` : '';
  if (!j.worst) return `With ${j.equipment} ${j.says}${when}, every unit stays backed up.`;
  return `With ${j.equipment} ${j.says}${when}, ${whoText(j.worst.who)} ${VERB[j.worst.kind]}.`;
}

function simSentence(s: Sim): string {
  const off = list([...s.off]);
  const last = cabinetsOf(s.exposed).length;
  const parts = [
    s.down.length > 0 ? `${whoText(s.down)} lose power` : '',
    last > 0 ? `${last}${s.down.length > 0 ? ' more' : ''} cabinet${last === 1 ? '' : 's'} run on their last feed` : '',
    s.unknown.length > 0 ? `the records cannot say whether ${whoText(s.unknown)} keep power` : '',
  ].filter((p) => p !== '');
  return parts.length === 0 ? `With ${off} off, every cabinet keeps power and cooling.` : `With ${off} off, ${list(parts)}.`;
}

/** Equipment named in the text, else the selection, else what the view has off, else this week's riskiest job's. */
function subject(t: Turn, text: string, n: Names): AnyId | null {
  return n.equipmentIn(text)[0] ?? t.selected ?? t.off[0] ?? (n.entity(riskiest(week(t))?.equipment ?? '') || null);
}

const INTENTS: readonly Intent[] = [
  {
    name: 'fix',
    when: /\b(fix|repair|resolve|re-?feed)\b/i,
    async answer(t, text, n) {
      const id = subject(t, text, n);
      if (!id) return { reply: 'Tell me which equipment to fix, for example "fix PDU-3A".', actions: [] };
      const r = await submitFix(t, id);
      const d = r.value.draft;
      if (d.kind === 'clear') return say(r, `${d.equipment} can already go off without any cabinet losing power, so there is nothing to fix.`);
      if (d.kind === 'no-plan') return say(r, `No cord or feeder move keeps ${whoText(d.down)} powered with ${d.equipment} off.`);
      if (r.value.proposalId === null) return say(r, `I could not queue the fix. ${r.value.error ?? ''}`.trim());
      const after = d.stillDown.length === 0 ? `so ${d.equipment} can go off without any cabinet losing power` : `but ${whoText(d.stillDown)} still lose power with ${d.equipment} off`;
      return say(r, `I queued a ${d.moves.length}-move fix for your approval. It will ${list([...d.moves])}, ${after}.`);
    },
  },
  {
    name: 'notices',
    when: /\b(notices?|notify|notification|letters?|emails?|tell (the )?customers?)\b/i,
    answer(t, text, n) {
      const wonum = n.wonumIn(text);
      const customer = n.customerIn(text);
      const equipment = n.equipmentIn(text)[0];
      const d = draftNotices(t, wonum ? { wonum } : customer ? { customer } : equipment ? { equipment } : null);
      const v = d.value;
      if (v.kind === 'none') return say(d, v.why);
      const job = `${v.job.wonum} (${v.job.equipment ?? v.job.what}${v.job.when ? `, ${v.job.when}` : ''})`;
      if (v.notices.length === 0) return say(d, v.focus ? `${v.focus} is not affected by ${job}.` : `No customer is affected by ${job}, so there is nothing to send.`);
      const blocked = v.notices.filter((x) => x.blocked !== null);
      if (v.focus) {
        const x = v.notices[0]!;
        return say(d, `I drafted the ${x.name} notice for ${job}, covering ${x.label}. ${x.blocked ? 'It cannot go out until the feed problem it names is fixed.' : 'It is ready for your review, and nothing is sent until you approve it.'}`);
      }
      const held = blocked.length === 0 ? 'Nothing is sent until you approve each one.' : `The ${blocked.length === 1 ? 'notice' : 'notices'} to ${list(blocked.map((x) => x.name))} cannot go out until the feed problems are fixed, and nothing is sent until you approve.`;
      return say(d, `I drafted notices for ${job} to ${whoText(v.notices.map((x) => ({ name: x.name, cabinets: x.cabinets, label: x.label })), 4)}. ${held}`);
    },
  },
  {
    name: 'what-if',
    when: /\b(what if|what happens|fails?|failure|goes down|trips?|loses?|switch(ed)? off|turn(ed)? off|shut ?down|outage)\b/i,
    answer(t, text, n) {
      const ids = n.equipmentIn(text);
      if (ids.length === 0 && t.off.length === 0) return { reply: 'Tell me which equipment, for example "what if UPS-A fails".', actions: [] };
      const d = whatIf(t, ids);
      return say(d, simSentence(d.value));
    },
  },
  {
    name: 'handoff',
    when: /\b(hand ?-?off|shift|brief(ing)?|turnover)\b/i,
    answer(t) {
      const d = handoff(t);
      const v = d.value;
      const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
      return say(d, `For the ${v.at} handoff, ${n(v.work.length, 'job is', 'jobs are')} in progress or due, ${n(v.lost.length, 'redundancy gap stands', 'redundancy gaps stand')}, and ${n(v.waiting.length, 'job waits', 'jobs wait')} on materials or plant conditions.${v.lost[0] ? ` The first gap is that ${v.lost[0].charAt(0).toLowerCase()}${v.lost[0].slice(1)}.` : ''}`);
    },
  },
  {
    name: 'audit',
    when: /\b(audit|findings?|gaps?|redundan\w*|spofs?|single points?)\b/i,
    answer(t) {
      const d = auditTop(t);
      const top = d.value.top[0];
      if (!top) return say(d, 'The audit finds no redundancy gaps.');
      return say(d, `The audit finds ${d.value.total} redundancy gaps. The biggest is that ${top.title.charAt(0).toLowerCase()}${top.title.slice(1)}, affecting ${whoText(top.who)}.`);
    },
  },
  {
    name: 'week',
    when: /\b(safe|this week|riskiest|risky|risk|maintenance|work orders?|schedule|scheduled|jobs?)\b/i,
    answer(t) {
      const d = weekCheck(t);
      const top = d.value.riskiest;
      if (d.value.jobs.length === 0) return say(d, 'No maintenance is scheduled in the next 7 days.');
      if (!top) return say(d, `Cascade cannot tell what any of the ${d.value.jobs.length} jobs this week takes out of service.`);
      return say(d, `${VERDICT[top.grade!]} ${jobSentence(top)}`);
    },
  },
];

const HELP = 'I can tell you whether this week\'s maintenance is safe, show what happens if equipment fails, fix a feed, draft customer notices, or sum up the shift handoff.';

export async function route(t: Turn, text: string): Promise<Answer> {
  const n = names(t.ws.analysis('planned').facility);
  const intent = INTENTS.find((i) => i.when.test(text));
  if (intent) return intent.answer(t, text, n);
  if (t.off.length > 0) {
    const d = whatIf(t, []);
    return say(d, simSentence(d.value));
  }
  return { reply: HELP, actions: [] };
}
