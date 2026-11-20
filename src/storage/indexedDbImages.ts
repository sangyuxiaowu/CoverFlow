import { sha256 } from '@noble/hashes/sha2.js';
import type { ProjectPage } from '../types.ts';
import { imageAssets, isImageAsset } from './imageAssets.ts';

const PREFIX = 'idb-image:';
export type ImageAsset = { id: string; blob: Blob };
export type ImageCache = Map<string, Promise<ImageAsset>>;

async function imageAsset(value: string, cache: ImageCache): Promise<ImageAsset> {
  let pending = cache.get(value);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(value);
      if (!response.ok) throw new Error('Unable to decode project image.');
      const blob = await response.blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const hash = globalThis.crypto?.subtle
        ? new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
        : sha256(bytes);
      const digest = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
      return { id: `${digest}:${blob.type}`, blob };
    })();
    cache.set(value, pending);
  }
  return pending;
}

export async function packImagePages(pages: ProjectPage[], cache: ImageCache, previous?: ImageCache, held = new Map<string, Blob>()) {
  const assets = new Map<string, ImageAsset>();
  const transform = async (value: string) => {
    if (isImageAsset(value)) {
      const blob = held.get(value);
      if (!blob) throw new Error('Image asset is unavailable.');
      const asset = { id: value.slice('asset-image:'.length), blob };
      cache.set(value, Promise.resolve(asset));
      assets.set(asset.id, asset);
      return PREFIX + asset.id;
    }
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return value;
    const existing = previous?.get(value);
    if (existing && !cache.has(value)) cache.set(value, existing);
    try {
      const asset = await imageAsset(value, cache);
      assets.set(asset.id, asset);
      return PREFIX + asset.id;
    } catch {
      cache.delete(value);
      return value;
    }
  };
  const packed: ProjectPage[] = [];
  for (const page of pages) {
    const layers = [];
    for (const layer of page.layers) layers.push(layer.type === 'image' ? { ...layer, content: await transform(layer.content) } : layer);
    const background = page.pageInfo.background;
    packed.push({ ...page, layers, pageInfo: { ...page.pageInfo, background: background.type === 'image' ? { ...background, value: await transform(background.value) } : background } });
  }
  return { pages: packed, assets };
}

export async function unpackImagePages(pages: ProjectPage[], assets: ImageAsset[], owner?: symbol) {
  const blobs = new Map(assets.map(asset => [asset.id, asset]));
  const cache = new Map<string, Promise<string>>();
  const imageCache: ImageCache = new Map();
  const transform = async (value: string) => {
    if (!value.startsWith(PREFIX)) return value;
    const id = value.slice(PREFIX.length);
    let pending = cache.get(id);
    if (!pending) {
      const asset = blobs.get(id);
      if (!asset?.blob) throw new Error('Missing stored project image.');
      pending = (async () => {
        if (owner) {
          const result = await imageAssets.add(owner, asset.blob);
          if (result !== `asset-image:${asset.id}`) throw new Error('Invalid stored project image.');
          imageCache.set(result, Promise.resolve(asset));
          return result;
        }
        const bytes = new Uint8Array(await asset.blob.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        const result = `data:${asset.blob.type};base64,${btoa(binary)}`;
        imageCache.set(result, Promise.resolve(asset));
        return result;
      })();
      cache.set(id, pending);
    }
    return pending;
  };
  const unpacked: ProjectPage[] = [];
  for (const page of pages) {
    const layers = [];
    for (const layer of page.layers) layers.push(layer.type === 'image' ? { ...layer, content: await transform(layer.content) } : layer);
    const background = page.pageInfo.background;
    unpacked.push({ ...page, layers, pageInfo: { ...page.pageInfo, background: background.type === 'image' ? { ...background, value: await transform(background.value) } : background } });
  }
  return { pages: unpacked, cache: imageCache };
}