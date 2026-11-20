import { readProject, writeProject } from './projectCompatibility.ts';
import { generateId } from '../utils/helpers.ts';
import type { PageInfo } from '../types.ts';
import type { ProjectPage } from '../types.ts';
import { imageAssets } from './imageAssets.ts';

// Remove this file and all CFJ compatibility handling when version 10.0.0 is released.
export function migrateLegacyProject(input: Record<string, unknown>): Record<string, unknown> {
  if (input.schemaVersion !== undefined) return input;
  const version = input.version;
  if (version !== undefined && (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version))) throw new Error('Invalid project version.');
  let pages = input.pages;
  if (!pages && (version === undefined || Number(String(version).split('.')[0]) < 9)) {
    pages = [{ id: generateId(), name: '', layers: input.layers, background: input.background, canvasConfig: input.canvasConfig }];
  }
  if (!Array.isArray(pages)) return input;
  return {
    ...input,
    schemaVersion: 1,
    pages: pages.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const { canvasConfig, background, ...page } = item as Record<string, unknown>;
      if (!canvasConfig || typeof canvasConfig !== 'object' || Array.isArray(canvasConfig)) return item;
      const { width, height } = canvasConfig as Record<string, unknown>;
      return { ...page, pageInfo: { width, height, background } };
    })
  };
}

export function readLegacyCfj(text: string) {
  return readProject(JSON.parse(text));
}

export async function readLegacyCfjx(bytes: Uint8Array) {
  if (bytes.length > 256 * 1024 * 1024) throw new Error('Project archive exceeds the size limit.');
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  let expandedSize = 0;
  for (const entry of Object.values(zip.files)) {
    const data = entry as typeof entry & { unsafeOriginalName?: string; _data?: { uncompressedSize?: number } };
    if (data.unsafeOriginalName && data.unsafeOriginalName !== entry.name) throw new Error('Unsafe project archive path.');
    if (entry.dir) continue;
    if (entry.name !== 'project.json' && !/^pages\/[^/]+\.json$/.test(entry.name) && !/^images\/[a-f0-9]{64}\.[a-z0-9.+-]+$/.test(entry.name) && !/^previews\/(0|[1-9][0-9]?)\.webp$/.test(entry.name)) throw new Error('Unexpected project archive entry.');
    const size = data._data?.uncompressedSize;
    const limit = entry.name === 'project.json' || entry.name.startsWith('pages/') ? 32 * 1024 * 1024 : entry.name.startsWith('previews/') ? 2 * 1024 * 1024 : 64 * 1024 * 1024;
    if (!Number.isSafeInteger(size) || size! < 0 || size! > limit) throw new Error('Invalid project archive entry size.');
    expandedSize += size!;
    if (expandedSize > 512 * 1024 * 1024) throw new Error('Project archive expands beyond the size limit.');
  }
  const file = zip.file('project.json');
  if (!file) throw new Error('Missing project manifest.');
  const manifest = JSON.parse(await file.async('string')) as { format?: unknown; formatVersion?: unknown; project?: unknown; previews?: unknown };
  if (manifest.format !== 'coverflow-project' || manifest.formatVersion !== 1) throw new Error('Not a legacy single-JSON CFJX archive.');
  if (Object.values(zip.files).some(entry => !entry.dir && entry.name.startsWith('pages/'))) throw new Error('Unexpected project archive entry.');
  const { pages, ...metadata } = writeProject(readProject(manifest.project));
  for (const page of pages) zip.file(`pages/${encodeURIComponent(page.id)}.json`, JSON.stringify(page));
  zip.file('project.json', JSON.stringify({ ...manifest, formatVersion: 2, project: { ...metadata, pageIds: pages.map(page => page.id) } }));
  const { decodeProjectArchive } = await import('./projectArchive.ts');
  return decodeProjectArchive(await zip.generateAsync({ type: 'uint8array' }));
}

export function readLegacyIndexedDBProject(input: unknown) {
  return readProject(input);
}

export function hasLegacyIndexedDBImages(pages: ProjectPage[]): boolean {
  return pages.some(page => page.layers.some(layer => layer.type === 'image' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(layer.content)) ||
    (page.pageInfo.background.type === 'image' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(page.pageInfo.background.value)));
}

export function sameLegacyIndexedDBRecord(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => sameLegacyIndexedDBRecord(item, right[index]));
  const first = left as Record<string, unknown>;
  const second = right as Record<string, unknown>;
  const keys = Object.keys(first);
  return keys.length === Object.keys(second).length && keys.every(key => Object.hasOwn(second, key) && sameLegacyIndexedDBRecord(first[key], second[key]));
}

export async function migrateLegacyIndexedDBImages(pages: ProjectPage[], owner: symbol): Promise<ProjectPage[]> {
  const pending = new Map<string, Promise<string>>();
  const convert = (value: string): Promise<string> => {
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return Promise.resolve(value);
    let result = pending.get(value);
    if (!result) {
      result = (async () => {
        let response: Response;
        try { response = await fetch(value); } catch { return value; }
        if (!response.ok) return value;
        const blob = await response.blob();
        return imageAssets.add(owner, blob);
      })();
      pending.set(value, result);
    }
    return result;
  };
  return Promise.all(pages.map(async page => ({
    ...page,
    layers: await Promise.all(page.layers.map(async layer => layer.type === 'image' ? { ...layer, content: await convert(layer.content) } : layer)),
    pageInfo: { ...page.pageInfo, background: page.pageInfo.background.type === 'image' ? { ...page.pageInfo.background, value: await convert(page.pageInfo.background.value) } : page.pageInfo.background }
  })));
}

export function migrateLegacyProjectPatch(input: Record<string, unknown>, current: PageInfo): Record<string, unknown> {
  if (!('canvasConfig' in input) && !('background' in input)) return input;
  const { canvasConfig, background, ...rest } = input;
  const dimensions = canvasConfig && typeof canvasConfig === 'object' && !Array.isArray(canvasConfig) ? canvasConfig as Record<string, unknown> : {};
  return { ...rest, pageInfo: { width: dimensions.width ?? current.width, height: dimensions.height ?? current.height, background: background ?? current.background } };
}