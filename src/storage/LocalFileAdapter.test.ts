import { test, expect, vi } from 'vitest';
import { LocalFileAdapter } from './LocalFileAdapter.ts';
import type { ProjectState } from '../types.ts';

function setup() {
  const write = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const removeEntry = vi.fn().mockResolvedValue(undefined);
  const directory = {
    getFileHandle: vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({ write, close })
    }),
    removeEntry
  };
  const adapter = new LocalFileAdapter();
  vi.spyOn(adapter, 'ensureReady').mockResolvedValue(true);
  Object.assign(adapter, { rootHandle: { getDirectoryHandle: async () => directory } });
  const project = { id: 'recovery-test' } as ProjectState;
  return { adapter, project, write, removeEntry };
}

test('a failed write does not poison later saves or deletes', async () => {
  const { adapter, project, write, removeEntry } = setup();
  write.mockRejectedValueOnce(new Error('Disk full'));
  await expect(adapter.saveProject(project)).rejects.toThrow('Disk full');
  await expect(adapter.saveProject(project)).resolves.toBeUndefined();
  await expect(adapter.deleteProject(project.id)).resolves.toBeUndefined();
  expect(write).toHaveBeenCalledTimes(2);
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