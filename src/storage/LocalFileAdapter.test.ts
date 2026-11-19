import { test, expect, vi } from 'vitest';
import { LocalFileAdapter } from './LocalFileAdapter.ts';
import type { ProjectState } from '../types.ts';
import { syncProjectPages } from './projectCompatibility.ts';
import { decodeProjectArchiveWithPreviews, encodeProjectArchive } from './projectArchive.ts';
import { rememberProjectPreview } from './projectPreviews.ts';
import { readFileBytes } from './fileAccess.ts';

function setup() {
  const write = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const abort = vi.fn().mockResolvedValue(undefined);
  const removeEntry = vi.fn().mockResolvedValue(undefined);
  const directory = {
    getFileHandle: vi.fn(async (name: string) => ({
      name,
      createWritable: vi.fn().mockResolvedValue({ write, close, abort }),
      getFile: async () => ({ arrayBuffer: async () => Uint8Array.from(await encodeProjectArchive(project)).buffer,
        text: async () => JSON.stringify({ id: project.id, title: project.title, version: '9.2.7', pages: [{ id: 'legacy-page', name: '', layers: [], canvasConfig: { width: 100, height: 100, ratio: '1:1' }, background: project.pageInfo.background }] }) })
    })),
    removeEntry
  };
  const adapter = new LocalFileAdapter();
  vi.spyOn(adapter, 'ensureReady').mockResolvedValue(true);
  Object.assign(adapter, { rootHandle: { getDirectoryHandle: async () => directory } });
  const project: ProjectState = syncProjectPages({ id: 'recovery-test', title: 'Recovery', updatedAt: 1, selectedLayerId: null, layers: [], pageInfo: { width: 100, height: 100, background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 } } });
  return { adapter, project, write, close, abort, removeEntry, directory };
}

test('reading archive bytes retries a stale file snapshot', async () => {
  const getFile = vi.fn()
    .mockRejectedValueOnce(new DOMException('The file changed on disk.', 'NotReadableError'))
    .mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  await expect(readFileBytes({ getFile } as unknown as FileSystemFileHandle)).resolves.toEqual(new Uint8Array([1, 2, 3]));
  expect(getFile).toHaveBeenCalledTimes(2);
});

test('save recovers a changed file snapshot and aborts the failed stream', async () => {
  const { adapter, project, write, close, abort } = setup();
  close.mockRejectedValueOnce(new DOMException('The file changed on disk.', 'NotReadableError'));
  await expect(adapter.saveProject(project)).resolves.toBeUndefined();
  expect(write).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledTimes(2);
  expect(abort).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[1][0]).toBe(write.mock.calls[0][0]);
});

test('persistent snapshot failures are reported and later saves can recover', async () => {
  const { adapter, project, close, abort } = setup();
  const error = new DOMException('The file changed on disk.', 'NotReadableError');
  close.mockRejectedValueOnce(error).mockRejectedValueOnce(error).mockRejectedValueOnce(error);
  await expect(adapter.saveProject(project)).rejects.toBe(error);
  expect(close).toHaveBeenCalledTimes(3);
  expect(abort).toHaveBeenCalledTimes(3);
  await expect(adapter.saveProject(project)).resolves.toBeUndefined();
});

test('a failed write does not poison later saves or deletes', async () => {
  const { adapter, project, write, removeEntry } = setup();
  write.mockRejectedValueOnce(new Error('Disk full'));
  await expect(adapter.saveProject(project)).rejects.toThrow('Disk full');
  await expect(adapter.saveProject(project)).resolves.toBeUndefined();
  await expect(adapter.deleteProject(project.id)).resolves.toBeUndefined();
  expect(write).toHaveBeenCalledTimes(2);
  expect(removeEntry).toHaveBeenCalledWith('recovery-test.cfjx');
  expect(removeEntry).toHaveBeenCalledWith('recovery-test.cfj');
});

test('delete reports permission failures but tolerates an already missing file', async () => {
  const { adapter, project, removeEntry } = setup();
  removeEntry.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'));
  await expect(adapter.deleteProject(project.id)).rejects.toThrow('Permission denied');
  removeEntry.mockRejectedValueOnce(new DOMException('Missing', 'NotFoundError'));
  await expect(adapter.deleteProject(project.id)).resolves.toBeUndefined();
});

test('save and delete reject when the storage folder is not ready', async () => {
  const { adapter, project } = setup();
  vi.mocked(adapter.ensureReady).mockResolvedValue(false);
  await expect(adapter.saveProject(project)).rejects.toThrow();
  await expect(adapter.deleteProject(project.id)).rejects.toThrow();
});

test('lists old and new files once per project and falls back when an archive is invalid', async () => {
  const { adapter, project } = setup();
  const archive = await encodeProjectArchive({ ...project, title: 'New' });
  const legacy = new TextEncoder().encode(JSON.stringify({ id: project.id, title: 'Old', version: '9.2.7', pages: [{ id: 'legacy-page', name: '', layers: [], canvasConfig: { width: 100, height: 100, ratio: '1:1' }, background: project.pageInfo.background }] }));
  const entry = (name: string, bytes: Uint8Array, lastModified: number) => ({
    kind: 'file', name,
    getFile: async () => ({ lastModified, text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => Uint8Array.from(bytes).buffer })
  });
  const files = [entry('old.cfj', legacy, 2), entry('new.cfjx', archive, 1)];
  const data = { values: async function* () { yield* files; } };
  Object.assign(adapter, { rootHandle: { getDirectoryHandle: async () => data } });
  expect((await adapter.listProjects()).items.map(item => item.title)).toEqual(['New']);
  expect((await adapter.listProjects({ query: 'New' })).total).toBe(1);
  files[1] = entry('new.cfjx', new Uint8Array([0, 1, 2]), 1);
  expect((await adapter.listProjects()).items.map(item => item.title)).toEqual(['Old']);
});

test('reconciles the index without rereading unchanged archives', async () => {
  const { adapter, project } = setup();
  const files = new Map<string, { bytes: Uint8Array; modified: number; reads: number }>();
  const putProject = async (id: string, title: string, modified: number) => {
    files.set(`${id}.cfjx`, { bytes: await encodeProjectArchive({ ...project, id, title, updatedAt: modified }), modified, reads: 0 });
  };
  await putProject('first', 'First', 1);
  const handle = (name: string) => ({
    kind: 'file', name,
    getFile: async () => {
      const item = files.get(name);
      if (!item) throw new DOMException('Missing', 'NotFoundError');
      return { size: item.bytes.length, lastModified: item.modified,
        text: async () => { item.reads++; return new TextDecoder().decode(item.bytes); },
        arrayBuffer: async () => { item.reads++; return Uint8Array.from(item.bytes).buffer; } };
    },
    createWritable: async () => ({ write: async (content: string) => { files.set(name, { bytes: new TextEncoder().encode(content), modified: 1, reads: 0 }); }, close: async () => {}, abort: async () => {} })
  });
  const data = { values: async function* () { for (const name of files.keys()) if (name.endsWith('.cfjx')) yield handle(name); }, getFileHandle: async (name: string) => handle(name) };
  const root = { getDirectoryHandle: async () => data, getFileHandle: async (name: string, options?: { create?: boolean }) => {
    if (!files.has(name) && !options?.create) throw new DOMException('Missing', 'NotFoundError');
    return handle(name);
  } };
  Object.assign(adapter, { rootHandle: root });
  expect((await adapter.listProjectSummaries()).map(item => item.title)).toEqual(['First']);
  expect(files.get('first.cfjx')?.reads).toBe(1);
  await adapter.listProjectSummaries();
  expect(files.get('first.cfjx')?.reads).toBe(1);
  await putProject('first', 'Updated', 3);
  expect((await adapter.listProjectSummaries()).map(item => item.title)).toEqual(['Updated']);
  expect(files.get('first.cfjx')?.reads).toBe(1);
  await putProject('second', 'Second', 2);
  files.delete('first.cfjx');
  expect((await adapter.listProjectSummaries()).map(item => item.title)).toEqual(['Second']);
  expect((await adapter.getProject('second'))?.title).toBe('Second');
  expect(JSON.parse(new TextDecoder().decode(files.get('project.json')!.bytes)).list.map((item: { name: string }) => item.name)).toEqual(['second.cfjx']);
});

test('writes a generated cover and archive preview only for matching project content', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { adapter, project } = setup();
  const files = new Map<string, { bytes: Uint8Array; modified: number }>();
  const preview = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
  const handle = (name: string) => ({
    kind: 'file', name,
    getFile: async () => {
      const item = files.get(name);
      if (!item) throw new DOMException('Missing', 'NotFoundError');
      return { size: item.bytes.length, lastModified: item.modified, text: async () => new TextDecoder().decode(item.bytes), arrayBuffer: async () => Uint8Array.from(item.bytes).buffer };
    },
    createWritable: async () => {
      let bytes: Uint8Array;
      return { write: async (content: string | Blob) => { bytes = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(await content.arrayBuffer()); },
        close: async () => { files.set(name, { bytes, modified: (files.get(name)?.modified ?? 0) + 1 }); }, abort: async () => {} };
    }
  });
  const data = { values: async function* () { for (const name of files.keys()) if (name.endsWith('.cfjx')) yield handle(name); }, getFileHandle: async (name: string) => handle(name) };
  const cover = { getFileHandle: async (name: string) => handle(`preview/${name}`) };
  const root = { getDirectoryHandle: async (name: string) => name === 'preview' ? cover : data,
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (!files.has(name) && !options?.create) throw new DOMException('Missing', 'NotFoundError');
      return handle(name);
    } };
  Object.assign(adapter, { rootHandle: root });
  try {
    files.set(`${project.id}.cfjx`, { bytes: await encodeProjectArchive(project), modified: 1 });
    await adapter.listProjectSummaries();
    rememberProjectPreview(project, project.pages![0], preview);
    await adapter.saveProjectPreview(project, project.pages![0].id, new Blob([preview]));
    await vi.advanceTimersByTimeAsync(3000);
    await (adapter as unknown as { writeQueue: Promise<void> }).writeQueue;
    expect((await decodeProjectArchiveWithPreviews(files.get(`${project.id}.cfjx`)!.bytes)).previews[project.pages![0].id]).toEqual(preview);
    expect(files.get(`preview/${project.id}.webp`)?.bytes).toEqual(preview);
    expect((await adapter.getProjectPreview(project.id))?.size).toBe(preview.length);
    const savedModified = files.get(`${project.id}.cfjx`)!.modified;
    await adapter.saveProjectPreview(project, project.pages![0].id, new Blob([preview]));
    await vi.advanceTimersByTimeAsync(3000);
    await (adapter as unknown as { writeQueue: Promise<void> }).writeQueue;
    expect(files.get(`${project.id}.cfjx`)!.modified).toBe(savedModified);
    const changed = { ...project, title: 'Changed' };
    files.set(`${project.id}.cfjx`, { bytes: await encodeProjectArchive(changed, {}), modified: 20 });
    await adapter.saveProjectPreview(project, project.pages![0].id, new Blob([preview]));
    await vi.advanceTimersByTimeAsync(3000);
    await (adapter as unknown as { writeQueue: Promise<void> }).writeQueue;
    expect((await decodeProjectArchiveWithPreviews(files.get(`${project.id}.cfjx`)!.bytes)).project.title).toBe('Changed');
    expect((await decodeProjectArchiveWithPreviews(files.get(`${project.id}.cfjx`)!.bytes)).previews).toEqual({});
  } finally { vi.useRealTimers(); }
});

test('does not overwrite or delete a differently identified project using the same file name', async () => {
  const { adapter, project, write, removeEntry, directory } = setup();
  const archive = await encodeProjectArchive({ ...project, id: 'other-project' });
  directory.getFileHandle.mockImplementation(async (name: string) => ({
    name,
    createWritable: vi.fn().mockResolvedValue({ write, close: vi.fn(), abort: vi.fn() }),
    getFile: async () => ({ arrayBuffer: async () => Uint8Array.from(archive).buffer,
      text: async () => JSON.stringify({ id: 'other-project', title: 'Other', version: '9.2.7', pages: [{ id: 'page', name: '', layers: [], canvasConfig: { width: 100, height: 100, ratio: '1:1' }, background: project.pageInfo.background }] }) })
  }));
  await expect(adapter.saveProject(project)).rejects.toThrow('already used by another project');
  await expect(adapter.deleteProject(project.id)).resolves.toBeUndefined();
  expect(write).not.toHaveBeenCalled();
  expect(removeEntry).not.toHaveBeenCalled();
});