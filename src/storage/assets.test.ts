import { describe, expect, it, vi } from 'vitest';
import { findAsset, folderAssets, getAssetFolder } from './assets.ts';
import type { LocalFileAdapter } from './storage.ts';

function folder(name: string, entries: Record<string, FileSystemHandle> = {}, permission: PermissionState = 'granted'): FileSystemDirectoryHandle {
  return {
    name, kind: 'directory',
    entries: async function* () { yield* Object.entries(entries); },
    queryPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => permission),
    getDirectoryHandle: vi.fn(async (key: string) => {
      const entry = entries[key];
      if (entry?.kind !== 'directory') throw new DOMException('Missing directory', 'NotFoundError');
      return entry;
    }),
    getFileHandle: vi.fn(async (key: string) => {
      const entry = entries[key];
      if (entry?.kind !== 'file') throw new DOMException('Missing file', 'NotFoundError');
      return entry;
    })
  } as unknown as FileSystemDirectoryHandle;
}

const file = (name: string) => ({ name, kind: 'file', getFile: vi.fn() }) as unknown as FileSystemFileHandle;

describe('asset folder references', () => {
  it('uses exact relative paths and distinguishes same-named files', async () => {
    const first = file('logo.svg');
    const second = file('logo.svg');
    const root = folder('assets', {
      'Brand-品牌': folder('Brand-品牌', { 'logo.svg': first, 'photo.PNG': file('photo.PNG'), 'ignored.jpg': file('ignored.jpg') }),
      Other: folder('Other', { 'logo.svg': second }),
      'root.svg': file('root.svg')
    });
    const entries = await folderAssets(root);
    expect(entries.map(entry => entry.assetId)).toEqual(['folder:Brand-品牌/logo.svg', 'folder:Brand-品牌/photo.PNG', 'folder:Other/logo.svg']);
    expect(entries[0].categoryZh).toBe('品牌');
    expect((await findAsset(entries[0].assetId, root)).fileHandle).toBe(first);
    expect((await findAsset('folder:Other/logo.svg', root)).fileHandle).toBe(second);
    expect(first.getFile).not.toHaveBeenCalled();
  });

  it('rejects builtins and requires a folder for file references', async () => {
    await expect(findAsset('builtin:Basic Shapes/Circle', null)).rejects.toThrow('Invalid assetId');
    await expect(findAsset('folder:Brand/logo.svg', null)).rejects.toThrow('No asset folder');
  });

  it('rejects traversal, absolute paths, unsupported formats and nested paths before reading', async () => {
    const root = folder('assets');
    for (const assetId of ['folder:../logo.svg', 'folder:/logo.svg', 'folder:Brand\\Other/logo.svg', 'folder:Brand/logo.jpg', 'folder:Brand/nested/logo.svg', 'unknown:Brand/logo.svg']) {
      await expect(findAsset(assetId, root)).rejects.toThrow(/Invalid/);
    }
    expect(root.getDirectoryHandle).not.toHaveBeenCalled();
  });

  it('reads local lib without creating folders or prompting for permission', async () => {
    const library = folder('lib');
    const root = folder('storage', { lib: library });
    const adapter = { ensureReady: vi.fn(async () => true), getRootHandle: () => root } as unknown as LocalFileAdapter;
    expect(await getAssetFolder('localfile', adapter)).toBe(library);
    expect(adapter.ensureReady).toHaveBeenCalledWith({ prompt: false });
    expect(root.getDirectoryHandle).toHaveBeenCalledWith('lib');
    const denied = folder('lib', {}, 'prompt');
    const deniedAdapter = { ...adapter, getRootHandle: () => folder('storage', { lib: denied }) } as LocalFileAdapter;
    await expect(getAssetFolder('localfile', deniedAdapter)).rejects.toThrow('permission');
    expect((denied as unknown as { requestPermission: ReturnType<typeof vi.fn> }).requestPermission).not.toHaveBeenCalled();
    const emptyAdapter = { ...adapter, getRootHandle: () => folder('storage') } as LocalFileAdapter;
    expect(await getAssetFolder('localfile', emptyAdapter)).toBeNull();
  });
});