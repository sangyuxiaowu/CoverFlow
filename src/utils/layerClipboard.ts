import type { Layer, ProjectState } from '../types.ts';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { clonePlainData } from './clonePlainData.ts';
import { generateId } from './helpers.ts';

export type ClipboardEntry = { projectId: string; pageId: string; layerId: string; info?: string };
export type ClipboardDetails = ClipboardEntry & { available: boolean; projectName?: string; pageName?: string; name?: string; type?: Layer['type']; isGroup?: boolean; childCount?: number };
export type ProjectResolver = (projectId: string) => Promise<ProjectState>;

const MAX_ENTRIES = 500;
const keyOf = (entry: ClipboardEntry) => JSON.stringify([entry.projectId, entry.pageId, entry.layerId]);

export class LayerClipboard {
  private entries: ClipboardEntry[] = [];
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.entries;
  private changed(entries: ClipboardEntry[]) { this.entries = entries; this.version++; this.listeners.forEach(listener => listener()); }
  clear() { if (this.entries.length) this.changed([]); else this.version++; }
  remove(entry: ClipboardEntry) { this.changed(this.entries.filter(item => keyOf(item) !== keyOf(entry))); }

  async copy(entries: ClipboardEntry[], resolve: ProjectResolver, signal?: AbortSignal) {
    if (!Array.isArray(entries) || !entries.length || entries.length > MAX_ENTRIES) throw new Error('Clipboard requires 1-500 entries.');
    const parsed = entries.map(entry => {
      if (!entry || typeof entry !== 'object' || Object.keys(entry).some(field => !['projectId', 'pageId', 'layerId', 'info'].includes(field))) throw new Error('Invalid clipboard entry.');
      for (const field of ['projectId', 'pageId', 'layerId'] as const) if (typeof entry[field] !== 'string' || !entry[field].trim() || entry[field].length > 200) throw new Error(`Invalid ${field}.`);
      if (entry.info !== undefined && (typeof entry.info !== 'string' || entry.info.length > 200 || /data\s*:/i.test(entry.info))) throw new Error('info must be short text without data URLs.');
      return { projectId: entry.projectId, pageId: entry.pageId, layerId: entry.layerId, ...(entry.info !== undefined ? { info: entry.info } : {}) };
    });
    const version = this.version;
    const projects = new Map<string, ProjectState>();
    for (const entry of parsed) {
      const project = projects.get(entry.projectId) ?? await resolve(entry.projectId);
      projects.set(entry.projectId, project);
      const page = syncProjectPages(project).pages!.find(item => item.id === entry.pageId);
      if (!page?.layers.some(layer => layer.id === entry.layerId)) throw new Error('Clipboard source layer not found: ' + entry.layerId);
      signal?.throwIfAborted();
    }
    if (version !== this.version) throw new Error('Clipboard changed while copying.');
    const existing = new Set(this.entries.map(keyOf));
    const added = parsed.filter(entry => { const key = keyOf(entry); if (existing.has(key)) return false; existing.add(key); return true; });
    if (this.entries.length + added.length > MAX_ENTRIES) throw new Error('Clipboard is limited to 500 entries.');
    if (added.length) this.changed([...this.entries, ...added]);
    return { added: added.length, count: this.entries.length };
  }

  async check(resolve: ProjectResolver): Promise<ClipboardDetails[]> {
    const entries = this.entries;
    const projects = new Map<string, Promise<ProjectState>>();
    return Promise.all(entries.map(async entry => {
      try {
        let pending = projects.get(entry.projectId);
        if (!pending) { pending = resolve(entry.projectId); projects.set(entry.projectId, pending); }
        const project = await pending;
        const page = syncProjectPages(project).pages!.find(item => item.id === entry.pageId);
        const layer = page?.layers.find(item => item.id === entry.layerId);
        if (!page || !layer) return { ...entry, available: false };
        return { ...entry, available: true, projectName: project.title, pageName: page.name, name: layer.name, type: layer.type, isGroup: layer.type === 'group', ...(layer.type === 'group' ? { childCount: layer.children?.length ?? 0 } : {}) };
      } catch { return { ...entry, available: false }; }
    }));
  }

  async paste(target: ProjectState, pageId: string, resolve: ProjectResolver, signal?: AbortSignal) {
    const entries = this.entries;
    const version = this.version;
    if (!entries.length) throw new Error('Clipboard is empty.');
    const synced = syncProjectPages(target);
    const destination = synced.pages!.find(page => page.id === pageId);
    if (!destination) throw new Error('Target page not found.');
    const projects = new Map<string, ProjectState>();
    const sources = new Map<string, { layers: Layer[]; selected: Set<string> }>();
    for (const entry of entries) {
      const project = entry.projectId === target.id ? target : projects.get(entry.projectId) ?? await resolve(entry.projectId);
      projects.set(entry.projectId, project);
      const page = syncProjectPages(project).pages!.find(item => item.id === entry.pageId);
      const layer = page?.layers.find(item => item.id === entry.layerId);
      if (!page || !layer) throw new Error('Clipboard source layer not found: ' + entry.layerId);
      const sourceKey = JSON.stringify([entry.projectId, entry.pageId]);
      let source = sources.get(sourceKey);
      if (!source) { source = { layers: page.layers, selected: new Set<string>() }; sources.set(sourceKey, source); }
      source.selected.add(layer.id);
      if (layer.type === 'group') for (const childId of layer.children ?? []) {
        if (!page.layers.some(child => child.id === childId)) throw new Error('Clipboard group child not found: ' + childId);
        source.selected.add(childId);
      }
      signal?.throwIfAborted();
    }
    if (version !== this.version) throw new Error('Clipboard changed while pasting.');
    let zIndex = Math.max(0, ...destination.layers.map(layer => layer.zIndex));
    const copies: Layer[] = [];
    for (const source of sources.values()) {
      const selected = source.layers.filter(layer => source.selected.has(layer.id)).sort((left, right) => left.zIndex - right.zIndex);
      const ids = new Map(selected.map(layer => [layer.id, generateId()]));
      for (const layer of selected) copies.push({ ...clonePlainData(layer), id: ids.get(layer.id)!, parentId: layer.parentId ? ids.get(layer.parentId) : undefined, ...(layer.children ? { children: layer.children.map(id => ids.get(id)).filter((id): id is string => Boolean(id)) } : {}), zIndex: ++zIndex });
    }
    const layers = [...destination.layers, ...copies];
    const pages = synced.pages!.map(page => page.id === pageId ? { ...page, layers } : page);
    const selectedLayerId = copies.find(layer => !layer.parentId)?.id ?? null;
    return { project: { ...synced, pages, updatedAt: Date.now(), ...(pageId === synced.activePageId ? { layers, selectedLayerId } : {}) }, createdLayerIds: copies.map(layer => layer.id) };
  }
}