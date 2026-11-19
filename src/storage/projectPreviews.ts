import type { ProjectPage, ProjectState } from '../types.ts';
import { sha256 } from '@noble/hashes/sha2.js';

const previews = new WeakMap<ProjectPage['layers'], WeakMap<ProjectPage['pageInfo'], Uint8Array>>();
const fingerprints = new WeakMap<ProjectPage['layers'], WeakMap<ProjectPage['pageInfo'], string>>();

export function notifyProjectPreview(projectId: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('coverflow-project-preview', { detail: projectId }));
}

export function pagePreviewFingerprint(page: ProjectPage): string {
  const cached = fingerprints.get(page.layers)?.get(page.pageInfo);
  if (cached) return cached;
  const hash = sha256.create();
  const encoder = new TextEncoder();
  const append = (value: string) => hash.update(encoder.encode(value));
  const writeString = (value: string) => {
    append('"');
    for (let offset = 0; offset < value.length;) {
      let end = Math.min(offset + 32768, value.length);
      if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff && value.charCodeAt(end) >= 0xdc00 && value.charCodeAt(end) <= 0xdfff) end--;
      append(JSON.stringify(value.slice(offset, end)).slice(1, -1));
      offset = end;
    }
    append('"');
  };
  const writeValue = (value: unknown): void => {
    if (typeof value === 'string') { writeString(value); return; }
    if (Array.isArray(value)) {
      append('[');
      for (let index = 0; index < value.length; index++) {
        if (index) append(',');
        writeValue(value[index]);
      }
      append(']');
      return;
    }
    if (value && typeof value === 'object') {
      const sorted = Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
      const entries = Object.entries(sorted).filter(([, item]) => item !== undefined && typeof item !== 'function' && typeof item !== 'symbol');
      append('{');
      entries.forEach(([key, item], index) => { if (index) append(','); writeString(key); append(':'); writeValue(item); });
      append('}');
      return;
    }
    append(JSON.stringify(value) ?? 'null');
  };
  writeValue({ pageInfo: page.pageInfo, layers: page.layers });
  const fingerprint = Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('');
  let entries = fingerprints.get(page.layers);
  if (!entries) { entries = new WeakMap(); fingerprints.set(page.layers, entries); }
  entries.set(page.pageInfo, fingerprint);
  return fingerprint;
}

export function rememberProjectPreview(_project: ProjectState, page: ProjectPage, bytes: Uint8Array) {
  let entries = previews.get(page.layers);
  if (!entries) { entries = new WeakMap(); previews.set(page.layers, entries); }
  entries.set(page.pageInfo, bytes);
}

export function projectPreviews(project: ProjectState): Record<string, Uint8Array> {
  const result: Record<string, Uint8Array> = {};
  for (const page of project.pages ?? []) {
    const bytes = previews.get(page.layers)?.get(page.pageInfo);
    if (bytes) result[page.id] = bytes;
  }
  return result;
}
