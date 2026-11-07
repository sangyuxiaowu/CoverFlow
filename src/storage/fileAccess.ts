export async function withFreshFileSnapshot<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const staleSnapshot = error instanceof DOMException && (
        error.name === 'NotReadableError' ||
        (error.name === 'InvalidStateError' && error.message.includes('state had changed since it was read from disk'))
      );
      if (!staleSnapshot || attempt >= 2) throw error;
    }
  }
}

export const readFileText = (handle: FileSystemFileHandle) => withFreshFileSnapshot(async () => {
  const file = await handle.getFile();
  return await file.text();
});

export const readFileBlob = (handle: FileSystemFileHandle, type: string) => withFreshFileSnapshot(async () => {
  const file = await handle.getFile();
  return new Blob([await file.arrayBuffer()], { type });
});

export const writeFileContent = (handle: FileSystemFileHandle, content: string | Blob) => withFreshFileSnapshot(async () => {
  const writable = await handle.createWritable();
  try {
    await writable.write(content);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
});