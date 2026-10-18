// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useAiAssistant } from './useAiAssistant.ts';
import { ConversationAbortError, runConversation } from '../services/conversation.ts';
import { defaultConfig } from '../services/config.ts';
import type { ChatStore } from '../services/chatStore.ts';
import type { WorkspaceOptions } from '../services/workspace.ts';
import type { StorageAdapter } from '../../../storage/StorageAdapter.ts';
import type { ChatSession } from '../types.ts';

vi.mock('../services/conversation.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../services/conversation.ts')>(),
  runConversation: vi.fn()
}));

const roots = new Set<Root>();
const workspace: WorkspaceOptions = {
  project: null, selectedLayerIds: [], storage: {} as StorageAdapter, localProjects: [], activeLocalPath: null,
  onCommit: () => {}, onOpen: async () => {}, onUpsert: () => {}, onDelete: () => {}, onSearch: () => {}, saveLocal: async () => {}
};

function memoryStore(id = 'test'): ChatStore {
  return {
    id, loadConfig: async () => defaultConfig(), saveConfig: async () => {}, listSessions: async () => [],
    saveSession: vi.fn(async () => {}), saveImage: async () => {}, loadImage: async () => null,
    pruneImages: async () => {}, deleteSession: async () => {}, loadUiState: async () => ({}), saveUiState: async () => {}
  };
}

async function mount(store = memoryStore()) {
  let assistant: ReturnType<typeof useAiAssistant>;
  const onBusyChange = vi.fn();
  const root = createRoot(document.createElement('div'));
  roots.add(root);
  function Harness({ target }: { target: ChatStore }) {
    assistant = useAiAssistant(workspace, onBusyChange, target);
    return null;
  }
  const render = async (target = store) => { await act(async () => { root.render(<Harness target={target} />); }); };
  await render();
  return { getAssistant: () => assistant!, render, root, store };
}

function waitForAbort() {
  let signal: AbortSignal;
  vi.mocked(runConversation).mockImplementation(async options => {
    signal = options.signal;
    return new Promise<string>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  return () => signal!;
}

afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount(); });
  roots.clear();
  vi.mocked(runConversation).mockReset();
  vi.unstubAllGlobals();
});

it('deletes selected images and history references before pruning, preserving other assets and snapshots', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const image = { id: 'preview', name: 'canvas-preview.webp', type: 'image/webp' as const, size: 100 };
  const keep = { ...image, id: 'generated', name: 'generated.png' };
  const history: ChatSession['responseItems'] = [
    { role: 'user', content: [{ type: 'input_image', image_url: 'attachment://preview', detail: 'auto' }, { type: 'input_text', text: 'Keep text' }] },
    { type: 'function_call_output', call_id: 'call', output: [{ type: 'input_image', image_url: 'attachment://preview' }] }
  ];
  const session: ChatSession = {
    id: 'session', title: 'Test', createdAt: 1, updatedAt: 2, requests: [], responseItems: history,
    entries: [{ id: 'entry', role: 'assistant', content: 'Kept', images: [image, keep], tools: [
      { id: 'tool', name: 'get_canvas_preview', arguments: '{}', status: 'success', image },
      { id: 'other', name: 'generate_image', arguments: '{}', status: 'success', image: keep }
    ], previousResponseItems: history, projectSnapshot: null }]
  };
  const store = memoryStore();
  store.listSessions = async () => [structuredClone(session)];
  store.pruneImages = vi.fn(async () => {});
  const harness = await mount(store);
  await act(async () => { expect(await harness.getAssistant().deleteImages([{ sessionId: 'session', imageId: 'preview' }])).toBe(true); });
  const next = harness.getAssistant().sessions[0];
  expect(next.entries[0].images).toEqual([keep]);
  expect(next.entries[0].tools?.[0].image).toBeUndefined();
  expect(next.entries[0].tools?.[1].image).toEqual(keep);
  expect(JSON.stringify(next)).not.toContain('attachment://preview');
  expect(JSON.stringify(next.responseItems)).toContain('Keep text');
  expect(next.entries[0].projectSnapshot).toBeNull();
  expect(next.updatedAt).toBe(2);
  expect(harness.getAssistant().entries).toEqual(next.entries);
  expect(store.pruneImages).toHaveBeenCalledWith('session', ['generated', 'generated']);
  expect(vi.mocked(store.saveSession).mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(store.pruneImages).mock.invocationCallOrder[0]);
});

it.each(['user_stop', 'panel_closed'] as const)('records %s without confusing it with missing retry approval', async source => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const getSignal = waitForAbort();
  const harness = await mount();
  let pending: Promise<void>;
  await act(async () => { pending = harness.getAssistant().send('Generate'); });
  expect(getSignal().aborted).toBe(false);
  await act(async () => { harness.getAssistant().stop(source); await pending!; });
  expect(getSignal().reason).toBeInstanceOf(ConversationAbortError);
  expect(getSignal().reason.source).toBe(source);
  const content = harness.getAssistant().entries.at(-1)!.content;
  expect(content).toContain(source === 'user_stop' ? '已停止' : '面板已关闭');
  expect(content).not.toContain('approval');
  expect(harness.getAssistant().busy).toBe(false);
});

it('does not abort an active turn on an ordinary rerender', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const getSignal = waitForAbort();
  const harness = await mount();
  let pending: Promise<void>;
  await act(async () => { pending = harness.getAssistant().send('Generate'); });
  await harness.render();
  expect(getSignal().aborted).toBe(false);
  await act(async () => { harness.getAssistant().stop(); await pending!; });
});

it('distinguishes a real storage switch from assistant disposal', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const getSignal = waitForAbort();
  const harness = await mount();
  let pending: Promise<void>;
  await act(async () => { pending = harness.getAssistant().send('Generate'); });
  await harness.render(memoryStore('other-directory'));
  await act(async () => { await pending!; });
  expect(getSignal().reason.source).toBe('storage_changed');
  const saved = vi.mocked(harness.store.saveSession).mock.calls.at(-1)![0];
  expect(saved.entries.at(-1)!.content).toContain('存储位置已切换');
});

it('records disposal when an active assistant is unmounted', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const getSignal = waitForAbort();
  const harness = await mount();
  let pending: Promise<void>;
  await act(async () => { pending = harness.getAssistant().send('Generate'); });
  await act(async () => { harness.root.unmount(); roots.delete(harness.root); await pending!; });
  expect(getSignal().reason.source).toBe('assistant_disposed');
  const saved = vi.mocked(harness.store.saveSession).mock.calls.at(-1)![0];
  expect(saved.entries.at(-1)!.content).toContain('卸载或重新加载');
});

it('passes explicit user approval and a fresh signal when the retry button resumes progress', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(runConversation).mockImplementationOnce(async options => {
    options.onTool({ id: 'failed-tool', name: 'generate_image', arguments: '{}', status: 'error', result: '{"error":"Provider failed"}' });
    options.onHistory?.([...options.input, { type: 'function_call', call_id: 'failed-tool', name: 'generate_image', arguments: '{}' }, { type: 'function_call_output', call_id: 'failed-tool', output: '{"error":"Provider failed"}' }]);
    throw new Error('Response disconnected');
  }).mockResolvedValueOnce('Done');
  const harness = await mount();
  await act(async () => { await harness.getAssistant().send('Generate'); });
  expect(harness.getAssistant().executionError).not.toBeNull();
  await act(async () => { await harness.getAssistant().retry(); });
  const [first, second] = vi.mocked(runConversation).mock.calls.map(call => call[0]);
  expect(second.signal).not.toBe(first.signal);
  expect(second.signal.aborted).toBe(false);
  expect(second.input.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('明确批准重试') });
  expect(JSON.stringify(second.input)).toContain('Provider failed');
  expect(harness.getAssistant().executionError).toBeNull();
});