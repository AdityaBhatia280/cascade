import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LlmError, llmFromEnv, malformedCalls, openAiCompatible } from './llm.js';

async function stub(reply: (body: Record<string, unknown>, req: IncomingMessage) => { status: number; body: string }) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const r = reply(JSON.parse(raw) as Record<string, unknown>, req);
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(r.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => server.close() };
}

const req = { system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }], tools: [{ name: 'run_audit', description: 'd', parameters: { type: 'object' } }], maxTokens: 100 };

test('the OpenAI-compatible adapter sends tools with the key and parses tool calls', async () => {
  let seen: { auth: string | undefined; body: Record<string, unknown> } | null = null;
  const s = await stub((body, r) => {
    seen = { auth: r.headers.authorization, body };
    return {
      status: 200,
      body: JSON.stringify({ model: 'm-1', choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'run_audit', arguments: '{}' } }] } }] }),
    };
  });
  const llm = openAiCompatible({ baseUrl: s.url, apiKey: 'k', model: 'm' });
  const r = await llm.complete(req, new AbortController().signal);
  s.close();
  assert.deepEqual(r.toolCalls, [{ id: 'c1', name: 'run_audit', arguments: '{}' }]);
  assert.equal(r.text, null);
  assert.equal(seen!.auth, 'Bearer k');
  assert.equal((seen!.body['tools'] as unknown[]).length, 1);
  assert.deepEqual((seen!.body['messages'] as { role: string }[]).map((m) => m.role), ['system', 'user']);
});

test('HTTP errors and timeouts surface as LlmError, never as text', async () => {
  const s = await stub(() => ({ status: 500, body: '{"error":"boom"}' }));
  await assert.rejects(openAiCompatible({ baseUrl: s.url, apiKey: 'k', model: 'm' }).complete(req, new AbortController().signal), LlmError);
  s.close();
  const slow = createServer(() => undefined);
  await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(slow.address() as AddressInfo).port}/v1`;
  await assert.rejects(openAiCompatible({ baseUrl: url, apiKey: 'k', model: 'm', timeoutMs: 100 }).complete(req, new AbortController().signal), LlmError);
  slow.closeAllConnections();
  slow.close();
});

test('llmFromEnv: no key means no client; NVIDIA_API_KEY is accepted', () => {
  assert.equal(llmFromEnv({}), null);
  assert.equal(llmFromEnv({ LLM_API_KEY: '  ' }), null);
  assert.equal(llmFromEnv({ NVIDIA_API_KEY: 'k' })?.model, 'nvidia/nemotron-3-super-120b-a12b');
  assert.equal(llmFromEnv({ LLM_API_KEY: 'k', LLM_MODEL: 'other' })?.model, 'other');
});

test('malformedCalls flags bad JSON, non-object arguments and unknown tools', () => {
  const tools = req.tools;
  assert.deepEqual(malformedCalls([{ id: '1', name: 'run_audit', arguments: '' }], tools), []);
  assert.equal(malformedCalls([{ id: '1', name: 'run_audit', arguments: '{oops' }], tools).length, 1);
  assert.equal(malformedCalls([{ id: '1', name: 'run_audit', arguments: '[1]' }], tools).length, 1);
  assert.equal(malformedCalls([{ id: '1', name: 'approve', arguments: '{}' }], tools).length, 1);
});
