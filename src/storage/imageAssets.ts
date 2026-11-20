import { sha256 } from '@noble/hashes/sha2.js';
import type { ProjectPage } from '../types.ts';

const PREFIX = 'asset-image:';
type Entry = { blob: Blob; owners: Set<symbol>; url?: string };

export class ImageAssetCache {
  private entries = new Map<string, Entry>();
  private owners = new Map<symbol, Set<string>>();

  createOwner(): symbol {
    const owner = Symbol('image-assets');
    this.owners.set(owner, new Set());
    return owner;
  }

  async add(owner: symbol, blob: Blob): Promise<string> {
    if (!this.owners.has(owner)) throw new Error('Image asset owner has been released.');
    if (!/^image\/[a-z0-9.+-]+$/i.test(blob.type)) throw new Error('Unsupported image asset type.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let hash: Uint8Array;
    try {
      hash = globalThis.crypto?.subtle ? new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)) : sha256(bytes);
    } catch { hash = sha256(bytes); }
    if (!this.owners.has(owner)) throw new Error('Image asset owner has been released.');
    const digest = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
    const reference = `${PREFIX}${digest}:${blob.type.toLowerCase()}`;
    if (!this.entries.has(reference)) this.entries.set(reference, { blob, owners: new Set() });
    this.retain(owner, reference);
    return reference;
  }

  retain(owner: symbol, reference: string): void {
    const owned = this.owners.get(owner);
    const entry = this.entries.get(reference);
    if (!owned) throw new Error('Image asset owner has been released.');
    if (!entry) throw new Error('Image asset is unavailable.');
    owned.add(reference);
    entry.owners.add(owner);
  }

  blob(reference: string): Blob | undefined {
    return this.entries.get(reference)?.blob;
  }

  url(reference: string): string {
    const entry = this.entries.get(reference);
    if (!entry) throw new Error('Image asset is unavailable.');
    return entry.url ??= URL.createObjectURL(entry.blob);
  }

  release(owner: symbol): void {
    const owned = this.owners.get(owner);
    if (!owned) return;
    this.owners.delete(owner);
    for (const reference of owned) {
      const entry = this.entries.get(reference)!;
      entry.owners.delete(owner);
      if (entry.owners.size) continue;
      if (entry.url) URL.revokeObjectURL(entry.url);
      this.entries.delete(reference);
    }
  }
}

export const isImageAsset = (value: string) => value.startsWith(PREFIX);
export const imageAssets = new ImageAssetCache();
export const resolveImageSource = (value: string) => isImageAsset(value) ? imageAssets.url(value) : value;

export function captureImageAssets(pages: ProjectPage[]): Map<string, Blob> {
  const blobs = new Map<string, Blob>();
  for (const page of pages) {
    const values = page.layers.filter(layer => layer.type === 'image').map(layer => layer.content);
    if (page.pageInfo.background.type === 'image') values.push(page.pageInfo.background.value);
    for (const value of values) {
      if (!isImageAsset(value) || blobs.has(value)) continue;
      const blob = imageAssets.blob(value);
      if (!blob) throw new Error('Image asset is unavailable.');
      blobs.set(value, blob);
    }
  }
  return blobs;
}

export function leaseImageAssets(pages: ProjectPage[]): () => void {
  const assets = captureImageAssets(pages);
  const owner = imageAssets.createOwner();
  try {
    for (const reference of assets.keys()) imageAssets.retain(owner, reference);
  } catch (error) {
    imageAssets.release(owner);
    throw error;
  }
  return () => imageAssets.release(owner);
}