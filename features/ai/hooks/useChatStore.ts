import { useMemo, useRef } from 'react';
import type { WorkspaceOptions } from '../services/workspace.ts';
import { createBrowserChatStore, createFileChatStore } from '../services/chatStore.ts';
import { createDirectoryChatAccess, createTauriChatAccess } from '../services/chatFileAccess.ts';

export function useChatStore(workspace: WorkspaceOptions) {
  const latest = useRef(workspace);
  latest.current = workspace;
  const filePath = workspace.activeLocalPath;
  const key = filePath ? 'tauri:' + filePath.replace(/[/\\][^/\\]+$/, '') : workspace.storage.type === 'localfile' ? workspace.chatStorageKey || 'directory' : 'indexeddb';
  return useMemo(() => {
    if (filePath) return createFileChatStore(createTauriChatAccess(filePath), key);
    if (key === 'indexeddb') return createBrowserChatStore();
    return createFileChatStore(createDirectoryChatAccess(async () => {
      const directory = latest.current.getChatDirectory;
      if (!directory) throw new Error('Select a project storage folder first.');
      return directory();
    }), key);
  }, [key]);
}