import { Blob } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { ImageAssetCache, isImageAsset } from './imageAssets.ts';

describe('binary image assets', () => {
  it('deduplicates bytes and retains URLs until the last owner releases them', async () => {
    const cache = new ImageAssetCache();
    const first = cache.createOwner();
    const second = cache.createOwner();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) as globalThis.Blob;
      const reference = await cache.add(first, blob);
      expect(isImageAsset(reference)).toBe(true);
      expect(await cache.add(second, blob)).toBe(reference);
      expect(cache.blob(reference)).toBe(blob);
      expect(cache.url(reference)).toBe('blob:image');
      expect(cache.url(reference)).toBe('blob:image');
      expect(create).toHaveBeenCalledOnce();
      cache.release(first);
      expect(cache.blob(reference)).toBe(blob);
      expect(revoke).not.toHaveBeenCalled();
      cache.release(second);
      expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:image');
      expect(cache.blob(reference)).toBeUndefined();
      expect(() => cache.url(reference)).toThrow('unavailable');
    } finally { create.mockRestore(); revoke.mockRestore(); }
  });

  it('rejects additions after the owner has been released during hashing', async () => {
    const cache = new ImageAssetCache();
    const owner = cache.createOwner();
    let finish!: (value: ArrayBuffer) => void;
    const blob = { type: 'image/png', arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) } as globalThis.Blob;
    const pending = cache.add(owner, blob);
    cache.release(owner);
    finish(new Uint8Array([1]).buffer);
    await expect(pending).rejects.toThrow('owner has been released');
  });
});