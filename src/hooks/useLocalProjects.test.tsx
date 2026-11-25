// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';
import { useLocalProjects } from './useLocalProjects.ts';
import { readLegacyCfj } from '../storage/legacyCfj.ts';
import { decodeProjectArchive, encodeProjectArchive } from '../storage/projectArchive.ts';
import type { BrowserRecentProject } from '../storage/browserRecentProjects.ts';

const recentFiles = vi.hoisted(() => new Map<string, BrowserRecentProject>());
vi.mock('../storage/browserRecentProjects.ts', () => ({
  listBrowserRecentProjects: async () => [...recentFiles.values()],
  putBrowserRecentProject: async (item: BrowserRecentProject) => { recentFiles.set(item.path, item); },
  removeBrowserRecentProject: async (path: string) => { recentFiles.delete(path); }
}));

const project = readLegacyCfj(JSON.stringify({ id: 'file-project', title: 'Original', updatedAt: 1, pages: [{ id: 'page', name: '', layers: [], background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 }, canvasConfig: { width: 100, height: 100 } }] }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  recentFiles.clear();
});

it('opens and writes an associated CFJX file, preserving it when permission or writes fail', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('Blob', NodeBlob);
  const bytes = await encodeProjectArchive(project, {});
  const write = vi.fn(async (_blob: Blob) => {});
  const close = vi.fn(async () => {});
  const abort = vi.fn(async () => {});
  const requestPermission = vi.fn(async () => 'granted' as PermissionState);
  const handle = {
    kind: 'file', name: 'cover.cfjx',
    getFile: vi.fn(async () => ({ arrayBuffer: async () => bytes.slice().buffer })),
    queryPermission: vi.fn(async () => 'prompt' as PermissionState),
    requestPermission,
    isSameEntry: vi.fn(async () => true),
    createWritable: vi.fn(async () => ({ write, close, abort }))
  } as unknown as FileSystemFileHandle;
  const showToast = vi.fn();
  const onOpenProject = vi.fn(async (opened: typeof project, _session: unknown, beforeCommit?: () => boolean) => {
    if (beforeCommit && !beforeCommit()) throw new Error('Changed');
    return opened;
  });
  let hook!: ReturnType<typeof useLocalProjects>;
  function Harness() {
    hook = useLocalProjects({ view: 'landing', parseFailedMessage: 'Invalid', showToast, onOpenProject, onUpdateProject: () => {} });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => { await hook.openBrowserProject(handle, async () => () => true); });
    expect(onOpenProject).toHaveBeenCalledOnce();
    const path = hook.activeLocalFilePath!;
    expect(path).toMatch(/^pwa:/);
    expect(hook.localRecentItems).toEqual([expect.objectContaining({ localPath: path })]);
    await act(async () => { await hook.saveLocalProjectToFile(path, { ...project, title: 'Edited' }); });
    const written = write.mock.calls[0][0] as unknown as NodeBlob;
    expect((await decodeProjectArchive(new Uint8Array(await written.arrayBuffer()))).title).toBe('Edited');
    expect(close).toHaveBeenCalledOnce();

    requestPermission.mockResolvedValueOnce('denied');
    await expect(hook.saveLocalProjectToFile(path, project)).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(write).toHaveBeenCalledOnce();

    write.mockRejectedValueOnce(new Error('Disk full'));
    await expect(hook.saveLocalProjectToFile(path, project)).rejects.toThrow('Disk full');
    expect(abort).toHaveBeenCalledOnce();
    await act(async () => { await hook.saveLocalProjectToFile(path, project); });
    expect(close).toHaveBeenCalledTimes(2);

    await act(async () => { await hook.openBrowserProject(handle, async () => null); });
    expect(hook.activeLocalFilePath).toBe(path);
    await act(async () => { await hook.openBrowserProject(handle, async () => () => false); });
    expect(hook.activeLocalFilePath).toBe(path);
    expect(showToast).toHaveBeenCalledWith('Invalid', 'error');
    await act(async () => { await hook.openBrowserProject(handle, async () => () => true); });
    expect(hook.localRecentItems).toHaveLength(1);
    expect(hook.activeLocalFilePath).toBe(path);
  } finally {
    await act(async () => root.unmount());
  }
});

it('restores recent files and requests permission when reopening, without deleting the file', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const bytes = await encodeProjectArchive(project, {});
  const requestPermission = vi.fn(async () => 'denied' as PermissionState);
  const handle = {
    name: 'cover.cfjx', kind: 'file',
    getFile: vi.fn(async () => ({ arrayBuffer: async () => bytes.slice().buffer })),
    queryPermission: vi.fn(async () => 'prompt' as PermissionState),
    requestPermission,
    isSameEntry: vi.fn(async () => true)
  } as unknown as FileSystemFileHandle;
  const showToast = vi.fn();
  const onOpenProject = vi.fn(async (opened: typeof project) => opened);
  let hook!: ReturnType<typeof useLocalProjects>;
  function Harness() {
    hook = useLocalProjects({ view: 'landing', parseFailedMessage: 'Invalid', showToast, onOpenProject, onUpdateProject: () => {} });
    return null;
  }
  const first = createRoot(document.createElement('div'));
  await act(async () => first.render(<Harness />));
  await act(async () => { await hook.openBrowserProject(handle, async () => () => true); });
  const path = hook.activeLocalFilePath!;
  await act(async () => first.unmount());
  const second = createRoot(document.createElement('div'));
  try {
    await act(async () => second.render(<Harness />));
    expect(hook.localRecentItems).toEqual([expect.objectContaining({ localPath: path })]);
    await act(async () => { await hook.openLocalProjectFromPath(path); });
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'read' });
    expect(hook.activeLocalFilePath).toBeNull();
    expect(hook.localRecentItems).toHaveLength(1);
    requestPermission.mockResolvedValueOnce('granted');
    await act(async () => { await hook.openLocalProjectFromPath(path); });
    expect(hook.activeLocalFilePath).toBe(path);
    await act(async () => { hook.removeLocalRecentByPath(path); });
    expect(hook.localRecentItems).toHaveLength(0);
    expect(recentFiles.size).toBe(0);
    expect(handle.getFile).toHaveBeenCalledTimes(2);
  } finally { await act(async () => second.unmount()); }
});