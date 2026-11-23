import { expect, it, vi } from 'vitest';
import type { AssistantSession } from 'sang-ai-kit';
import 'fake-indexeddb/auto';
import { createAssistantStorage } from './assistantStorage.ts';
import { createBrowserChatStore, createFileChatStore, type ChatFileAccess, type ChatStore } from './chatStore.ts';
import type { ChatSession } from '../types.ts';
import { defaultConfig } from './config.ts';

it('preserves existing sessions and metadata, creates compatible sessions, and deletes removed sessions', async () => {
  const old: ChatSession = {
    id: 'old', title: 'Old', createdAt: 1, updatedAt: 2, projectId: 'project',
    entries: [], responseItems: [], requests: []
  };
  const sessions = new Map([[old.id, old]]);
  const store: ChatStore = {
    id: 'test', loadConfig: async () => defaultConfig(), saveConfig: async () => {},
    listSessions: async () => [...sessions.values()],
    saveSession: vi.fn(async session => { sessions.set(session.id, structuredClone(session)); }),
    deleteSession: vi.fn(async id => { sessions.delete(id); }),
    loadUiState: async () => ({ activeSessionId: 'old', floatingRect: { x: 1, y: 2, width: 3, height: 4 } }),
    saveUiState: vi.fn(async () => {}),
    saveImage: async () => {}, loadImage: async () => null, pruneImages: async () => {}, deleteImages: async () => {}
  };
  const storage = createAssistantStorage(store, () => 'new-project');
  const loaded = await storage.load();
  expect(loaded?.activeSessionId).toBe('old');
  const next: AssistantSession = { id: 'new', title: 'New', updatedAt: 3, entries: [], requests: [] };
  await storage.save({ sessions: [old, next], activeSessionId: 'new' });
  expect(sessions.get('old')).toEqual(old);
  expect(sessions.get('new')).toMatchObject({ createdAt: expect.any(Number), projectId: 'new-project', responseItems: [] });
  expect(store.saveSession).toHaveBeenCalledTimes(1);
  storage.setProject('new', 'other-project');
  await storage.save({ sessions: [next], activeSessionId: 'new' });
  expect(store.deleteSession).toHaveBeenCalledWith('old');
  expect([...sessions.keys()]).toEqual(['new']);
  expect(sessions.get('new')?.projectId).toBe('other-project');
  expect(store.saveUiState).toHaveBeenLastCalledWith({ activeSessionId: 'new' });
});

it('deletes only the requested browser images and leaves other session images intact', async () => {
  const store = createBrowserChatStore();
  const sessionId = crypto.randomUUID();
  const imageId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const blob = new Blob(['image'], { type: 'image/png' });
  await store.saveImage(sessionId, imageId, blob);
  await store.saveImage(sessionId, otherId, blob);
  await store.deleteImages([{ sessionId: 'other-session', imageId }]);
  expect(await store.loadImage(sessionId, imageId)).not.toBeNull();
  await store.deleteImages([{ sessionId, imageId }]);
  expect(await store.loadImage(sessionId, imageId)).toBeNull();
  expect(await store.loadImage(sessionId, otherId)).not.toBeNull();
  await store.deleteImages([{ sessionId, imageId: otherId }]);
});

it('deletes only the requested file images', async () => {
  const files = new Map<string, Blob>();
  const access: ChatFileAccess = {
    read: async () => null, write: async () => {},
    readBinary: async path => files.get(path) ?? null,
    writeBinary: async (path, blob) => { files.set(path, blob); },
    remove: async path => { files.delete(path); },
    removeDirectory: async () => {}, list: async () => []
  };
  const store = createFileChatStore(access, 'files');
  const blob = new Blob(['image'], { type: 'image/png' });
  await store.saveImage('session', 'one', blob);
  await store.saveImage('session', 'two', blob);
  await store.deleteImages([{ sessionId: 'session', imageId: 'one' }]);
  expect(await store.loadImage('session', 'one')).toBeNull();
  expect(await store.loadImage('session', 'two')).not.toBeNull();
});
