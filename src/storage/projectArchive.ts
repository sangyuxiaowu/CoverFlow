import JSZip from 'jszip';
import { sha256 } from '@noble/hashes/sha2.js';
import type { ProjectDocument, ProjectState } from '../types.ts';
import { readProject, writeProject } from './projectCompatibility.ts';
import { pagePreviewFingerprint, projectPreviews, rememberProjectPreview } from './projectPreviews.ts';

const FORMAT = 'coverflow-project';
const FORMAT_VERSION = 1;
const IMAGE_REFERENCE = 'cfjx:';
const MAX_ARCHIVE_SIZE = 256 * 1024 * 1024;
const MAX_EXPANDED_SIZE = 512 * 1024 * 1024;
const MAX_IMAGE_SIZE = 64 * 1024 * 1024;
const MAX_PROJECT_SIZE = 32 * 1024 * 1024;
const MAX_PREVIEW_SIZE = 2 * 1024 * 1024;
const IMAGE_PATH = /^images\/([a-f0-9]{64})\.([a-z0-9.+-]+)$/;
const PREVIEW_PATH = /^previews\/(0|[1-9][0-9]?)\.webp$/;

const isWebP = (bytes: Uint8Array) => bytes.length >= 12 &&
  String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
  String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';

const digest = async (bytes: Uint8Array) => {
  let hash: Uint8Array;
  try {
    hash = globalThis.crypto?.subtle
      ? new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))
      : sha256(bytes);
  } catch {
    hash = sha256(bytes);
  }
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
};

const fromBase64 = (value: string) => {
  const binary = atob(value.replace(/\s/g, ''));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

const toBase64 = (bytes: Uint8Array) => {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (native) return native.call(bytes);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
};

const mapImages = async (document: ProjectDocument, transform: (value: string) => Promise<string>): Promise<ProjectDocument> => ({
  ...document,
  pages: await Promise.all(document.pages.map(async page => ({
    ...page,
    pageInfo: { ...page.pageInfo, background: page.pageInfo.background.type === 'image' ? { ...page.pageInfo.background, value: await transform(page.pageInfo.background.value) } : page.pageInfo.background },
    layers: await Promise.all(page.layers.map(async layer => layer.type === 'image' ? { ...layer, content: await transform(layer.content) } : layer))
  })))
});

export async function encodeProjectArchive(project: ProjectState, previews: Record<string, Uint8Array> = projectPreviews(project)): Promise<Uint8Array> {
  const zip = new JSZip();
  const files = new Set<string>();
  let expandedSize = 0;
  const document = await mapImages(writeProject(project), async value => {
    if (!value.startsWith('data:')) return value;
    const match = /^data:image\/([a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(value);
    if (!match) throw new Error('Unsupported embedded image data URL.');
    const bytes = fromBase64(match[2]);
    if (bytes.length > MAX_IMAGE_SIZE) throw new Error('Embedded image exceeds the size limit.');
    const path = `images/${await digest(bytes)}.${match[1].toLowerCase()}`;
    if (!files.has(path)) {
      expandedSize += bytes.length;
      if (expandedSize > MAX_EXPANDED_SIZE) throw new Error('Project archive expands beyond the size limit.');
      zip.file(path, bytes, { compression: 'STORE' });
      files.add(path);
    }
    return IMAGE_REFERENCE + path;
  });
  const sourcePages = writeProject(project).pages;
  const previewFingerprints = sourcePages.map(page => {
    const preview = previews[page.id];
    return preview && preview.length <= MAX_PREVIEW_SIZE && isWebP(preview) ? pagePreviewFingerprint(page) : null;
  });
  const manifest = JSON.stringify({ format: FORMAT, formatVersion: FORMAT_VERSION, project: document, previews: previewFingerprints });
  const manifestSize = new TextEncoder().encode(manifest).length;
  if (manifestSize > MAX_PROJECT_SIZE || expandedSize + manifestSize > MAX_EXPANDED_SIZE) throw new Error('Project manifest exceeds the size limit.');
  zip.file('project.json', manifest, { compression: 'DEFLATE' });
  for (const [index, page] of document.pages.entries()) {
    const preview = previews[page.id];
    if (!preview || preview.length > MAX_PREVIEW_SIZE || !isWebP(preview)) continue;
    if (expandedSize + manifestSize + preview.length > MAX_EXPANDED_SIZE) break;
    expandedSize += preview.length;
    zip.file(`previews/${index}.webp`, preview, { compression: 'STORE' });
  }
  const result = await zip.generateAsync({ type: 'uint8array' });
  if (result.length > MAX_ARCHIVE_SIZE) {
    if (previewFingerprints.some(Boolean)) return encodeProjectArchive(project, {});
    throw new Error('Project archive exceeds the size limit.');
  }
  return result;
}

async function openProjectArchive(bytes: Uint8Array): Promise<{ zip: JSZip; project: ProjectState; previewFingerprints: unknown }> {
  if (bytes.length > MAX_ARCHIVE_SIZE) throw new Error('Project archive exceeds the size limit.');
  const zip = await JSZip.loadAsync(bytes);
  let expandedSize = 0;
  for (const entry of Object.values(zip.files)) {
    const unsafe = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string; _data?: { uncompressedSize?: number } });
    if (unsafe.unsafeOriginalName && unsafe.unsafeOriginalName !== entry.name) throw new Error('Unsafe project archive path.');
    if (entry.dir) continue;
    const size = unsafe._data?.uncompressedSize;
    if (PREVIEW_PATH.test(entry.name) && (!Number.isSafeInteger(size) || size! < 0 || size! > MAX_PREVIEW_SIZE)) continue;
    if (!Number.isSafeInteger(size) || size! < 0 || size! > (entry.name === 'project.json' ? MAX_PROJECT_SIZE : MAX_IMAGE_SIZE)) throw new Error('Invalid project archive entry size.');
    if (entry.name !== 'project.json' && !IMAGE_PATH.test(entry.name) && !PREVIEW_PATH.test(entry.name)) throw new Error('Unexpected project archive entry.');
    expandedSize += size!;
    if (expandedSize > MAX_EXPANDED_SIZE) throw new Error('Project archive expands beyond the size limit.');
  }
  const projectFile = zip.file('project.json');
  if (!projectFile) throw new Error('Missing project manifest.');
  const manifest = JSON.parse(await projectFile.async('string')) as { format?: unknown; formatVersion?: unknown; project?: unknown; previews?: unknown };
  if (manifest.format !== FORMAT || manifest.formatVersion !== FORMAT_VERSION) throw new Error('Unsupported project archive format.');
  return { zip, project: readProject(manifest.project), previewFingerprints: manifest.previews };
}

export async function readProjectArchiveManifest(bytes: Uint8Array): Promise<ProjectState> {
  return (await openProjectArchive(bytes)).project;
}

export async function decodeProjectArchiveWithPreviews(bytes: Uint8Array): Promise<{ project: ProjectState; previews: Record<string, Uint8Array> }> {
  const { zip, project: parsed, previewFingerprints } = await openProjectArchive(bytes);
  const images = new Map<string, Promise<string>>();
  const document = await mapImages(writeProject(parsed), async value => {
    if (!value.startsWith(IMAGE_REFERENCE)) return value;
    const path = value.slice(IMAGE_REFERENCE.length);
    const existing = images.get(path);
    if (existing) return existing;
    const loading = (async () => {
      const match = IMAGE_PATH.exec(path);
      const file = match && zip.file(path);
      if (!match || !file) throw new Error('Missing project image.');
      const image = await file.async('uint8array');
      if (image.length > MAX_IMAGE_SIZE || await digest(image) !== match[1]) throw new Error('Invalid project image.');
      return `data:image/${match[2]};base64,${toBase64(image)}`;
    })();
    images.set(path, loading);
    return loading;
  });
  const project = readProject(document);
  const previews: Record<string, Uint8Array> = {};
  for (const [index, page] of (project.pages ?? []).entries()) {
    try {
      if (!Array.isArray(previewFingerprints) || typeof previewFingerprints[index] !== 'string') continue;
      const file = zip.file(`previews/${index}.webp`);
      if (!file) continue;
      const size = (file as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
      if (!Number.isSafeInteger(size) || size! < 0 || size! > MAX_PREVIEW_SIZE) continue;
      if (previewFingerprints[index] !== pagePreviewFingerprint(page)) continue;
      const preview = await file.async('uint8array');
      if (preview.length <= MAX_PREVIEW_SIZE && isWebP(preview)) {
        previews[page.id] = preview;
      }
    } catch {}
  }
  return { project, previews };
}

export async function decodeProjectArchive(bytes: Uint8Array): Promise<ProjectState> {
  const { project, previews } = await decodeProjectArchiveWithPreviews(bytes);
  for (const page of project.pages ?? []) if (previews[page.id]) rememberProjectPreview(project, page, previews[page.id]);
  return project;
}