import type { ProjectPage } from '../types.ts';

export const MAX_PAGE_PREVIEWS = 100;
export const PAGE_PREVIEW_EDGE = 2048;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function serializePagePreview(page: ProjectPage): string {
  const metadata = new Set(['id', 'name', 'parentId', 'children', 'imageSource', 'imageDescription', 'backgroundRemoved']);
  const layers = page.layers.filter(layer => layer.visible && layer.type !== 'group').sort((left, right) => left.zIndex - right.zIndex)
    .map(layer => Object.fromEntries(Object.entries(layer).filter(([key]) => !metadata.has(key))));
  return JSON.stringify(canonical({ schema: 1, maxEdge: PAGE_PREVIEW_EDGE, quality: 0.9,
    canvas: { width: page.canvasConfig.width, height: page.canvasConfig.height }, background: page.background, layers }));
}

export class PagePreviewCache {
  private entries = new Map<string, string>();

  constructor(private limit = MAX_PAGE_PREVIEWS) {}

  get size() { return this.entries.size; }

  peek(key: string): string | undefined { return this.entries.get(key); }

  get(key: string): string | undefined {
    const url = this.entries.get(key);
    if (url) { this.entries.delete(key); this.entries.set(key, url); }
    return url;
  }

  delete(key: string) {
    const url = this.entries.get(key);
    if (url) URL.revokeObjectURL(url);
    this.entries.delete(key);
  }

  put(key: string, blob: Blob): string {
    const previous = this.entries.get(key);
    if (previous) URL.revokeObjectURL(previous);
    this.entries.delete(key);
    const url = URL.createObjectURL(blob);
    this.entries.set(key, url);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value!;
      URL.revokeObjectURL(this.entries.get(oldest)!);
      this.entries.delete(oldest);
    }
    return url;
  }

  clear() {
    for (const url of this.entries.values()) URL.revokeObjectURL(url);
    this.entries.clear();
  }
}