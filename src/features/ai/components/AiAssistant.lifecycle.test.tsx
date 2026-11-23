// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { AssistantController } from 'sang-ai-kit';
import type { ChatStore } from '../services/chatStore.ts';
import type { ChatSession } from '../types.ts';
import type { WorkspaceOptions } from '../services/workspace.ts';
import type { StorageAdapter } from '../../../storage/StorageAdapter.ts';
import { defaultConfig } from '../services/config.ts';
import { runConversation } from '../services/conversation.ts';
import AiAssistant from './AiAssistant.tsx';

const state = vi.hoisted(() => ({ store: null as ChatStore | null, assistant: null as AssistantController | null }));
vi.mock('../hooks/useChatStore.ts', () => ({ useChatStore: () => state.store }));
vi.mock('sang-ai-kit/assistant', () => ({ default: ({ assistant }: { assistant: AssistantController }) => { state.assistant = assistant; return null; } }));
vi.mock('sang-ai-kit/floating', () => ({ useFloatingPanel: () => ({}) }));
vi.mock('../services/conversation.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../services/conversation.ts')>(),
  runConversation: vi.fn()
}));

const workspace: WorkspaceOptions = {
  project: null, selectedLayerIds: [], storage: {} as StorageAdapter, localProjects: [], activeLocalPath: null,
  onCommit: () => {}, onOpen: async () => {}, onUpsert: () => {}, onDelete: () => {}, onSearch: () => {}, saveLocal: async () => {}
};

function memoryStore(id: string): ChatStore {
  const sessions = new Map<string, ChatSession>();
  return {
    id, loadConfig: async () => defaultConfig(), saveConfig: async () => {},
    listSessions: vi.fn(async () => [...sessions.values()].map(session => structuredClone(session))),
    saveSession: vi.fn(async session => { sessions.set(session.id, structuredClone(session)); }),
    saveImage: async () => {}, loadImage: async () => null, pruneImages: async () => {}, deleteImages: async () => {},
    deleteSession: async id => { sessions.delete(id); }, loadUiState: async () => ({}), saveUiState: async () => {}
  };
}

it('waits for interrupted generation and its final save before replacing the controller', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const first = memoryStore('first');
  const second = memoryStore('second');
  const save = first.saveSession;
  let release!: () => void;
  let notify!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const saving = new Promise<void>(resolve => { notify = resolve; });
  first.saveSession = vi.fn(async session => {
    if (session.entries.at(-1)?.content.includes('聊天存储位置已切换')) { notify(); await gate; }
    await save(session);
  });
  vi.mocked(runConversation).mockImplementation(async ({ signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const root = createRoot(document.createElement('div'));
  const render = () => root.render(<AiAssistant workspace={workspace} lang="zh" onBusyChange={() => {}} open />);
  try {
    state.store = first;
    await act(async () => render());
    let task!: Promise<void>;
    await act(async () => { task = state.assistant!.send('First'); });
    await act(async () => { await state.assistant!.send('Queued'); });
    state.store = second;
    await act(async () => render());
    await act(async () => { await saving; });
    expect(state.assistant!.busy).toBe(true);
    expect(second.listSessions).not.toHaveBeenCalled();
    expect(state.assistant!.entries[0].content).toBe('First');
    await act(async () => { release(); await task; });
    expect(second.listSessions).toHaveBeenCalledOnce();
    expect(state.assistant!.queuedMessages).toEqual([]);
    state.store = first;
    await act(async () => render());
    expect(state.assistant!.queuedMessages).toEqual([]);
    expect(state.assistant!.entries.at(-1)?.content).toContain('聊天存储位置已切换');
    expect(runConversation).toHaveBeenCalledOnce();
  } finally {
    release();
    await act(async () => root.unmount());
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    state.store = null;
    state.assistant = null;
  }
});
