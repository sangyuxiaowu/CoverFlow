import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { readCompletion, runConversation } from './conversation.ts';
import { SYSTEM_PROMPT, saveConfig, normalizeConfig, selectModel, toRequestConfig, reasoningPayload, loadConfig, createEndpoint } from './config.ts';
import type { AiRequestConfig, ChatMessage, ChatSession, WorkspaceBridge } from '../types.ts';
import { AI_DATABASE_NAME, listStoredSessions, saveStoredSession, deleteStoredSession } from './configStore.ts';
import { createFileChatStore, type ChatFileAccess } from './chatStore.ts';

const config: AiRequestConfig = { endpoint: 'https://example.com/v1/chat/completions', model: 'test', apiKey: 'secret', temperature: 0.7, maxTokens: 4096, systemPrompt: SYSTEM_PROMPT };
const bridge: WorkspaceBridge = { getProject: () => null, getSelection: () => [], commit: async () => {}, manageProjects: async () => ({ items: [] }) };

test('SSE handles split UTF-8, CRLF and fragmented tool calls', async () => {
  const events = [
    { choices: [{ delta: { content: '你好', tool_calls: [{ index: 0, id: 'call1', function: { name: 'get_context', arguments: '{' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] }, finish_reason: 'tool_calls' }] }
  ].map(event => 'data: ' + JSON.stringify(event) + '\r\n\r\n').join('') + 'data: [DONE]\r\n\r\n';
  const bytes = new TextEncoder().encode(events);
  const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  let content = '';
  const message = await readCompletion(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }), chunk => { content += chunk; }, new AbortController().signal);
  assert.equal(content, '你好');
  assert.equal(message.tool_calls![0].function.arguments, '{}');
});

test('truncated streams and token exhaustion cannot execute tools', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(readCompletion(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), () => {}, signal), /disconnected/);
  await assert.rejects(readCompletion(Response.json({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }), () => {}, signal), /truncated/);
});

test('tool results and assistant calls are preserved for the next round', async () => {
  const originalFetch = globalThis.fetch;
  const requests: { messages: ChatMessage[] }[] = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options!.body as string));
    return Response.json({ choices: [{ message: requests.length === 1 ? { role: 'assistant', content: null, tool_calls: [{ id: 'call', type: 'function', function: { name: 'get_context', arguments: '{}' } }] } : { role: 'assistant', content: 'Done' }, finish_reason: 'stop' }] });
  };
  try {
    const result = await runConversation({ config, messages: [{ role: 'user', content: 'List projects' }], bridge, signal: new AbortController().signal, onText: () => {}, onTool: () => {} });
    assert.equal(requests.length, 2);
    assert.equal(requests[1].messages.at(-1)!.role, 'tool');
    assert.equal(result.at(-1)!.content, 'Done');
  } finally { globalThis.fetch = originalFetch; }
});

test('IndexedDB stores encrypted API keys and restores multi-endpoint settings', async () => {
  const profiles = normalizeConfig(config);
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

test('legacy settings migrate without losing endpoint or model parameters', () => {
  const migrated = normalizeConfig(config);
  assert.equal(toRequestConfig(migrated).endpoint, config.endpoint);
  assert.equal(toRequestConfig(migrated).model, 'test');
  assert.equal(toRequestConfig(migrated).apiKey, 'secret');
  assert.equal(toRequestConfig(migrated).maxTokens, 4096);
});

test('multiple endpoints preserve independent keys and repair deleted selections', () => {
  const profiles = normalizeConfig(config);
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

test('reasoning parameters match the selected model protocol', () => {
  assert.deepEqual(reasoningPayload(config), {});
  assert.deepEqual(reasoningPayload({ ...config, reasoningProtocol: 'deepseek', thinkingEnabled: true, reasoningEffort: 'xhigh' }), { thinking: { type: 'enabled' }, reasoning_effort: 'xhigh' });
  assert.deepEqual(reasoningPayload({ ...config, reasoningProtocol: 'deepseek', thinkingEnabled: false }), { thinking: { type: 'disabled' } });
  assert.deepEqual(reasoningPayload({ ...config, reasoningProtocol: 'openai', thinkingEnabled: true, reasoningEffort: 'high' }), { reasoning_effort: 'high' });
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
  const data = 'data: {"choices":[{"delta":{"reasoning_content":"Plan"}}]}\n\ndata: {"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  await readCompletion(new Response(data, { headers: { 'Content-Type': 'text/event-stream' } }), chunk => { answer += chunk; }, new AbortController().signal, chunk => { thinking += chunk; });
  assert.equal(thinking, 'Plan');
  assert.equal(answer, 'Done');
});

test('IndexedDB keeps separate session messages, titles and update ordering', async () => {
  const first: ChatSession = { id: 'session-one', title: 'First', createdAt: 1, updatedAt: 1, entries: [{ id: 'u1', role: 'user', content: 'One' }], messages: [{ role: 'user', content: 'One' }] };
  const second: ChatSession = { ...first, id: 'session-two', title: 'Second', updatedAt: 2, entries: [{ id: 'u2', role: 'user', content: 'Two' }], messages: [{ role: 'user', content: 'Two' }] };
  await saveStoredSession(first);
  await saveStoredSession(second);
  assert.deepEqual((await listStoredSessions()).map(session => session.id), ['session-two', 'session-one']);
  await saveStoredSession({ ...first, title: 'Renamed', updatedAt: 3 });
  const restored = await listStoredSessions();
  assert.equal(restored[0].title, 'Renamed');
  assert.equal(restored[1].messages[0].content, 'Two');
  await deleteStoredSession(first.id);
  assert.deepEqual((await listStoredSessions()).map(session => session.id), ['session-two']);
  await deleteStoredSession(second.id);
});

test('file mode stores encrypted configuration and each session under chat', async () => {
  const data = new Map<string, string>();
  const files: ChatFileAccess = { read: async path => data.get(path) || null, write: async (path, value) => { data.set(path, value); }, remove: async path => { data.delete(path); }, list: async path => [...data.keys()].filter(key => key.startsWith(path + '/')).map(key => key.slice(path.length + 1)) };
  const store = createFileChatStore(files, 'test-directory');
  const settings = normalizeConfig(config);
  await store.saveConfig(settings);
  assert.equal(data.get('chat/config.json')!.includes('"apiKey": "secret"'), false);
  assert.equal(toRequestConfig(await store.loadConfig()).apiKey, 'secret');
  const session: ChatSession = { id: 'file-session', title: 'File chat', createdAt: 1, updatedAt: 1, entries: [{ id: 'u', role: 'user', content: 'File message' }], messages: [{ role: 'user', content: 'File message' }] };
  await store.saveSession(session);
  assert.equal(data.has('chat/sessions/file-session.json'), true);
  assert.equal((await store.listSessions())[0].messages[0].content, 'File message');
  assert.equal((await listStoredSessions()).some(item => item.id === session.id), false);
  await store.deleteSession(session.id);
  assert.equal((await store.listSessions()).length, 0);
  assert.throws(() => store.saveSession({ ...session, id: '../escape' }), /Invalid/);
});