import { expect, test, vi } from 'vitest';
import { createDirectoryChatAccess } from './chatFileAccess.ts';

function setup(files: Array<{ text?: () => Promise<string>; arrayBuffer?: () => Promise<ArrayBuffer> }>) {
  const getFile = vi.fn();
  for (const file of files) getFile.mockResolvedValueOnce(file);
  const write = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const abort = vi.fn().mockResolvedValue(undefined);
  const createWritable = vi.fn().mockResolvedValue({ write, close, abort });
  const handle = { getFile, createWritable };
  const directory = { getFileHandle: vi.fn().mockResolvedValue(handle) };
  const access = createDirectoryChatAccess(async () => directory as unknown as FileSystemDirectoryHandle);
  return { access, getFile, createWritable, write };
}

test('chat text reads reacquire a file after its disk snapshot changes', async () => {
  const { access, getFile } = setup([
    { text: async () => { throw new DOMException('The file changed on disk.', 'NotReadableError'); } },
    { text: async () => '{"updated":true}' }
  ]);
  await expect(access.read('session.json')).resolves.toBe('{"updated":true}');
  expect(getFile).toHaveBeenCalledTimes(2);
});

test('chat reads recover the reported cached-interface state error', async () => {
  const { access, getFile } = setup([
    { text: async () => {
      throw new DOMException(
        'An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk.',
        'InvalidStateError'
      );
    } },
    { text: async () => 'fresh content' }
  ]);
  await expect(access.read('session.json')).resolves.toBe('fresh content');
  expect(getFile).toHaveBeenCalledTimes(2);
});

test('chat reads do not retry unrelated invalid-state errors', async () => {
  const error = new DOMException('The stream is closed', 'InvalidStateError');
  const { access, getFile } = setup([{ text: async () => { throw error; } }]);
  await expect(access.read('session.json')).rejects.toBe(error);
  expect(getFile).toHaveBeenCalledTimes(1);
});

test('chat text reads still report permission errors without retrying', async () => {
  const error = new DOMException('Permission denied', 'NotAllowedError');
  const { access, getFile } = setup([{ text: async () => { throw error; } }]);
  await expect(access.read('session.json')).rejects.toBe(error);
  expect(getFile).toHaveBeenCalledTimes(1);
});

test('chat text reads stop retrying a persistently unreadable file', async () => {
  const error = new DOMException('The file changed on disk.', 'NotReadableError');
  const { access, getFile } = setup(Array.from({ length: 3 }, () => ({
    text: async () => { throw error; }
  })));
  await expect(access.read('session.json')).rejects.toBe(error);
  expect(getFile).toHaveBeenCalledTimes(3);
});

test('chat image reads recover a changed snapshot and return independent bytes', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const { access, getFile } = setup([
    { arrayBuffer: async () => { throw new DOMException('Changed', 'NotReadableError'); } },
    { arrayBuffer: async () => bytes.buffer }
  ]);
  const blob = await access.readBinary('image.png');
  bytes.fill(0);
  expect(blob?.type).toBe('image/png');
  expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  expect(getFile).toHaveBeenCalledTimes(2);
});

test('chat writes wait for an in-flight read to finish consuming its snapshot', async () => {
  let finishRead!: (value: string) => void;
  let readStarted!: () => void;
  const started = new Promise<void>(resolve => { readStarted = resolve; });
  const content = new Promise<string>(resolve => { finishRead = resolve; });
  const { access, createWritable, write } = setup([{
    text: () => { readStarted(); return content; }
  }]);
  const reading = access.read('session.json');
  const writing = access.write('session.json', 'new content');
  await started;
  expect(createWritable).not.toHaveBeenCalled();
  finishRead('old content');
  await expect(reading).resolves.toBe('old content');
  await writing;
  expect(write).toHaveBeenCalledWith('new content');
});

test('a failed chat read does not block subsequent writes', async () => {
  const { access, write } = setup([{
    text: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); }
  }]);
  await expect(access.read('session.json')).rejects.toThrow('Permission denied');
  await expect(access.write('session.json', 'recovered')).resolves.toBeUndefined();
  expect(write).toHaveBeenCalledWith('recovered');
});

test('chat reads treat a file removed during consumption as missing', async () => {
  const { access } = setup([{
    text: async () => { throw new DOMException('Missing', 'NotFoundError'); }
  }]);
  await expect(access.read('session.json')).resolves.toBeNull();
});