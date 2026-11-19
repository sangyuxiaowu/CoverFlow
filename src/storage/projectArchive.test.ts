import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { encodeProjectArchive, decodeProjectArchive } from './projectArchive.ts';
import { readLegacyCfj } from './legacyCfj.ts';

const image = 'data:image/png;base64,AQIDBA==';
const legacy = JSON.stringify({ id: 'legacy', title: 'Test', version: '9.2.7', updatedAt: 1, pages: [{ id: 'page', name: '', layers: [{ id: 'image', type: 'image', content: image }], background: { type: 'image', value: image, overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 }, canvasConfig: { width: 900, height: 383, ratio: '2.35:1' } }] });

describe('project archive', () => {
  it('round-trips legacy projects and deduplicates embedded image bytes', async () => {
    const project = readLegacyCfj(legacy);
    const bytes = await encodeProjectArchive(project);
    const archive = await JSZip.loadAsync(bytes);
    expect(Object.keys(archive.files).filter(name => name.startsWith('images/') && !archive.files[name].dir)).toHaveLength(1);
    expect(await archive.file('project.json')!.async('string')).not.toContain('base64');
    expect(await decodeProjectArchive(bytes)).toEqual(project);
  });

  it('rejects invalid archives and missing images', async () => {
    const bytes = await encodeProjectArchive(readLegacyCfj(legacy));
    const zip = await JSZip.loadAsync(bytes);
    zip.remove(Object.keys(zip.files).find(name => name.startsWith('images/') && !zip.files[name].dir)!);
    await expect(decodeProjectArchive(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow('Missing project image');
    await expect(decodeProjectArchive(new Uint8Array([0, 1, 2]))).rejects.toThrow();
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