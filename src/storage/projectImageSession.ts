import type { ProjectPage, ProjectState } from '../types.ts';
import { captureImageAssets, imageAssets, isImageAsset } from './imageAssets.ts';
import { syncProjectPages } from './projectCompatibility.ts';

export class ProjectImageSession {
  readonly owner = imageAssets.createOwner();
  private closed = false;
  private observed = new Set<string>();
  private pageReferences = new WeakMap<ProjectPage, string[]>();

  async addImage(source: Blob | string): Promise<string> {
    if (this.closed) throw new Error('Project image session has been closed.');
    if (typeof source !== 'string') return imageAssets.add(this.owner, source);
    if (isImageAsset(source)) {
      imageAssets.retain(this.owner, source);
      return source;
    }
    if (!/^data:image\/|^blob:/i.test(source)) return source;
    const response = await fetch(source);
    if (!response.ok) throw new Error('Unable to read project image.');
    return imageAssets.add(this.owner, await response.blob());
  }

  async adopt(project: ProjectState): Promise<ProjectState> {
    if (this.closed) throw new Error('Project image session has been closed.');
    const synced = syncProjectPages(project);
    const pending = new Map<string, Promise<string>>();
    const convert = (value: string): Promise<string> => {
      if (isImageAsset(value)) return this.addImage(value);
      if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return Promise.resolve(value);
      let result = pending.get(value);
      if (!result) {
        result = (async () => {
          let response: Response;
          try { response = await fetch(value); } catch { return value; }
          if (!response.ok) return value;
          return imageAssets.add(this.owner, await response.blob());
        })();
        pending.set(value, result);
      }
      return result;
    };
    const convertPages = (sourcePages: ProjectPage[]) => Promise.all(sourcePages.map(async page => {
      const layers = await Promise.all(page.layers.map(async layer => {
        if (layer.type !== 'image') return layer;
        const content = await convert(layer.content);
        return content === layer.content ? layer : { ...layer, content };
      }));
      const background = page.pageInfo.background;
      const value = background.type === 'image' ? await convert(background.value) : background.value;
      const changedLayers = layers.some((layer, index) => layer !== page.layers[index]);
      if (!changedLayers && value === background.value) return page;
      return {
        ...page,
        layers: changedLayers ? layers : page.layers,
        pageInfo: value === background.value ? page.pageInfo : { ...page.pageInfo, background: { ...background, value } }
      };
    }));
    const pages = await convertPages(synced.pages!);
    const versions = synced.versions?.length
      ? await Promise.all(synced.versions.map(async version => ({ ...version, pages: await convertPages(version.pages) })))
      : undefined;
    if (this.closed) throw new Error('Project image session has been closed.');
    const active = pages.find(page => page.id === synced.activePageId)!;
    return { ...synced, pages, ...(versions ? { versions } : {}), layers: active.layers, pageInfo: active.pageInfo };
  }

  reconcile(projects: ProjectState[]): void {
    if (this.closed) return;
    const live = new Set<string>();
    const visited = new Set<ProjectPage>();
    for (const project of projects) {
      const synced = syncProjectPages(project);
      const allPages = [...synced.pages!, ...(synced.versions?.flatMap(version => version.pages) ?? [])];
      for (const page of allPages) {
        if (visited.has(page)) continue;
        visited.add(page);
        let references = this.pageReferences.get(page);
        if (!references) {
          references = page.layers.filter(layer => layer.type === 'image' && isImageAsset(layer.content)).map(layer => layer.content);
          if (page.pageInfo.background.type === 'image' && isImageAsset(page.pageInfo.background.value)) references.push(page.pageInfo.background.value);
          this.pageReferences.set(page, references);
        }
        for (const reference of references) live.add(reference);
      }
    }
    for (const reference of this.observed) if (!live.has(reference)) imageAssets.releaseReference(this.owner, reference);
    this.observed = live;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    imageAssets.release(this.owner);
  }
}

export async function embedProjectImageAssets(project: ProjectState): Promise<ProjectState> {
  const synced = syncProjectPages(project);
  const allPages = [...synced.pages!, ...(synced.versions?.flatMap(version => version.pages) ?? [])];
  const blobs = captureImageAssets(allPages);
  const values = new Map<string, string>();
  await Promise.all([...blobs].map(async ([reference, blob]) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    values.set(reference, `data:${blob.type};base64,${btoa(binary)}`);
  }));
  const replacePages = (sourcePages: ProjectPage[]) => sourcePages.map(page => ({
    ...page,
    layers: page.layers.map(layer => layer.type === 'image' && values.has(layer.content) ? { ...layer, content: values.get(layer.content)! } : layer),
    pageInfo: {
      ...page.pageInfo,
      background: page.pageInfo.background.type === 'image' && values.has(page.pageInfo.background.value)
        ? { ...page.pageInfo.background, value: values.get(page.pageInfo.background.value)! }
        : page.pageInfo.background
    }
  }));
  const pages = replacePages(synced.pages!);
  const versions = synced.versions?.length
    ? synced.versions.map(version => ({ ...version, pages: replacePages(version.pages) }))
    : undefined;
  const active = pages.find(page => page.id === synced.activePageId)!;
  return { ...synced, pages, ...(versions ? { versions } : {}), layers: active.layers, pageInfo: active.pageInfo };
}