// Provider-agnostic LLM seam with one adapter: OpenAI-compatible chat completions with tools
// (NVIDIA Nemotron at integrate.api.nvidia.com/v1; also vLLM, OpenRouter, local servers).
// There is no fake client. `llmFromEnv` returns null without a key and the companion answers from
// its intent table, so model text always came from a real model.

export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the arguments object. */
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  /** Raw JSON string from the model; validated before any tool sees it. */
  readonly arguments: string;
}

export type LlmMessage =
  | { readonly role: 'user'; readonly content: string }
  | { readonly role: 'assistant'; readonly content: string | null; readonly toolCalls: readonly ToolCall[] }
  | { readonly role: 'tool'; readonly callId: string; readonly content: string };

export interface LlmRequest {
  readonly system: string;
  readonly messages: readonly LlmMessage[];
  readonly tools: readonly ToolSchema[];
  readonly maxTokens: number;
}

export interface LlmResponse {
  readonly text: string | null;
  readonly toolCalls: readonly ToolCall[];
  readonly model: string;
  readonly latencyMs: number;
}

export interface LlmClient {
  readonly model: string;
  complete(req: LlmRequest, signal: AbortSignal): Promise<LlmResponse>;
}

export class LlmError extends Error {}

/** A tool call whose arguments are not a JSON object or whose tool is not offered. */
export interface MalformedCall {
  readonly call: ToolCall;
  readonly why: string;
}

/** Validates the model's tool calls against the offered tools. Empty result = all well-formed. */
export function malformedCalls(calls: readonly ToolCall[], offered: readonly ToolSchema[]): readonly MalformedCall[] {
  const names = new Set(offered.map((t) => t.name));
  const bad: MalformedCall[] = [];
  for (const call of calls) {
    if (!names.has(call.name)) {
      bad.push({ call, why: `unknown tool "${call.name}"` });
      continue;
    }
    try {
      const v: unknown = JSON.parse(call.arguments.trim() === '' ? '{}' : call.arguments);
      if (typeof v !== 'object' || v === null || Array.isArray(v)) bad.push({ call, why: 'arguments must be a JSON object' });
    } catch (e) {
      bad.push({ call, why: `arguments are not valid JSON (${(e as Error).message})` });
    }
  }
  return bad;
}

interface ChatChoice {
  readonly message?: {
    readonly content?: string | null;
    readonly tool_calls?: readonly { readonly id?: string; readonly function?: { readonly name?: string; readonly arguments?: string } }[];
  };
}

function wireMessages(req: LlmRequest): unknown[] {
  return [
    { role: 'system', content: req.system },
    ...req.messages.map((m) => {
      switch (m.role) {
        case 'user':
          return { role: 'user', content: m.content };
        case 'assistant':
          return m.toolCalls.length === 0
            ? { role: 'assistant', content: m.content ?? '' }
            : {
                role: 'assistant',
                content: m.content,
                tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
              };
        case 'tool':
          return { role: 'tool', tool_call_id: m.callId, content: m.content };
      }
    }),
  ];
}

export function openAiCompatible(opts: { readonly baseUrl: string; readonly apiKey: string; readonly model: string; readonly timeoutMs?: number }): LlmClient {
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    model: opts.model,
    async complete(req, signal) {
      const t0 = Date.now();
      const body = {
        model: opts.model,
        messages: wireMessages(req),
        tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
        tool_choice: 'auto',
        max_tokens: req.maxTokens,
        temperature: 0,
      };
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.any([signal, AbortSignal.timeout(opts.timeoutMs ?? 90_000)]),
        });
      } catch (e) {
        throw new LlmError(`LLM request failed: ${(e as Error).message}`);
      }
      const text = await res.text();
      if (!res.ok) throw new LlmError(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
      let json: { choices?: readonly ChatChoice[]; model?: string };
      try {
        json = JSON.parse(text) as typeof json;
      } catch {
        throw new LlmError('LLM returned a non-JSON response');
      }
      const msg = json.choices?.[0]?.message;
      if (!msg) throw new LlmError('LLM response has no choices[0].message');
      const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((c, i) => ({
        id: c.id ?? `call-${i}`,
        name: c.function?.name ?? '',
        arguments: c.function?.arguments ?? '',
      }));
      const content = typeof msg.content === 'string' && msg.content.trim() !== '' ? msg.content : null;
      return { text: content, toolCalls, model: json.model ?? opts.model, latencyMs: Date.now() - t0 };
    },
  };
}

export const DEFAULT_LLM_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const DEFAULT_LLM_MODEL = 'nvidia/nemotron-3-super-120b-a12b';

/** LLM_API_KEY (or NVIDIA_API_KEY), LLM_BASE_URL, LLM_MODEL → client; no key → null. */
export function llmFromEnv(env: Readonly<Record<string, string | undefined>>): LlmClient | null {
  const apiKey = env['LLM_API_KEY']?.trim() || env['NVIDIA_API_KEY']?.trim();
  if (!apiKey) return null;
  return openAiCompatible({
    baseUrl: env['LLM_BASE_URL']?.trim() || DEFAULT_LLM_BASE_URL,
    apiKey,
    model: env['LLM_MODEL']?.trim() || DEFAULT_LLM_MODEL,
  });
}
