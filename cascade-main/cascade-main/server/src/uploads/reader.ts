// The model's three jobs on an upload, each one tool call with a JSON Schema: say what kind of file it
// is, read a contract's terms, and map unfamiliar CSV headers onto an export's columns. Answers are
// raw: the caller checks every one against the file before it counts.

import { CONTRACT_READING_SCHEMA } from '@cascade/core';
import { UPLOAD_KINDS, type UploadKind } from '@cascade/core/contract';
import type { LlmClient, ToolSchema } from '../agent/llm.js';

export interface Reader {
  readonly model: string;
  /** The model's kind for a file, from its name and first lines; null when it gave no usable answer. */
  classify(name: string, excerpt: string): Promise<UploadKind | null>;
  /** The model's raw reading of a contract's text (checked by `checkReading`); null when it gave none. */
  readContract(name: string, text: string): Promise<unknown>;
  /** Expected column → the file's header, for the columns the model can match; null when it gave none. */
  mapColumns(name: string, kindTitle: string, expected: readonly string[], header: readonly string[]): Promise<Readonly<Record<string, string>> | null>;
}

const KIND_GUIDE = `equipment-register: CMMS asset export, one row per asset (tag, asset class, rating, fed from)
bms-points: building management system point table (JSON): one row per BACnet point with object type, instance, units and alarm limits
circuit-roster: power roster, one row per cabinet cord (customer, cabinet, cord side, panel, circuit)
maximo-workorders: IBM Maximo work order list (WONUM, STATUS, WORKTYPE, schedule dates)
bms-event-log: BMS alarm and event log (Siemens Desigo CC Log Viewer)
bms-trend: BMS trend export of point values over time
pme-event-history: power monitoring (Schneider PME) alarm and event history
pme-export: power monitoring (Schneider PME) data export of measurements over time
contract-msa: master services agreement between the colocation provider and a customer
contract-order-form: order form under a master services agreement (pricing, cabinets, power)
unknown: anything else`;

/** Reasoning models spend part of `maxTokens` thinking before they call the tool, so budgets leave room for that. */
async function answer(llm: LlmClient, system: string, user: string, tool: ToolSchema, maxTokens: number): Promise<unknown> {
  const r = await llm.complete({ system, messages: [{ role: 'user', content: user }], tools: [tool], maxTokens }, AbortSignal.timeout(120_000));
  const call = r.toolCalls.find((c) => c.name === tool.name);
  const raw = call?.arguments ?? r.text ?? '';
  const json = /\{[\s\S]*\}/.exec(raw)?.[0];
  if (!json) return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

export function modelReader(llm: LlmClient): Reader {
  return {
    model: llm.model,
    async classify(name, excerpt) {
      const raw = await answer(
        llm,
        `You sort the files a data center facilities team uploads. Answer only by calling the tool.\nKinds:\n${KIND_GUIDE}`,
        `File name: ${name}\nFirst lines:\n${excerpt}`,
        { name: 'file_kind', description: 'The kind of the uploaded file', parameters: { type: 'object', properties: { kind: { type: 'string', enum: [...UPLOAD_KINDS] } }, required: ['kind'] } },
        2000,
      );
      const kind = (raw as { kind?: unknown } | null)?.kind;
      return (UPLOAD_KINDS as readonly unknown[]).includes(kind) ? (kind as UploadKind) : null;
    },
    readContract(name, text) {
      return answer(
        llm,
        'You read colocation contracts. Report only what the document states, copying numbers and names exactly as written; use null for anything it does not state. The provider is not the customer. Answer only by calling the tool.',
        `File name: ${name}\nDocument text:\n${text}`,
        { name: 'contract_terms', description: 'The terms this contract document states', parameters: CONTRACT_READING_SCHEMA },
        4000,
      );
    },
    async mapColumns(name, kindTitle, expected, header) {
      const raw = await answer(
        llm,
        `You match a spreadsheet's headers to the columns of a known export. Map an expected column only to a header that means the same thing; leave out columns with no match. Answer only by calling the tool.`,
        `File name: ${name}\nExport: ${kindTitle}\nExpected columns: ${expected.join(', ')}\nThe file's headers: ${header.join(', ')}`,
        {
          name: 'column_mapping',
          description: 'Expected column to the file header it matches',
          parameters: { type: 'object', properties: { mapping: { type: 'array', items: { type: 'object', properties: { expected: { type: 'string' }, header: { type: 'string' } }, required: ['expected', 'header'] } } }, required: ['mapping'] },
        },
        2000,
      );
      const pairs = (raw as { mapping?: unknown } | null)?.mapping;
      if (!Array.isArray(pairs)) return null;
      const out: Record<string, string> = {};
      for (const p of pairs as { expected?: unknown; header?: unknown }[]) if (typeof p?.expected === 'string' && typeof p.header === 'string') out[p.expected] = p.header;
      return out;
    },
  };
}
