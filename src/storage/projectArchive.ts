import JSZip from 'jszip';
import { sha256 } from '@noble/hashes/sha2.js';
import type { ProjectDocument, ProjectState } from '../types.ts';
import { readProject, writeProject } from './projectCompatibility.ts';

const FORMAT = 'coverflow-project';
const FORMAT_VERSION = 1;
const IMAGE_REFERENCE = 'cfjx:';
const MAX_ARCHIVE_SIZE = 256 * 1024 * 1024;
const MAX_EXPANDED_SIZE = 512 * 1024 * 1024;
const MAX_IMAGE_SIZE = 64 * 1024 * 1024;
const MAX_PROJECT_SIZE = 32 * 1024 * 1024;
const IMAGE_PATH = /^images\/([a-f0-9]{64})\.([a-z0-9.+-]+)$/;

const digest = (bytes: Uint8Array) => Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');

const fromBase64 = (value: string) => {
  const binary = atob(value.replace(/\s/g, ''));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

const toBase64 = (bytes: Uint8Array) => {
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

export async function encodeProjectArchive(project: ProjectState): Promise<Uint8Array> {
  const zip = new JSZip();
  const files = new Set<string>();
  let expandedSize = 0;
  const document = await mapImages(writeProject(project), async value => {
    if (!value.startsWith('data:')) return value;
    const match = /^data:image\/([a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(value);
    if (!match) throw new Error('Unsupported embedded image data URL.');
    const bytes = fromBase64(match[2]);
    if (bytes.length > MAX_IMAGE_SIZE) throw new Error('Embedded image exceeds the size limit.');
    const path = `images/${digest(bytes)}.${match[1].toLowerCase()}`;
    if (!files.has(path)) {
      expandedSize += bytes.length;
      if (expandedSize > MAX_EXPANDED_SIZE) throw new Error('Project archive expands beyond the size limit.');
      zip.file(path, bytes, { compression: 'STORE' });
      files.add(path);
    }
    return IMAGE_REFERENCE + path;
  });
  const manifest = JSON.stringify({ format: FORMAT, formatVersion: FORMAT_VERSION, project: document });
  const manifestSize = new TextEncoder().encode(manifest).length;
  if (manifestSize > MAX_PROJECT_SIZE || expandedSize + manifestSize > MAX_EXPANDED_SIZE) throw new Error('Project manifest exceeds the size limit.');
  zip.file('project.json', manifest, { compression: 'DEFLATE' });
  const result = await zip.generateAsync({ type: 'uint8array' });
  if (result.length > MAX_ARCHIVE_SIZE) throw new Error('Project archive exceeds the size limit.');
  return result;
}

export async function decodeProjectArchive(bytes: Uint8Array): Promise<ProjectState> {
  if (bytes.length > MAX_ARCHIVE_SIZE) throw new Error('Project archive exceeds the size limit.');
  const zip = await JSZip.loadAsync(bytes);
  let expandedSize = 0;
  for (const entry of Object.values(zip.files)) {
    const unsafe = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string; _data?: { uncompressedSize?: number } });
    if (unsafe.unsafeOriginalName && unsafe.unsafeOriginalName !== entry.name) throw new Error('Unsafe project archive path.');
    if (entry.dir) continue;
    const size = unsafe._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || size! < 0 || size! > (entry.name === 'project.json' ? MAX_PROJECT_SIZE : MAX_IMAGE_SIZE)) throw new Error('Invalid project archive entry size.');
    if (entry.name !== 'project.json' && !IMAGE_PATH.test(entry.name)) throw new Error('Unexpected project archive entry.');
    expandedSize += size!;
    if (expandedSize > MAX_EXPANDED_SIZE) throw new Error('Project archive expands beyond the size limit.');
  }
  const projectFile = zip.file('project.json');
  if (!projectFile) throw new Error('Missing project manifest.');
  const manifest = JSON.parse(await projectFile.async('string')) as { format?: unknown; formatVersion?: unknown; project?: unknown };
  if (manifest.format !== FORMAT || manifest.formatVersion !== FORMAT_VERSION) throw new Error('Unsupported project archive format.');
  const parsed = readProject(manifest.project);
  const document = await mapImages(writeProject(parsed), async value => {
    if (!value.startsWith(IMAGE_REFERENCE)) return value;
    const path = value.slice(IMAGE_REFERENCE.length);
    const match = IMAGE_PATH.exec(path);
    const file = match && zip.file(path);
    if (!match || !file) throw new Error('Missing project image.');
    const image = await file.async('uint8array');
    if (image.length > MAX_IMAGE_SIZE || digest(image) !== match[1]) throw new Error('Invalid project image.');
    return `data:image/${match[2]};base64,${toBase64(image)}`;
  });
  return readProject(document);
}