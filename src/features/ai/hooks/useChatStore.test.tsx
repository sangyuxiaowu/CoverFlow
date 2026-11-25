// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useChatStore } from './useChatStore.ts';
import type { ChatStore } from '../services/chatStore.ts';
import type { WorkspaceOptions } from '../services/workspace.ts';
import type { StorageAdapter } from '../../../storage/StorageAdapter.ts';

it('keeps each directory store bound to its original handle even when folder names match', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const missing = () => Promise.reject(new DOMException('Missing', 'NotFoundError'));
  const firstDirectory = { name: 'same', getDirectoryHandle: vi.fn(missing) } as unknown as FileSystemDirectoryHandle;
  const secondDirectory = { name: 'same', getDirectoryHandle: vi.fn(missing) } as unknown as FileSystemDirectoryHandle;
  const first = vi.fn(async () => firstDirectory);
  const second = vi.fn(async () => secondDirectory);
  const base: WorkspaceOptions = {
    project: null, selectedLayerIds: [], storage: { type: 'localfile' } as StorageAdapter, localProjects: [], activeLocalPath: null,
    onCommit: () => {}, onOpen: async () => {}, onUpsert: () => {}, onDelete: () => {}, onSearch: () => {}, saveLocal: async () => {}
  };
  let store!: ChatStore;
  function Harness({ workspace }: { workspace: WorkspaceOptions }) { store = useChatStore(workspace); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Harness workspace={{ ...base, chatStorageKey: 'same:1', getChatDirectory: first }} />));
    const oldStore = store;
    await act(async () => root.render(<Harness workspace={{ ...base, chatStorageKey: 'same:2', getChatDirectory: second }} />));
    expect(store).not.toBe(oldStore);
    await oldStore.listSessions();
    await store.listSessions();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    const directoryStore = store;
    await act(async () => root.render(<Harness workspace={{ ...base, activeLocalPath: 'pwa:1:cover.cfjx', localFileIsBrowser: true, chatStorageKey: 'same:2', getChatDirectory: second }} />));
    expect(store).toBe(directoryStore);
    await store.listSessions();
    expect(second).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
