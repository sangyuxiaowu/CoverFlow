import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Layer, ProjectState } from '../../../types.ts';
import type { WorkspaceBridge } from '../types.ts';
import { createImageToolExtensions } from './imageTools.ts';
import { syncProjectPages } from '../../../storage/projectCompatibility.ts';
import { insertProjectPage } from '../../../utils/projectPages.ts';
import { imageAssets } from '../../../storage/imageAssets.ts';

const original: Layer = { id: 'source', type: 'image', name: 'Photo', content: 'data:image/png;base64,iVBORw0KGgo=',
  x: 20, y: 30, width: 200, height: 300, rotation: 25, zIndex: 1, visible: true, locked: false, opacity: 0.7 };
const output = new Blob(['output'], { type: 'image/png' });
function setup() {
  let project: ProjectState = syncProjectPages({ id: 'project', title: 'Test', updatedAt: 0, selectedLayerId: null, layers: [{ ...original }], pageInfo: { ...({ width: 1200, height: 630 }), background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 1 } } });
  const commit = vi.fn(async (next: ProjectState) => { project = next; });
  const bridge: WorkspaceBridge = { getProject: () => project, getSelection: () => ['source'], manageProjects: async () => {}, commit };
  const tools = createImageToolExtensions(bridge);
  const signal = new AbortController().signal;
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2048, height: 1536, close: vi.fn() })));
  return { tools, signal, commit, getProject: () => project, setProject: (next: ProjectState) => { project = next; } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('host image tool callbacks', () => {
  it('registers generated image blobs directly with the workspace', async () => {
    const { signal, getProject } = setup();
    const registerImage = vi.fn(async () => 'asset-image:generated:image/png');
    const commit = vi.fn(async (_next: ProjectState) => {});
    const bridge: WorkspaceBridge = { getProject, getSelection: () => [], manageProjects: async () => {}, registerImage, commit };
    const prepared = await createImageToolExtensions(bridge).generate_image!.prepare({}, signal);
    await prepared.complete({ images: [output], model: 'model' }, signal);
    expect(registerImage).toHaveBeenCalledExactlyOnceWith(output);
    expect(commit.mock.calls[0][0].layers.at(-1)?.content).toBe('asset-image:generated:image/png');
  });
  it('uses the original binary asset as an AI reference and rejects released assets', async () => {
    const owner = imageAssets.createOwner();
    const blob = new Blob(['original-image'], { type: 'image/png' });
    const reference = await imageAssets.add(owner, blob);
    const { tools, signal, getProject } = setup();
    getProject().layers[0].content = reference;
    try {
      const prepared = await tools.generate_image!.prepare({ references: ['source'] }, signal);
      expect(prepared.inputImages![0]).toBe(blob);
      imageAssets.release(owner);
      await expect(tools.generate_image!.prepare({ references: ['source'] }, signal)).rejects.toThrow('unavailable');
    } finally { imageAssets.release(owner); }
  });
  it('uses original reference bytes and adds multiple generated results in one commit', async () => {
    const { tools, signal, commit, getProject } = setup();
    const prepared = await tools.generate_image!.prepare({ references: ['source', 'source'] }, signal);
    expect(prepared.inputImages).toHaveLength(2);
    expect(await prepared.inputImages![0].arrayBuffer()).toEqual(Uint8Array.from(atob('iVBORw0KGgo='), c => c.charCodeAt(0)).buffer);
    const result = await prepared.complete({ images: [output, output], model: 'model', prompt: 'City' }, signal) as { layerIds: string[] };
    expect(commit).toHaveBeenCalledOnce();
    expect(getProject().layers[0]).toEqual(original);
    expect(result.layerIds).toHaveLength(2);
    expect(getProject().layers[1]).toMatchObject({ width: 840, height: 630, x: 180, y: 0, imageSource: 'model', imageDescription: 'City' });
    expect(getProject().selectedLayerId).toBe(result.layerIds[1]);
  });
  it('resolves mixed current, cross-page, cross-project, asset and attachment references in order', async () => {
    const { signal, getProject } = setup();
    const project = getProject();
    const otherPage = { ...project.pages![0], id: 'page2', layers: [{ ...original, id: 'other' }] };
    project.pages!.push(otherPage);
    const external = { ...project, id: 'external', activePageId: 'page2', layers: otherPage.layers };
    const asset = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1])], { type: 'image/png' });
    const attachment = new Blob(['attachment'], { type: 'image/jpeg' });
    const getProjectById = vi.fn(async () => external);
    const getFileHandle = vi.fn(async () => ({ getFile: async () => asset }));
    const getDirectoryHandle = vi.fn(async () => ({ getFileHandle }));
    const bridge: WorkspaceBridge = { getProject: () => project, getProjectById, getSelection: () => [],
      getAssetFolder: async () => ({ getDirectoryHandle }) as unknown as FileSystemDirectoryHandle,
      commit: async () => {}, manageProjects: async () => {} };
    const prepared = await createImageToolExtensions(bridge, async id => id === 'upload' ? attachment : null).generate_image!.prepare({
      references: ['source', 'page2/other', 'external/page2/other', 'folder:桑仔/2D.png', 'attachment://upload']
    }, signal);
    expect(prepared.inputImages).toHaveLength(5);
    expect(await Promise.all(prepared.inputImages!.slice(0, 3).map(image => image.arrayBuffer()))).toEqual(
      Array(3).fill(Uint8Array.from(atob('iVBORw0KGgo='), character => character.charCodeAt(0)).buffer));
    expect(await prepared.inputImages![3].arrayBuffer()).toEqual(await asset.arrayBuffer());
    expect(prepared.inputImages![4]).toBe(attachment);
    expect(getProjectById).toHaveBeenCalledWith('external');
    expect(getDirectoryHandle).toHaveBeenCalledWith('桑仔');
    expect(getFileHandle).toHaveBeenCalledWith('2D.png');
    otherPage.layers[0].content = 'data:image/png;base64,AAAA';
    await expect(prepared.complete({ images: [output], model: 'model' }, signal)).rejects.toThrow('changed');
  });
  it('rejects invalid and missing reference sources', async () => {
    const { tools, signal } = setup();
    for (const reference of ['', 'page/', 'a/b/c/d', 'missing', 'missing/source', 'other/page/source', 'attachment://', 'attachment://missing', 'folder:../image.png']) {
      await expect(tools.generate_image!.prepare({ references: [reference] }, signal)).rejects.toThrow();
    }
    await expect(tools.generate_image!.prepare({ references: [5] }, signal)).rejects.toThrow('Invalid');
  });
  it('checks reference changes during output decoding', async () => {
    const { tools, signal, getProject, commit } = setup();
    const prepared = await tools.generate_image!.prepare({ references: ['source'] }, signal);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      getProject().layers[0].content = 'data:image/png;base64,AAAA';
      return { width: 100, height: 100, close: vi.fn() };
    }));
    await expect(prepared.complete({ images: [output], model: 'model' }, signal)).rejects.toThrow('changed');
    expect(commit).not.toHaveBeenCalled();
  });
  it.each([true, false])('applies removal with keepOriginal=%s, preserving geometry and grouping', async keepOriginal => {
    const { tools, signal, getProject } = setup();
    getProject().layers[0].parentId = 'group';
    getProject().layers.push({ ...original, id: 'group', type: 'group', children: ['source'], content: '' });
    const prepared = await tools.remove_background!.prepare({ layerId: 'source', keepOriginal }, signal);
    const result = await prepared.complete({ images: [output], model: 'u2netp' }, signal) as { layerId: string };
    const layer = getProject().layers.find(item => item.id === result.layerId)!;
    expect(layer).toMatchObject({ x: 20, y: 30, width: 200, height: 300, rotation: 25, opacity: 0.7, parentId: 'group', backgroundRemoved: true });
    expect(getProject().layers.find(item => item.id === 'group')!.children).toContain(layer.id);
    if (keepOriginal) expect(getProject().layers.find(item => item.id === 'source')).toMatchObject({ content: original.content, visible: false });
    else expect(result.layerId).toBe('source');
  });
  it.each(['original', 'locked', 'group', 'removed', 'project', 'page'] as const)('rejects %s changes during processing', async change => {
    const { tools, signal, getProject, setProject, commit } = setup();
    const prepared = await tools.remove_background!.prepare({ layerId: 'source' }, signal);
    const project = getProject();
    if (change === 'original') project.layers[0].content = 'data:image/png;base64,AAAA';
    if (change === 'locked') project.layers[0].locked = true;
    if (change === 'removed') project.layers[0].backgroundRemoved = true;
    if (change === 'group') {
      project.layers[0].parentId = 'group';
      project.layers.push({ ...original, id: 'group', type: 'group', locked: true, children: ['source'] });
    }
    if (change === 'project') project.id = 'other';
    if (change === 'page') setProject(insertProjectPage(project, 'Second'));
    await expect(prepared.complete({ images: [output], model: 'u2netp' }, signal)).rejects.toThrow();
    expect(commit).not.toHaveBeenCalled();
  });
  it('rejects a page switch during decoding and preserves unrelated edits', async () => {
    const { tools, signal, getProject, setProject, commit } = setup();
    const prepared = await tools.generate_image!.prepare({}, signal);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      setProject(insertProjectPage(getProject(), 'Second'));
      return { width: 100, height: 100, close: vi.fn() };
    }));
    await expect(prepared.complete({ images: [output], model: 'model', prompt: 'City' }, signal)).rejects.toThrow('active page changed');
    expect(commit).not.toHaveBeenCalled();
    const next = await tools.generate_image!.prepare({}, signal);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      getProject().title = 'Updated during decoding';
      return { width: 100, height: 100, close: vi.fn() };
    }));
    await next.complete({ images: [output], model: 'model', prompt: 'City' }, signal);
    expect(getProject().title).toBe('Updated during decoding');
  });
  it('rejects changed references, invalid source combinations and cancellation', async () => {
    const { tools, signal, getProject, commit } = setup();
    await expect(tools.generate_image!.prepare({ references: 'source' }, signal)).rejects.toThrow('array');
    await expect(tools.remove_background!.prepare({}, signal)).rejects.toThrow('either layerId or imageId');
    await expect(tools.remove_background!.prepare({ imageId: 'attachment', keepOriginal: true }, signal)).rejects.toThrow('requires layerId');
    const prepared = await tools.generate_image!.prepare({ references: ['source'] }, signal);
    getProject().layers[0].content = 'data:image/png;base64,AAAA';
    await expect(prepared.complete({ images: [output], model: 'model', prompt: 'City' }, signal)).rejects.toThrow('changed');
    const controller = new AbortController();
    controller.abort();
    await expect(prepared.complete({ images: [output], model: 'model', prompt: 'City' }, controller.signal)).rejects.toThrow();
    expect(commit).not.toHaveBeenCalled();
  });
  it('reports an uncertain save without retrying', async () => {
    const { tools, signal, commit } = setup();
    const prepared = await tools.generate_image!.prepare({}, signal);
    commit.mockRejectedValueOnce(new Error('Disk full'));
    await expect(prepared.complete({ images: [output], model: 'model', prompt: 'City' }, signal)).rejects.toThrow('may already be applied');
    expect(commit).toHaveBeenCalledOnce();
  });
});
