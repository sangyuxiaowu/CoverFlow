import type { ChatFileAccess } from './chatStore.ts';

type DirectoryEntries = FileSystemDirectoryHandle & { entries: () => AsyncIterableIterator<[string, FileSystemHandle]> };

export function createDirectoryChatAccess(root: () => Promise<FileSystemDirectoryHandle>): ChatFileAccess {
  const directory = async (path: string, create: boolean) => {
    let handle = await root();
    for (const name of path.split('/').filter(Boolean)) handle = await handle.getDirectoryHandle(name, { create });
    return handle;
  };
  const locate = async (path: string, create: boolean) => {
    const parts = path.split('/');
    const name = parts.pop()!;
    return { parent: await directory(parts.join('/'), create), name };
  };
  return {
    read: async path => {
      try { const { parent, name } = await locate(path, false); return (await (await parent.getFileHandle(name)).getFile()).text(); }
      catch (error) { if ((error as DOMException).name === 'NotFoundError') return null; throw error; }
    },
    write: async (path, content) => {
      const { parent, name } = await locate(path, true);
      const writable = await (await parent.getFileHandle(name, { create: true })).createWritable();
      try { await writable.write(content); await writable.close(); }
      catch (error) { await writable.abort().catch(() => {}); throw error; }
    },
    remove: async path => {
      try { const { parent, name } = await locate(path, false); await parent.removeEntry(name); }
      catch (error) { if ((error as DOMException).name !== 'NotFoundError') throw error; }
    },
    list: async path => {
      try {
        const handle = await directory(path, false) as DirectoryEntries;
        const files: string[] = [];
        for await (const [name, entry] of handle.entries()) if (entry.kind === 'file') files.push(name);
        return files;
      } catch (error) { if ((error as DOMException).name === 'NotFoundError') return []; throw error; }
    }
  };
}

export function createTauriChatAccess(projectPath: string): ChatFileAccess {
  let authorizedRoot: Promise<string> | undefined;
  const path = async (relative: string) => {
    if (!authorizedRoot) {
      authorizedRoot = import('@tauri-apps/api/core').then(({ invoke }) => invoke<string>('prepare_chat_storage', { projectPath })).catch(error => { authorizedRoot = undefined; throw error; });
    }
    const { join } = await import('@tauri-apps/api/path');
    return join(await authorizedRoot, ...relative.split('/'));
  };
  return {
    read: async relative => { const fs = await import('@tauri-apps/plugin-fs'); const target = await path(relative); return await fs.exists(target) ? fs.readTextFile(target) : null; },
    write: async (relative, content) => {
      const fs = await import('@tauri-apps/plugin-fs');
      const { dirname } = await import('@tauri-apps/api/path');
      const target = await path(relative);
      await fs.mkdir(await dirname(target), { recursive: true });
      const temporary = target + '.tmp';
      try { await fs.writeTextFile(temporary, content); await fs.rename(temporary, target); }
      catch (error) { if (await fs.exists(temporary)) await fs.remove(temporary).catch(() => {}); throw error; }
    },
    remove: async relative => { const fs = await import('@tauri-apps/plugin-fs'); const target = await path(relative); if (await fs.exists(target)) await fs.remove(target); },
    list: async relative => { const fs = await import('@tauri-apps/plugin-fs'); const target = await path(relative); return await fs.exists(target) ? (await fs.readDir(target)).filter(entry => entry.isFile).map(entry => entry.name) : []; }
  };
}