import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { readResponse, runConversation, normalizeUsage } from './conversation.ts';
import type { Response as AiResponse, ResponseStreamEvent } from 'openai/resources/responses/responses';
import { SYSTEM_PROMPT, defaultConfig, saveConfig, normalizeConfig, normalizeEndpoint, selectModel, toRequestConfig, reasoningPayload, loadConfig, createEndpoint, validateRequestConfig } from './config.ts';
import type { AiRequestConfig, ChatSession, RequestUsage, ResponseItem, WorkspaceBridge } from '../types.ts';
import { AI_DATABASE_NAME, listStoredSessions, saveStoredSession, deleteStoredSession } from './configStore.ts';
import { createFileChatStore, type ChatFileAccess } from './chatStore.ts';
import { sessionUsage, sumUsage } from './usage.ts';

const config: AiRequestConfig = { endpoint: 'https://example.com/v1', model: 'test', apiKey: 'secret', maxTokens: 4096, systemPrompt: SYSTEM_PROMPT };
const configuredConfig = () => {
  const profiles = defaultConfig();
  Object.assign(profiles.endpoints[0], { endpoint: config.endpoint, apiKey: config.apiKey });
  Object.assign(profiles.endpoints[0].models[0], { modelId: config.model, label: config.model });
  return profiles;
};
const bridge: WorkspaceBridge = { getProject: () => null, getSelection: () => [], commit: async () => {}, manageProjects: async () => ({ items: [] }) };

const responsePayload = (output: unknown[], overrides = {}) => ({ id: 'resp-test', object: 'response', status: 'completed', output, usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 50 }, output_tokens_details: { reasoning_tokens: 10 } }, ...overrides });
const textOutput = { type: 'message', id: 'msg-test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done', annotations: [] }] };
async function* eventsFrom(events: unknown[]) { for (const event of events) yield event as ResponseStreamEvent; }
const streamResponse = (payload: ReturnType<typeof responsePayload>) => new Response(`event: response.${payload.status}\ndata: ${JSON.stringify({ type: `response.${payload.status}`, response: payload })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });

test('Responses text deltas and final output are returned', async () => {
  const events = eventsFrom([{ type: 'response.output_text.delta', delta: '你好' }, { type: 'response.completed', response: responsePayload([textOutput]) }]);
  let content = '';
  const response = await readResponse(events, chunk => { content += chunk; }, new AbortController().signal);
  assert.equal(content, '你好');
  assert.equal(response.output[0].type, 'message');
});

test('truncated streams and token exhaustion cannot execute tools', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(readResponse(eventsFrom([{ type: 'response.output_text.delta', delta: 'partial' }]), () => {}, signal), /disconnected/);
  const originalFetch = globalThis.fetch;
  let toolCount = 0;
  const usages: unknown[] = [];
  globalThis.fetch = async () => streamResponse(responsePayload([{ type: 'function_call', call_id: 'call', name: 'get_context', arguments: '{}' }], { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }));
  try {
    await assert.rejects(runConversation({ config, input: [], bridge, signal, onText: () => {}, onTool: () => { toolCount++; }, onUsage: usage => usages.push(usage) }), /incomplete/);
    assert.equal(toolCount, 0);
    assert.equal(usages.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('tool results and assistant calls are preserved for the next round', async () => {
  const originalFetch = globalThis.fetch;
  const requests: { input: { type?: string; content?: string; call_id?: string }[]; reasoning?: unknown }[] = [];
  const urls: string[] = [];
  const usages: unknown[] = [];
  globalThis.fetch = async (_url, options) => {
    urls.push(String(_url));
    requests.push(JSON.parse(options!.body as string));
    return streamResponse(responsePayload(requests.length === 1 ? [{ type: 'reasoning', id: 'rs-test', summary: [], content: [{ type: 'reasoning_text', text: 'Plan' }] }, { type: 'function_call', id: 'fc-test', call_id: 'call', name: 'get_context', arguments: '{}' }] : [textOutput], { id: `resp-${requests.length}` }));
  };
  try {
    const result = await runConversation({ config, input: [{ role: 'user', content: 'List projects' }], bridge, signal: new AbortController().signal, onText: () => {}, onTool: () => {}, onUsage: usage => usages.push(usage) });
    assert.equal(requests.length, 2);
    assert.equal(urls[0], 'https://example.com/v1/responses');
    assert.equal(requests[1].input.at(-1)!.type, 'function_call_output');
    assert.equal(requests[1].input.at(-1)!.call_id, 'call');
    assert.equal(requests[1].input[1].type, 'reasoning');
    assert.equal(usages.length, 2);
    assert.equal(result, 'Done');
  } finally { globalThis.fetch = originalFetch; }
});

test('Responses never sends temperature in any reasoning mode', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options!.body as string));
    return streamResponse(responsePayload([textOutput]));
  };
  try {
    for (const settings of [config, { ...config, thinkingAvailable: true, thinkingEnabled: true, reasoningEffort: 'high' as const }, { ...config, thinkingAvailable: true, thinkingEnabled: false }]) {
      await runConversation({ config: settings, input: [], bridge, signal: new AbortController().signal, onText: () => {}, onTool: () => {} });
    }
    assert.equal(requests.length, 3);
    assert.equal(requests.every(request => !Object.hasOwn(request, 'temperature')), true);
    assert.equal(Object.hasOwn(defaultConfig().endpoints[0].models[0], 'temperature'), false);
    assert.equal(Object.hasOwn(toRequestConfig(configuredConfig()), 'temperature'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('IndexedDB stores encrypted API keys and restores multi-endpoint settings', async () => {
  const profiles = configuredConfig();
  const second = createEndpoint('deepseek');
  second.apiKey = 'second-secret';
  profiles.endpoints.push(second);
  await saveConfig(profiles);
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(AI_DATABASE_NAME); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const read = <Value>(store: string, key?: string) => new Promise<Value>((resolve, reject) => {
    const request = key ? db.transaction(store).objectStore(store).get(key) : db.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as Value); request.onerror = () => reject(request.error);
  });
  const saved = await read<Record<string, unknown>>('settings', 'config');
  assert.equal(JSON.stringify(saved).includes('second-secret'), false);
  assert.equal(JSON.stringify(saved).includes('"apiKey":"secret"'), false);
  const secrets = await read<{ iv: ArrayBuffer; ciphertext: ArrayBuffer }[]>('endpoint-secrets');
  assert.equal(secrets.length, 2);
  assert.equal(secrets[0].iv.byteLength, 12);
  assert.notDeepEqual(new Uint8Array(secrets[0].iv), new Uint8Array(secrets[1].iv));
  const key = await read<CryptoKey>('encryption-key', 'master');
  assert.equal(key.extractable, false);
  assert.equal(key.algorithm.name, 'AES-GCM');
  const restored = await loadConfig();
  assert.equal(restored.endpoints[0].apiKey, 'secret');
  assert.equal(restored.endpoints[1].apiKey, 'second-secret');
  db.close();
});

test('configuration requires the current structure and API base URLs', () => {
  assert.throws(() => normalizeConfig(config), /endpoint/);
  assert.throws(() => validateRequestConfig({ ...config, endpoint: 'https://example.com/v1/chat/completions' }), /base URL/);
  assert.throws(() => validateRequestConfig({ ...config, endpoint: 'https://example.com/v1/responses' }), /base URL/);
  assert.equal(normalizeEndpoint('https://example.com/v1/'), 'https://example.com/v1');
  assert.equal(toRequestConfig(normalizeConfig(configuredConfig())).model, 'test');
});

test('multiple endpoints preserve independent keys and repair deleted selections', () => {
  const profiles = configuredConfig();
  const endpoint = createEndpoint('deepseek');
  endpoint.apiKey = 'second-key';
  profiles.endpoints.push(endpoint);
  const selected = selectModel(profiles, endpoint.id, endpoint.models[1].id);
  assert.equal(toRequestConfig(selected).apiKey, 'second-key');
  assert.equal(toRequestConfig(profiles).apiKey, 'secret');
  const repaired = normalizeConfig({ ...selected, endpoints: [profiles.endpoints[0]] });
  assert.equal(repaired.activeSelection.endpointId, profiles.endpoints[0].id);
  assert.throws(() => selectModel(profiles, 'missing', 'missing'), /not found/);
});

test('Responses uses one reasoning format with model-specific levels', () => {
  assert.deepEqual(reasoningPayload(config), {});
  assert.deepEqual(reasoningPayload({ ...config, thinkingAvailable: true, thinkingEnabled: true, reasoningEffort: 'max' }), { reasoning: { effort: 'max' } });
  assert.deepEqual(reasoningPayload({ ...config, thinkingAvailable: true, thinkingEnabled: false }), { reasoning: { effort: 'none' } });
  const endpoint = createEndpoint('deepseek');
  assert.equal(endpoint.models.every(model => model.thinkingAvailable), true);
  assert.deepEqual(endpoint.models[0].supportedReasoningEfforts, ['none', 'low', 'high', 'max']);
  assert.throws(() => validateRequestConfig({ ...config, contextWindow: 1000 }), /Context window/);
  assert.throws(() => validateRequestConfig({ ...config, thinkingAvailable: true, thinkingEnabled: true, supportedReasoningEfforts: ['low'], reasoningEffort: 'max' }), /does not support/);
});

test('saving without a removed endpoint deletes its encrypted key', async () => {
  const stored = await loadConfig();
  const reduced = normalizeConfig({ ...stored, endpoints: [stored.endpoints[0]] });
  await saveConfig(reduced);
  const restored = await loadConfig();
  assert.equal(restored.endpoints.length, 1);
  assert.equal(restored.endpoints[0].apiKey, 'secret');
});

test('tampered ciphertext fails closed without overwriting settings', async () => {
  const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open(AI_DATABASE_NAME); request.onsuccess = () => resolve(request.result); });
  const original = await new Promise<{ endpointId: string; iv: ArrayBuffer; ciphertext: ArrayBuffer }>(resolve => { const request = db.transaction('endpoint-secrets').objectStore('endpoint-secrets').getAll(); request.onsuccess = () => resolve(request.result[0]); });
  const put = (value: typeof original) => new Promise<void>((resolve, reject) => { const tx = db.transaction('endpoint-secrets', 'readwrite'); tx.objectStore('endpoint-secrets').put(value); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  const bytes = new Uint8Array(original.ciphertext.slice(0));
  bytes[0] ^= 1;
  await put({ ...original, ciphertext: bytes.buffer });
  try { await assert.rejects(loadConfig(), /decrypt/); }
  finally { await put(original); db.close(); }
});

test('reasoning chunks are exposed separately from assistant text', async () => {
  let thinking = '';
  let answer = '';
  const data = eventsFrom([{ type: 'response.reasoning_text.delta', delta: 'Plan' }, { type: 'response.output_text.delta', delta: 'Done' }, { type: 'response.completed', response: responsePayload([textOutput]) }]);
  await readResponse(data, chunk => { answer += chunk; }, new AbortController().signal, chunk => { thinking += chunk; });
  assert.equal(thinking, 'Plan');
  assert.equal(answer, 'Done');
});

test('usage keeps cache and reasoning as subsets, not additional tokens', () => {
  assert.deepEqual(normalizeUsage(responsePayload([]).usage as AiResponse['usage']), { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedTokens: 50, reasoningTokens: 10 });
  assert.equal(normalizeUsage(null), undefined);
});

test('session statistics sum all tool rounds but do not confuse spend with context', () => {
  const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedTokens: 50, reasoningTokens: 10 };
  const requests = [{ id: 'one', entryId: 'assistant', endpoint: 'https://example.com/v1', model: 'test', createdAt: 1, status: 'completed' as const, usage }, { id: 'two', entryId: 'assistant', endpoint: 'https://example.com/v1', model: 'test', createdAt: 2, status: 'completed' as const, usage }];
  assert.deepEqual(sumUsage(requests), { inputTokens: 200, outputTokens: 40, totalTokens: 240, cachedTokens: 100, reasoningTokens: 20 });
  const session: ChatSession = { id: 'stats', title: 'Stats', createdAt: 1, updatedAt: 1, entries: [{ id: 'assistant', role: 'assistant', content: 'Done' }], responseItems: [], requests };
  const summary = sessionUsage(session, { ...config, contextWindow: 4096 }, [], '');
  assert.equal(summary.total?.totalTokens, 240);
  assert.equal(summary.current?.totalTokens, 240);
  assert.equal(summary.lastInputTokens, 100);
  assert.equal(summary.incomplete, false);
  assert.equal(sessionUsage({ ...session, requests: [...requests, { ...requests[0], id: 'failed', usage: undefined, status: 'aborted' }] }, config, [], '').incomplete, true);
  assert.equal(sessionUsage({ ...session, requests: [] }, config, [], '').total, undefined);
});

test('aborted requests record unknown usage without SDK retries', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let count = 0;
  const usages: RequestUsage[] = [];
  globalThis.fetch = async () => { count++; controller.abort(); throw new Error('aborted'); };
  try {
    await assert.rejects(runConversation({ config, input: [], bridge, signal: controller.signal, onText: () => {}, onTool: () => {}, onUsage: usage => usages.push(usage) }));
    assert.equal(count, 1);
    assert.equal(usages.length, 1);
    assert.equal(usages[0].status, 'aborted');
    assert.equal(usages[0].usage, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test('user rejection pairs all pending tool calls without executing or retrying them', async () => {
  const originalFetch = globalThis.fetch;
  let count = 0;
  let history: ResponseItem[] = [];
  const rejectingBridge = { ...bridge, manageProjects: async () => { throw new Error('User cancelled'); } };
  globalThis.fetch = async () => { count++; return streamResponse(responsePayload(['first', 'second'].map(call_id => ({ type: 'function_call', call_id, name: 'manage_projects', arguments: '{"action":"list"}' })))); };
  try {
    const content = await runConversation({ config, input: [], bridge: rejectingBridge, signal: new AbortController().signal, onText: () => {}, onTool: () => {}, onHistory: input => { history = input; } });
    assert.equal(count, 1);
    assert.equal(content, '操作已取消。');
    assert.equal(history.filter(item => 'type' in item && item.type === 'function_call_output').length, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('IndexedDB keeps separate session messages, titles and update ordering', async () => {
  const first: ChatSession = { id: 'session-one', title: 'First', createdAt: 1, updatedAt: 1, entries: [{ id: 'u1', role: 'user', content: 'One' }], responseItems: [{ role: 'user', content: 'One' }], requests: [{ id: 'request-one', endpoint: 'https://example.com/v1', model: 'test', createdAt: 1, status: 'completed', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } }] };
  const second: ChatSession = { ...first, id: 'session-two', title: 'Second', updatedAt: 2, entries: [{ id: 'u2', role: 'user', content: 'Two' }], responseItems: [{ role: 'user', content: 'Two' }] };
  await saveStoredSession(first);
  await saveStoredSession(second);
  assert.deepEqual((await listStoredSessions()).map(session => session.id), ['session-two', 'session-one']);
  await saveStoredSession({ ...first, title: 'Renamed', updatedAt: 3 });
  const restored = await listStoredSessions();
  assert.equal(restored[0].title, 'Renamed');
  assert.deepEqual(restored[0].requests, first.requests);
  assert.deepEqual(restored[0].responseItems, first.responseItems);
  assert.deepEqual(restored[1].responseItems, second.responseItems);
  await deleteStoredSession(first.id);
  assert.deepEqual((await listStoredSessions()).map(session => session.id), ['session-two']);
  await deleteStoredSession(second.id);
});

test('file mode stores encrypted configuration and each session under chat', async () => {
  const data = new Map<string, string>();
  const files: ChatFileAccess = { read: async path => data.get(path) || null, write: async (path, value) => { data.set(path, value); }, remove: async path => { data.delete(path); }, list: async path => [...data.keys()].filter(key => key.startsWith(path + '/')).map(key => key.slice(path.length + 1)) };
  const store = createFileChatStore(files, 'test-directory');
  const settings = configuredConfig();
  await store.saveConfig(settings);
  assert.equal(data.get('chat/config.json')!.includes('"apiKey": "secret"'), false);
  assert.equal(toRequestConfig(await store.loadConfig()).apiKey, 'secret');
  const session: ChatSession = { id: 'file-session', title: 'File chat', createdAt: 1, updatedAt: 1, entries: [{ id: 'u', role: 'user', content: 'File message' }], responseItems: [{ role: 'user', content: 'File message' }], requests: [{ id: 'file-request', endpoint: 'https://example.com/v1', model: 'test', createdAt: 1, status: 'completed', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } }] };
  await store.saveSession(session);
  assert.equal(data.has('chat/sessions/file-session.json'), true);
  assert.deepEqual((await store.listSessions())[0].requests, session.requests);
  assert.deepEqual((await store.listSessions())[0].responseItems, session.responseItems);
  assert.equal((await listStoredSessions()).some(item => item.id === session.id), false);
  await store.deleteSession(session.id);
  assert.equal((await store.listSessions()).length, 0);
  assert.throws(() => store.saveSession({ ...session, id: '../escape' }), /Invalid/);
});