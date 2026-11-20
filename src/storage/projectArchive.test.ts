import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { encodeProjectArchive, decodeProjectArchive, decodeProjectArchiveWithPreviews, replaceProjectArchivePreviews } from './projectArchive.ts';
import { readLegacyCfj, readLegacyCfjx } from './legacyCfj.ts';
import * as hashes from '@noble/hashes/sha2.js';
import { pagePreviewFingerprint, pagePreviewFingerprintAsync } from './projectPreviews.ts';
import { imageAssets } from './imageAssets.ts';

const image = 'data:image/png;base64,AQIDBA==';
const legacy = JSON.stringify({ id: 'legacy', title: 'Test', version: '9.2.7', updatedAt: 1, pages: [{ id: 'page', name: '', layers: [{ id: 'image', type: 'image', content: image }], background: { type: 'image', value: image, overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 }, canvasConfig: { width: 900, height: 383, ratio: '2.35:1' } }] });

describe('project archive', () => {
  it('uses the archive worker and propagates encoding errors', async () => {
    const project = readLegacyCfj(legacy);
    const messages: unknown[] = [];
    const terminated = vi.fn();
    let fail = false;
    class ArchiveWorker {
      onmessage?: (event: { data: unknown }) => void;
      postMessage(message: unknown) {
        messages.push(message);
        queueMicrotask(() => this.onmessage?.({ data: fail ? { ok: false, error: 'Encoding failed' } : { ok: true, result: new Uint8Array([1, 2, 3]) } }));
      }
      terminate() { terminated(); }
    }
    vi.stubGlobal('Worker', ArchiveWorker);
    vi.stubGlobal('document', {});
    try {
      expect(await encodeProjectArchive(project, {})).toEqual(new Uint8Array([1, 2, 3]));
      expect(messages[0]).toMatchObject({ kind: 'encode', project });
      fail = true;
      await expect(encodeProjectArchive(project, {})).rejects.toThrow('Encoding failed');
      expect(terminated).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); }
  });

  it('falls back to direct archive encoding if workers cannot start', async () => {
    const project = readLegacyCfj(legacy);
    vi.stubGlobal('document', {});
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Workers unavailable'); } });
    try {
      expect(await decodeProjectArchive(await encodeProjectArchive(project, {}))).toEqual(project);
    } finally { vi.unstubAllGlobals(); }
  });

  it('shares an asynchronous fingerprint worker and preserves the existing hash', async () => {
    const project = readLegacyCfj(legacy);
    const page = { ...project.pages![0], layers: [...project.layers] };
    const expected = pagePreviewFingerprint({ ...page, layers: [...page.layers] });
    const workers: Array<{ terminated: boolean }> = [];
    class FingerprintWorker {
      onmessage?: (event: { data: string }) => void;
      terminated = false;
      constructor() { workers.push(this); }
      postMessage(value: Pick<typeof page, 'layers' | 'pageInfo'>) {
        queueMicrotask(() => this.onmessage?.({ data: pagePreviewFingerprint({ ...page, ...value }) }));
      }
      terminate() { this.terminated = true; }
    }
    vi.stubGlobal('Worker', FingerprintWorker);
    vi.stubGlobal('document', {});
    try {
      const first = pagePreviewFingerprintAsync(page);
      const second = pagePreviewFingerprintAsync(page);
      expect(second).toBe(first);
      expect(await first).toBe(expected);
      expect(workers).toHaveLength(1);
      expect(workers[0].terminated).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });

  it('updates archive previews without decoding embedded images again', async () => {
    const project = readLegacyCfj(legacy);
    const original = await encodeProjectArchive(project, {});
    const preview = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
    const decodeBase64 = vi.spyOn(globalThis, 'atob');
    let updated: Uint8Array;
    try {
      updated = await replaceProjectArchivePreviews(original, project, { [project.pages![0].id]: preview });
      expect(decodeBase64).not.toHaveBeenCalled();
    } finally { decodeBase64.mockRestore(); }
    const before = await JSZip.loadAsync(original);
    const after = await JSZip.loadAsync(updated);
    const imagePath = Object.keys(before.files).find(name => name.startsWith('images/') && !before.files[name].dir)!;
    expect(await after.file(imagePath)!.async('uint8array')).toEqual(await before.file(imagePath)!.async('uint8array'));
    expect(await decodeProjectArchiveWithPreviews(updated)).toEqual({ project, previews: { [project.pages![0].id]: preview } });
  });

  it('streams page fingerprints without changing existing hashes or serializing large strings', () => {
    const project = readLegacyCfj(legacy);
    const page = { ...project.pages![0], layers: [{ ...project.layers[0], content: `${'A'.repeat(32767)}🙂\\"\n${'B'.repeat(100000)}`, extra: [,'value', undefined, null] }] };
    const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)])) : value;
    const expected = Array.from(hashes.sha256(new TextEncoder().encode(JSON.stringify(canonical({ pageInfo: page.pageInfo, layers: page.layers })))), byte => byte.toString(16).padStart(2, '0')).join('');
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      expect(pagePreviewFingerprint(page)).toBe(expected);
      expect(stringify.mock.calls.every(([value]) => typeof value !== 'string' || value.length <= 32768)).toBe(true);
    } finally { stringify.mockRestore(); }
  });

  it('stores optional page previews and ignores invalid preview contents', async () => {
    const project = readLegacyCfj(legacy);
    const preview = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
    const bytes = await encodeProjectArchive(project, { [project.pages![0].id]: preview });
    const archive = await JSZip.loadAsync(bytes);
    expect(await archive.file('previews/0.webp')!.async('uint8array')).toEqual(preview);
    expect(await decodeProjectArchiveWithPreviews(bytes)).toEqual({ project, previews: { [project.pages![0].id]: preview } });
    const page = JSON.parse(await archive.file('pages/page.json')!.async('string'));
    page.pageInfo.width = 100;
    archive.file('pages/page.json', JSON.stringify(page));
    const stale = await decodeProjectArchiveWithPreviews(await archive.generateAsync({ type: 'uint8array' }));
    expect(stale.project.pageInfo.width).toBe(100);
    expect(stale.previews).toEqual({});
    archive.file('previews/0.webp', 'invalid');
    archive.file('pages/page.json', await (await JSZip.loadAsync(bytes)).file('pages/page.json')!.async('string'));
    expect(await decodeProjectArchiveWithPreviews(await archive.generateAsync({ type: 'uint8array' }))).toEqual({ project, previews: {} });
    archive.file('previews/0.webp', new Uint8Array(2 * 1024 * 1024 + 1));
    expect(await decodeProjectArchiveWithPreviews(await archive.generateAsync({ type: 'uint8array' }))).toEqual({ project, previews: {} });
    expect((await decodeProjectArchiveWithPreviews(await encodeProjectArchive(project))).previews).toEqual({});
  });

  it('round-trips legacy projects and deduplicates embedded image bytes', async () => {
    const project = readLegacyCfj(legacy);
    const bytes = await encodeProjectArchive(project);
    const archive = await JSZip.loadAsync(bytes);
    expect(Object.keys(archive.files).filter(name => name.startsWith('images/') && !archive.files[name].dir)).toHaveLength(1);
    expect(await archive.file('project.json')!.async('string')).not.toContain('base64');
    const manifest = JSON.parse(await archive.file('project.json')!.async('string'));
    expect(manifest.formatVersion).toBe(2);
    expect(manifest.project.pageIds).toEqual(['page']);
    expect(manifest.project.pages).toBeUndefined();
    expect(await archive.file('pages/page.json')!.async('string')).not.toContain('base64');
    expect(await decodeProjectArchive(bytes)).toEqual(project);
  });

  it('embeds cached binary assets in archives and rejects missing references', async () => {
    const owner = imageAssets.createOwner();
    const project = readLegacyCfj(legacy);
    const reference = await imageAssets.add(owner, new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
    const page = { ...project.pages![0], layers: project.layers.map(layer => ({ ...layer, content: reference })),
      pageInfo: { ...project.pageInfo, background: { ...project.pageInfo.background, value: reference } } };
    const binaryProject = { ...project, pages: [page], layers: page.layers, pageInfo: page.pageInfo };
    try {
      const archive = await JSZip.loadAsync(await encodeProjectArchive(binaryProject, {}));
      const names = Object.keys(archive.files).filter(name => name.startsWith('images/') && !archive.files[name].dir);
      expect(names).toHaveLength(1);
      expect(await archive.file(names[0])!.async('uint8array')).toEqual(new Uint8Array([1, 2, 3, 4]));
      expect((await decodeProjectArchive(await archive.generateAsync({ type: 'uint8array' }))).layers[0].content).toBe(image);
      imageAssets.release(owner);
      await expect(encodeProjectArchive(binaryProject, {})).rejects.toThrow('unavailable');
    } finally { imageAssets.release(owner); }
  });

  it('decodes archive images into owner-scoped binary references', async () => {
    const owner = imageAssets.createOwner();
    try {
      const original = readLegacyCfj(legacy);
      const project = await decodeProjectArchive(await encodeProjectArchive(original, {}), owner);
      const reference = project.layers[0].content;
      expect(reference).toMatch(/^asset-image:/);
      expect(project.pageInfo.background.value).toBe(reference);
      expect(new Uint8Array(await imageAssets.blob(reference)!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
      expect(await decodeProjectArchive(await encodeProjectArchive(project, {}))).toEqual(original);
      imageAssets.release(owner);
      expect(imageAssets.blob(reference)).toBeUndefined();
    } finally { imageAssets.release(owner); }
  });

  it('passes binary assets to the archive worker while holding them for queued saves', async () => {
    const owner = imageAssets.createOwner();
    const project = readLegacyCfj(legacy);
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
    const reference = await imageAssets.add(owner, blob);
    const page = { ...project.pages![0], layers: project.layers.map(layer => ({ ...layer, content: reference })) };
    const binaryProject = { ...project, pages: [page], layers: page.layers };
    let message: { assets: Record<string, Blob> } | undefined;
    class ArchiveWorker {
      onmessage?: (event: { data: unknown }) => void;
      postMessage(value: { assets: Record<string, Blob> }) {
        message = value;
        queueMicrotask(() => this.onmessage?.({ data: { ok: true, result: new Uint8Array([1]) } }));
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', ArchiveWorker);
    vi.stubGlobal('document', {});
    try {
      const saving = encodeProjectArchive(binaryProject, {});
      imageAssets.release(owner);
      await saving;
      expect(message?.assets[reference]).toBe(blob);
    } finally { imageAssets.release(owner); vi.unstubAllGlobals(); }
  });

  it('only converts single-JSON archives through the legacy reader', async () => {
    const project = readLegacyCfj(legacy);
    const zip = await JSZip.loadAsync(await encodeProjectArchive(project));
    const manifest = JSON.parse(await zip.file('project.json')!.async('string'));
    const page = JSON.parse(await zip.file('pages/page.json')!.async('string'));
    zip.remove('pages');
    delete manifest.project.pageIds;
    manifest.project.pages = [page];
    manifest.formatVersion = 1;
    zip.file('project.json', JSON.stringify(manifest));
    const old = await zip.generateAsync({ type: 'uint8array' });
    await expect(decodeProjectArchive(old)).rejects.toThrow('Unsupported project archive format');
    expect(await readLegacyCfjx(old)).toEqual(project);
    await expect(readLegacyCfjx(await encodeProjectArchive(project))).rejects.toThrow('Not a legacy single-JSON CFJX');
  });

  it('does not persist selection and opens with no selected layer', async () => {
    const project = { ...readLegacyCfj(legacy), selectedLayerId: 'image' };
    const bytes = await encodeProjectArchive(project);
    const archive = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await archive.file('project.json')!.async('string'));
    expect(manifest.project).not.toHaveProperty('selectedLayerId');
    expect((await decodeProjectArchive(bytes)).selectedLayerId).toBeNull();
  });

  it('decodes shared images once', async () => {
    const project = readLegacyCfj(legacy);
    const bytes = await encodeProjectArchive(project);
    const nativeDigest = vi.fn(async (_algorithm: string, value: Uint8Array) => Uint8Array.from(hashes.sha256(value)).buffer);
    vi.stubGlobal('crypto', { subtle: { digest: nativeDigest } });
    try {
      expect(await decodeProjectArchive(bytes)).toEqual(project);
      expect(nativeDigest).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it('encodes shared images once even when referenced concurrently', async () => {
    const project = readLegacyCfj(legacy);
    const nativeDigest = vi.fn(async (_algorithm: string, value: Uint8Array) => Uint8Array.from(hashes.sha256(value)).buffer);
    vi.stubGlobal('crypto', { subtle: { digest: nativeDigest } });
    try {
      const bytes = await encodeProjectArchive(project);
      expect(nativeDigest).toHaveBeenCalledTimes(1);
      expect(await decodeProjectArchive(bytes)).toEqual(project);
    } finally { vi.unstubAllGlobals(); }
  });

  it('uses native SHA-256 and falls back when it fails', async () => {
    const project = readLegacyCfj(legacy);
    const nativeDigest = vi.fn(async (_algorithm: string, value: Uint8Array) => Uint8Array.from(hashes.sha256(value)).buffer);
    vi.stubGlobal('crypto', { subtle: { digest: nativeDigest } });
    try {
      const bytes = await encodeProjectArchive(project);
      expect(await decodeProjectArchive(bytes)).toEqual(project);
      expect(nativeDigest).toHaveBeenCalled();
      nativeDigest.mockRejectedValue(new Error('Unavailable'));
      expect(await decodeProjectArchive(bytes)).toEqual(project);
    } finally { vi.unstubAllGlobals(); }
  });

  it('uses native Base64 conversion when available', async () => {
    const project = readLegacyCfj(legacy);
    const bytes = await encodeProjectArchive(project);
    const original = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toBase64');
    const convert = vi.fn(function (this: Uint8Array) { return btoa(String.fromCharCode(...this)); });
    Object.defineProperty(Uint8Array.prototype, 'toBase64', { value: convert, configurable: true });
    try {
      expect(await decodeProjectArchive(bytes)).toEqual(project);
      expect(convert).toHaveBeenCalledTimes(1);
    } finally {
      if (original) Object.defineProperty(Uint8Array.prototype, 'toBase64', original);
      else Reflect.deleteProperty(Uint8Array.prototype, 'toBase64');
    }
  });

  it('decodes images when native Base64 conversion is unavailable', async () => {
    const project = readLegacyCfj(legacy);
    const bytes = await encodeProjectArchive(project);
    const original = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toBase64');
    Object.defineProperty(Uint8Array.prototype, 'toBase64', { value: undefined, configurable: true });
    try {
      expect(await decodeProjectArchive(bytes)).toEqual(project);
    } finally {
      if (original) Object.defineProperty(Uint8Array.prototype, 'toBase64', original);
      else Reflect.deleteProperty(Uint8Array.prototype, 'toBase64');
    }
  });

  it('rejects invalid archives and missing images', async () => {
    const bytes = await encodeProjectArchive(readLegacyCfj(legacy));
    const zip = await JSZip.loadAsync(bytes);
    zip.remove(Object.keys(zip.files).find(name => name.startsWith('images/') && !zip.files[name].dir)!);
    await expect(decodeProjectArchive(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow('Missing project image');
    await expect(decodeProjectArchive(new Uint8Array([0, 1, 2]))).rejects.toThrow();
  });

  it('rejects image bytes that do not match the archive hash', async () => {
    const bytes = await encodeProjectArchive(readLegacyCfj(legacy));
    const zip = await JSZip.loadAsync(bytes);
    const path = Object.keys(zip.files).find(name => name.startsWith('images/') && !zip.files[name].dir)!;
    zip.file(path, new Uint8Array([4, 3, 2, 1]));
    await expect(decodeProjectArchive(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow('Invalid project image');
  });

  it('does not require Web Crypto for embedded images', async () => {
    const project = readLegacyCfj(legacy);
    vi.stubGlobal('crypto', undefined);
    try {
      expect(await decodeProjectArchive(await encodeProjectArchive(project))).toEqual(project);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});