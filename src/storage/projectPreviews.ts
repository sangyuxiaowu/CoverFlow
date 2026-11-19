import type { ProjectPage, ProjectState } from '../types.ts';
import { sha256 } from '@noble/hashes/sha2.js';

const previews = new WeakMap<ProjectPage['layers'], WeakMap<ProjectPage['pageInfo'], Uint8Array>>();
const fingerprints = new WeakMap<ProjectPage['layers'], WeakMap<ProjectPage['pageInfo'], string>>();

export function notifyProjectPreview(projectId: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('coverflow-project-preview', { detail: projectId }));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function pagePreviewFingerprint(page: ProjectPage): string {
  const cached = fingerprints.get(page.layers)?.get(page.pageInfo);
  if (cached) return cached;
  const data = new TextEncoder().encode(JSON.stringify(canonical({ pageInfo: page.pageInfo, layers: page.layers })));
  const fingerprint = Array.from(sha256(data), byte => byte.toString(16).padStart(2, '0')).join('');
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
