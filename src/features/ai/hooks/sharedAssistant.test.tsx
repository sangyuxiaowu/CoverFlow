// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { AiSettings, DEFAULT_SETTINGS, createBrowserAiStore, createEndpoint, createIndexedDbImageStore, createModel, normalizeConfig, resolveSelection, useAssistant, useResolvedTheme, type AiConfig, type AssistantRunner, type AssistantSnapshot, type AssistantStorage } from 'sang-ai-kit';

afterEach(() => vi.unstubAllGlobals());

it('persists sessions, streams tool activity, and avoids unsafe tool redo', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const saved: { current: AssistantSnapshot | null } = { current: null };
  const storage: AssistantStorage = { load: async () => saved.current, save: async snapshot => { saved.current = snapshot; } };
  const runner: AssistantRunner = async (_messages, events) => {
    events.onTool({ id: 'tool', name: 'read', arguments: '{}', status: 'running' });
    events.onTool({ id: 'tool', name: 'read', arguments: '{}', status: 'success', result: 'ok' });
    events.onReasoning('reason');
    events.onText('answer');
  };
  const host = document.createElement('div');
  const root = createRoot(host);
  let assistant: ReturnType<typeof useAssistant>;
  function Harness() { assistant = useAssistant(runner, storage); return null; }
  try {
    await act(async () => { root.render(<Harness />); });
    expect(assistant!.loading).toBe(false);
    await act(async () => { await assistant!.send('question'); });
    expect(assistant!.entries.map(entry => entry.content)).toEqual(['question', 'answer']);
    expect(assistant!.entries[1].activity?.find(item => item.type === 'reasoning')).toMatchObject({ text: 'reason' });
    expect(assistant!.entries[1].tools?.[0].status).toBe('success');
    expect(assistant!.entries[1].activity?.map(item => item.type)).toEqual(['tool', 'reasoning', 'text']);
    expect(assistant!.canRegenerate).toBe(false);
    await expect(assistant!.send('image', [{ image: { id: 'img', name: 'image.png', type: 'image/png', size: 1 }, blob: new Blob() }])).rejects.toThrow('Image storage is unavailable');
    const first = assistant!.activeSessionId;
    await act(async () => { await assistant!.newSession(); });
    expect(assistant!.sessions).toHaveLength(2);
    await act(async () => { await assistant!.selectSession(first!); });
    expect(assistant!.entries[1].content).toBe('answer');
    await act(async () => { await Promise.resolve(); });
    expect(saved.current).toMatchObject({ activeSessionId: first });
  } finally { await act(async () => root.unmount()); }
});

it('does not send an old request into a newly selected store', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const first: AssistantStorage = { load: async () => null, save: vi.fn(async () => {}) };
  const secondSnapshot: AssistantSnapshot = { activeSessionId: 'new', sessions: [{ id: 'new', title: 'Other', updatedAt: 1, entries: [], requests: [] }] };
  const second: AssistantStorage = { load: async () => secondSnapshot, save: vi.fn(async () => {}) };
  let release: (() => void) | undefined;
  const runner: AssistantRunner = async (_messages, events) => { await new Promise<void>(resolve => { release = resolve; }); events.onText('stale'); };
  const root = createRoot(document.createElement('div'));
  let assistant: ReturnType<typeof useAssistant>;
  function Harness({ storage }: { storage: AssistantStorage }) { assistant = useAssistant(runner, storage); return null; }
  try {
    await act(async () => { root.render(<Harness storage={first} />); });
    await act(async () => { void assistant!.send('old'); });
    expect(assistant!.busy).toBe(true);
    await act(async () => { root.render(<Harness storage={second} />); });
    expect(assistant!.busy).toBe(false);
    await act(async () => { release!(); });
    expect(assistant!.entries).toEqual([]);
    expect(second.save).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});

it('marks running tools from a restored session as interrupted', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const saved: AssistantSnapshot = { activeSessionId: 'session', sessions: [{ id: 'session', title: 'Test', updatedAt: 1, requests: [], entries: [
    { id: 'reply', role: 'assistant', content: '', tools: [{ id: 'tool', name: 'work', arguments: '{}', status: 'running' }] }
  ] }] };
  const storage: AssistantStorage = { load: async () => saved, save: vi.fn(async () => {}) };
  const root = createRoot(document.createElement('div'));
  let assistant: ReturnType<typeof useAssistant>;
  function Harness() { assistant = useAssistant(async () => {}, storage); return null; }
  try {
    await act(async () => { root.render(<Harness />); });
    expect(assistant!.entries[0].tools?.[0]).toMatchObject({ status: 'error', result: 'The previous operation was interrupted.' });
    expect(storage.save).toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});

it('allows a generic host to save settings without unrelated capability tabs', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  const endpoint = createEndpoint('openai');
  const config: AiConfig = { endpoints: [endpoint], activeSelection: { endpointId: endpoint.id, modelId: endpoint.models[0].id }, systemPrompt: 'Original' };
  const onSave = vi.fn(async () => {});
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<AiSettings config={config} onSave={onSave} onBack={() => {}} english={false}
      store={{ loadConfig: async () => config }} onKeyChanged={async () => {}} createEndpoint={createEndpoint} createModel={createModel}
      normalizeConfig={normalizeConfig} resolveSelection={resolveSelection} defaults={DEFAULT_SETTINGS} showTurnLimits={false} supportsVision={false} />); });
    expect(host.querySelector('#ai-settings-tab-images')).toBeNull();
    expect(host.querySelector('#ai-settings-tab-removal')).toBeNull();
    expect(host.querySelector('#ai-settings-tab-skills')).toBeNull();
    expect(host.querySelector('#ai-settings-tab-other')).toBeNull();
    expect(host.querySelector('button[role="switch"][aria-label="Vision"]')).toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>('#ai-settings-tab-prompt')!.click(); });
    const textarea = host.querySelector<HTMLTextAreaElement>('[role="tabpanel"] textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Updated');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: 'Updated' }));
  } finally {
    await act(async () => root.unmount());
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});

it('stores and deletes images without affecting other sessions', async () => {
  const store = createIndexedDbImageStore(`shared-images-${crypto.randomUUID()}`);
  const image = new NodeBlob(['image'], { type: 'image/png' }) as unknown as Blob;
  await store.saveImage('first', 'one', image);
  await store.saveImage('first', 'two', image);
  await store.saveImage('second', 'one', image);
  expect((await store.loadImage('first', 'one'))?.size).toBe(image.size);
  await store.deleteImages([{ sessionId: 'first', imageId: 'one' }]);
  expect(await store.loadImage('first', 'one')).toBeNull();
  await store.deleteSessionImages('first');
  expect(await store.loadImage('first', 'two')).toBeNull();
  expect((await store.loadImage('second', 'one'))?.size).toBe(image.size);
});

it('stores attachments and generated images with their session', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const images = createIndexedDbImageStore(`shared-chat-images-${crypto.randomUUID()}`);
  const storage: AssistantStorage = { load: async () => null, save: async () => {}, images };
  const runner: AssistantRunner = async (entries, events) => {
    const blob = await events.loadImage(entries[0].images![0].id);
    expect(blob?.size).toBe(5);
    const generated = await events.saveImage(blob!, 'generated.png');
    events.onTool({ id: 'tool', name: 'generate_image', arguments: '{}', status: 'success', image: generated });
    events.onHistory([{ role: 'user', content: [{ type: 'input_image', image_url: 'attachment://upload' }] },
      { type: 'function_call_output', output: [{ type: 'input_image', image_url: `attachment://${generated.id}` }] }]);
  };
  const host = document.createElement('div');
  const root = createRoot(host);
  let assistant: ReturnType<typeof useAssistant>;
  function Harness() { assistant = useAssistant(runner, storage); return null; }
  try {
    await act(async () => { root.render(<Harness />); });
    const blob = new NodeBlob(['image'], { type: 'image/png' }) as unknown as Blob;
    await act(async () => { await assistant!.send('image', [{ image: { id: 'upload', name: 'upload.png', type: 'image/png', size: 5 }, blob }]); });
    expect(assistant!.entries[0].images?.[0].id).toBe('upload');
    expect(assistant!.entries[1].images?.[0].name).toBe('generated.png');
    expect(assistant!.entries[1].tools?.[0].image?.id).toBe(assistant!.entries[1].images?.[0].id);
    expect(assistant!.canRegenerate).toBe(false);
    const sessionId = assistant!.activeSessionId!;
    const generatedId = assistant!.entries[1].images![0].id;
    expect((await images.loadImage(sessionId, 'upload'))?.size).toBe(5);
    await act(async () => { expect(await assistant!.deleteImages!([{ sessionId, imageId: generatedId }])).toBe(true); });
    expect(await images.loadImage(sessionId, generatedId)).toBeNull();
    expect(assistant!.entries[1].tools?.[0].image).toBeUndefined();
    expect(JSON.stringify(assistant!.sessions[0].responseItems)).toContain('[Chat image deleted by user]');
    expect(JSON.stringify(assistant!.sessions[0].responseItems)).not.toContain(`attachment://${generatedId}`);
    await act(async () => { await assistant!.deleteSession(sessionId); });
    expect(await images.loadImage(sessionId, 'upload')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it('does not call the model when saving the new turn fails', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const images = createIndexedDbImageStore(`failed-save-images-${crypto.randomUUID()}`);
  const storage: AssistantStorage = { load: async () => null, save: async () => { throw new Error('Storage full'); }, images };
  const runner = vi.fn(async () => {});
  const root = createRoot(document.createElement('div'));
  let assistant: ReturnType<typeof useAssistant>;
  function Harness() { assistant = useAssistant(runner, storage); return null; }
  try {
    await act(async () => { root.render(<Harness />); });
    const sessionId = assistant!.activeSessionId!;
    const blob = new NodeBlob(['image'], { type: 'image/png' }) as unknown as Blob;
    await act(async () => { await expect(assistant!.send('image', [{ image: { id: 'failed-upload', name: 'upload.png', type: 'image/png', size: 5 }, blob }])).rejects.toThrow('Storage full'); });
    expect(runner).not.toHaveBeenCalled();
    expect(assistant!.entries).toEqual([]);
    expect(await images.loadImage(sessionId, 'failed-upload')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it('encrypts credentials and preserves them when rotating the browser key', async () => {
  const endpoint = createEndpoint('openai');
  const config: AiConfig = { endpoints: [endpoint], activeSelection: { endpointId: endpoint.id, modelId: endpoint.models[0].id }, systemPrompt: '' };
  const databaseName = `browser-ai-${crypto.randomUUID()}`;
  const store = createBrowserAiStore({ databaseName, defaultConfig: () => config, normalizeConfig });
  expect(await store.encryption.status()).toBe('missing');
  const withSecret = { ...config, endpoints: [{ ...endpoint, apiKey: 'secret-value' }] };
  await expect(store.saveConfig(withSecret)).rejects.toThrow('Create or import');
  const initial = await store.encryption.generate('create');
  initial.fill(0);
  await store.saveConfig(withSecret);
  expect((await store.loadConfig()).endpoints[0].apiKey).toBe('secret-value');
  const reopened = createBrowserAiStore({ databaseName, defaultConfig: () => config, normalizeConfig });
  expect((await reopened.loadConfig()).endpoints[0].apiKey).toBe('secret-value');
  const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(databaseName); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const storedConfig = await new Promise<AiConfig>((resolve, reject) => { const request = database.transaction('settings').objectStore('settings').get('config'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  database.close();
  expect(storedConfig.endpoints[0].apiKey).toBe('');
  const replacement = await store.encryption.generate('rotate');
  replacement.fill(0);
  expect((await store.loadConfig()).endpoints[0].apiKey).toBe('secret-value');
  expect(await store.encryption.status()).toBe('ready');
});

it('follows changes to the system color scheme', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let change: ((event: { matches: boolean }) => void) | undefined;
  const remove = vi.fn();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: (_type: string, callback: typeof change) => { change = callback; }, removeEventListener: remove }));
  const host = document.createElement('div');
  const root = createRoot(host);
  function Harness() { return <span>{useResolvedTheme('system')}</span>; }
  try {
    await act(async () => { root.render(<Harness />); });
    expect(host.textContent).toBe('light');
    await act(async () => { change!({ matches: true }); });
    expect(host.textContent).toBe('dark');
  } finally { await act(async () => root.unmount()); }
  expect(remove).toHaveBeenCalled();
});

it('uses host features without saving them and permits zero limits', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  const endpoint = createEndpoint('openai');
  const config: AiConfig = { endpoints: [endpoint], activeSelection: { endpointId: endpoint.id, modelId: endpoint.models[0].id }, systemPrompt: 'Original', maxToolRounds: 24, maxImageFailures: 3 };
  const onSave = vi.fn(async (_value: AiConfig) => {});
  const renderFonts = vi.fn(() => null);
  const host = document.createElement('div');
  const root = createRoot(host);
  const render = (fontManagement: boolean, onlineFonts: boolean) => root.render(<AiSettings config={config} onSave={onSave} onBack={() => {}} english={false}
    features={{ imageGeneration: false, skills: false, quickSnippets: false, fontManagement, onlineFonts }}
    store={{ loadConfig: async () => config }} onKeyChanged={async () => {}} createEndpoint={createEndpoint} createModel={createModel}
    normalizeConfig={normalizeConfig} resolveSelection={resolveSelection} defaults={DEFAULT_SETTINGS} initialSecurity
    renderImageModels={() => null} renderSkills={() => null} renderFonts={renderFonts} />);
  try {
    await act(async () => { render(false, true); });
    expect(host.querySelector('[id^="ai-feature-"]')).toBeNull();
    expect(renderFonts).not.toHaveBeenCalled();
    expect(host.querySelector('#ai-settings-tab-images')).toBeNull();
    expect(host.querySelector('#ai-settings-tab-skills')).toBeNull();
    expect(host.querySelector('#ai-settings-tab-snippets')).toBeNull();
    await act(async () => { render(true, false); });
    expect(renderFonts).toHaveBeenLastCalledWith([], expect.any(Function), false, { localFonts: true, onlineFonts: false });
    for (const id of ['ai-max-tool-rounds', 'ai-max-image-failures']) {
      const field = host.querySelector<HTMLInputElement>(`#${id}`)!;
      expect(field.min).toBe('0');
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '0'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    }
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ maxToolRounds: 0, maxImageFailures: 0 }));
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('features');
  } finally {
    await act(async () => root.unmount());
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});