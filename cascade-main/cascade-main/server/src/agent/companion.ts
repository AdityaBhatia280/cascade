// One companion request: the model when there is a key (the intent table if the model fails), a plain
// reply, and a replay of the first reply for a repeated Idempotency-Key. The durable effect, a submitted
// proposal, is idempotent in the Workspace log on its own; the replay keeps the words and actions too.

import type { AnyId } from '@cascade/core';
import { ENTITY_KINDS, RULE_IDS, type CompanionAction, type CompanionMessage, type CompanionReply } from '@cascade/core/contract';
import type { Actor } from '../actors.js';
import { localNow } from '../parse.js';
import { canonicalJson, type Workspace } from '../workspace.js';
import type { LlmClient } from './llm.js';
import { converse } from './loop.js';
import type { Turn } from './ops.js';
import { route } from './router.js';

export interface Ask {
  readonly messages: readonly CompanionMessage[];
  readonly selected: AnyId | null;
  readonly off: readonly AnyId[];
}

export type Asked = { readonly ok: true; readonly value: CompanionReply } | { readonly ok: false; readonly message: string };

const TURN_MS = 60_000;
const KEEP_REPLIES = 500;
const MAX_REPLY = 280;

const PREFIX = new RegExp(`\\b(?:${[...RULE_IDS, ...ENTITY_KINDS].join('|')}):`, 'g');

/** The reply as the manager reads it: no internal ids, file names or markdown, at most a few sentences. */
export function plain(text: string): string {
  let s = text
    .replace(/[*_`#]+/g, '')
    .replace(/\b[\w-]+\.(?:csv|json|txt|eml|md)\b/gi, 'the site records')
    .replace(/(\w)–(\w)/g, '$1 to $2')
    .replace(/\s*—\s*|\s+–\s+/g, ', ');
  for (let i = 0; i < 3; i++) s = s.replace(PREFIX, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length <= MAX_REPLY) return s;
  const cut = s.slice(0, MAX_REPLY);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return end > 0 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

const unique = (actions: readonly CompanionAction[]) => [...new Map(actions.map((a) => [canonicalJson(a), a])).values()];

export function companion(deps: { readonly ws: Workspace; readonly llm: LlmClient | null; readonly now: () => Date }) {
  const replies = new Map<string, { readonly fingerprint: string; readonly reply: Promise<CompanionReply> }>();

  async function answer(ask: Ask, key: string): Promise<CompanionReply> {
    const base = { ws: deps.ws, asOf: localNow(deps.now()), selected: ask.selected, off: ask.off, key };
    const text = ask.messages.at(-1)!.content;
    const scripted = (): Turn => ({ ...base, actor: { kind: 'playbook', name: 'companion' } satisfies Actor });
    let r: { readonly reply: string; readonly actions: readonly CompanionAction[] };
    if (deps.llm) {
      try {
        r = await converse(deps.llm, { ...base, actor: { kind: 'agent', runId: key, model: deps.llm.model } }, ask.messages, AbortSignal.timeout(TURN_MS));
      } catch (e) {
        console.warn(`[cascade] companion model failed, answering from the intent table: ${(e as Error).message}`);
        r = await route(scripted(), text);
      }
    } else r = await route(scripted(), text);
    return { reply: plain(r.reply), actions: unique(r.actions) };
  }

  return async (ask: Ask, key: string): Promise<Asked> => {
    const fingerprint = canonicalJson(ask);
    const prior = replies.get(key);
    if (prior) return prior.fingerprint === fingerprint ? { ok: true, value: await prior.reply } : { ok: false, message: `idempotency key ${key} was already used for a different request` };
    const reply = answer(ask, key);
    replies.set(key, { fingerprint, reply });
    while (replies.size > KEEP_REPLIES) replies.delete(replies.keys().next().value!);
    try {
      return { ok: true, value: await reply };
    } catch (e) {
      replies.delete(key);
      throw e;
    }
  };
}
