// One companion turn with a model: the model decides which tool to call next; ops.ts computes every
// result. The view actions come from the tools the model called, so the model never writes an id the
// UI acts on. A malformed reply is retried once; any failure throws and the caller answers without it.

import { tagOf } from '@cascade/core';
import type { CompanionAction, CompanionMessage } from '@cascade/core/contract';
import { LlmError, malformedCalls, type LlmClient, type LlmMessage, type LlmRequest, type LlmResponse } from './llm.js';
import { dayTime, type Turn } from './ops.js';
import { TOOLS } from './tools.js';

const SYSTEM = [
  'You are the companion of a critical facilities manager at a colocation data center, inside Cascade.',
  'You answer through tools: every name, number and fact you mention must come from a tool result in this conversation. Never guess.',
  'Reply in one or two short plain sentences. Name equipment by tag (PDU-3A, RPP-4B) and customers by name.',
  'Never write internal ids with colons, file or document names, citations, markdown, or lists.',
  'You cannot approve, reject or send anything: submit_fix only queues a fix for a person to approve, and draft_notices only drafts.',
  'When asked to fix something, call submit_fix. When asked whether this week is safe, call week_check. When asked what happens if something fails, call what_if.',
  'Lead with what goes dark and what loses backup, in cabinets and customers. Mention money only when asked, and never add revenue that goes dark to revenue that only loses backup.',
  'Use show to point at things in the view when it helps.',
].join(' ');

const MAX_STEPS = 6;

const scene = (t: Turn) =>
  [
    `Site time now: ${dayTime(t.asOf)} (${t.asOf.slice(0, 10)}).`,
    `The view has ${t.selected ? `${tagOf(t.selected)} selected` : 'nothing selected'}${t.off.length > 0 ? ` and ${t.off.map(tagOf).join(', ')} switched off` : ''}.`,
  ].join(' ');

async function validTurn(llm: LlmClient, req: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
  let messages = req.messages;
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await llm.complete({ ...req, messages }, signal);
    const bad = malformedCalls(resp.toolCalls, req.tools);
    if (bad.length === 0) return resp;
    const why = bad.map((b) => `${b.call.name}: ${b.why}`).join('; ');
    if (attempt === 1) throw new LlmError(`model returned malformed tool calls twice: ${why}`);
    messages = [...req.messages, { role: 'user', content: `Your previous reply had malformed tool calls (${why}). Reply again; each tool's arguments must be a JSON object matching its schema.` }];
  }
  throw new LlmError('unreachable');
}

export async function converse(llm: LlmClient, t: Turn, history: readonly CompanionMessage[], signal: AbortSignal): Promise<{ readonly reply: string; readonly actions: readonly CompanionAction[] }> {
  const schemas = Object.values(TOOLS).map((x) => x.schema);
  const messages: LlmMessage[] = history.map((m) => (m.role === 'user' ? { role: 'user', content: m.content } : { role: 'assistant', content: m.content, toolCalls: [] }));
  const actions: CompanionAction[] = [];
  const system = `${SYSTEM} ${scene(t)}`;
  for (let step = 0; step < MAX_STEPS; step++) {
    const resp = await validTurn(llm, { system, messages, tools: schemas, maxTokens: 800 }, signal);
    messages.push({ role: 'assistant', content: resp.text, toolCalls: resp.toolCalls });
    if (resp.toolCalls.length === 0) {
      if (!resp.text) throw new LlmError('model ended its turn without a reply');
      return { reply: resp.text, actions };
    }
    for (const call of resp.toolCalls) {
      const out = await TOOLS[call.name]!.run(t, JSON.parse(call.arguments.trim() === '' ? '{}' : call.arguments) as Record<string, unknown>);
      actions.push(...out.actions);
      messages.push({ role: 'tool', callId: call.id, content: out.json });
    }
  }
  throw new LlmError(`model did not answer within ${MAX_STEPS} steps`);
}
