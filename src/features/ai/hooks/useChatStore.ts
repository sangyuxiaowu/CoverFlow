import { useMemo } from 'react';
import type { WorkspaceOptions } from '../services/workspace.ts';
import { createBrowserChatStore, createFileChatStore } from '../services/chatStore.ts';
import { createDirectoryChatAccess, createTauriChatAccess } from '../services/chatFileAccess.ts';

export function useChatStore(workspace: WorkspaceOptions) {
  const filePath = workspace.localFileIsBrowser ? null : workspace.activeLocalPath;
  const key = filePath ? 'tauri:' + filePath.replace(/[/\\][^/\\]+$/, '') : workspace.storage.type === 'localfile' ? workspace.chatStorageKey || 'directory' : 'indexeddb';
  return useMemo(() => {
    if (filePath) return createFileChatStore(createTauriChatAccess(filePath), key);
    if (key === 'indexeddb') return createBrowserChatStore();
    const directory = workspace.getChatDirectory;
    return createFileChatStore(createDirectoryChatAccess(async () => {
      if (!directory) throw new Error('Select a project storage folder first.');
      return directory();
    }), key);
  }, [key]);
}