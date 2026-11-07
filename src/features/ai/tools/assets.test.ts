// @vitest-environment jsdom
import { File as NodeFile } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectState } from '../../../types.ts';
import type { WorkspaceBridge } from '../types.ts';
import { executeTool } from './execute.ts';

const brandSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><rect width="400" height="100" fill="#e32145"/></svg>';

function fileHandle(name: string, content: string | Uint8Array) {
  return { kind: 'file', name, getFile: vi.fn(async () => new NodeFile([typeof content === 'string' ? content : new Uint8Array(content)], name)) } as unknown as FileSystemFileHandle;
}

function directory(name: string, entries: Record<string, FileSystemHandle> = {}) {
  return {
    kind: 'directory', name,
    entries: async function* () { yield* Object.entries(entries); },
    getDirectoryHandle: vi.fn(async (key: string) => {
      const entry = entries[key];
      if (entry?.kind !== 'directory') throw new Error('Directory not found: ' + key);
      return entry;
    }),
    getFileHandle: vi.fn(async (key: string) => {
      const entry = entries[key];
      if (entry?.kind !== 'file') throw new Error('File not found: ' + key);
      return entry;
    })
  } as unknown as FileSystemDirectoryHandle;
}

function setup() {
  let project: ProjectState | null = {
    id: 'p1', title: 'Assets', layers: [], selectedLayerId: null, updatedAt: 0,
    canvasConfig: { width: 1200, height: 600, ratio: '2:1' },
    background: { type: 'color', value: '#ffffff', overlayType: 'none', overlayColor: '#000000', overlayOpacity: 0, overlayScale: 20 }
  };
  const logo = fileHandle('logo.svg', brandSvg);
  const photo = fileHandle('photo.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]));
  const root = directory('assets', { 'Brand-品牌': directory('Brand-品牌', { 'logo.svg': logo, 'photo.png': photo }) });
  const commit = vi.fn(async (next: ProjectState) => { project = next; });
  const bridge: WorkspaceBridge = {
    getProject: () => project, getSelection: () => [], getAssetFolder: vi.fn(async () => root),
    commit, manageProjects: async () => ({})
  };
  const controller = new AbortController();
  const run = (name: string, args: Record<string, unknown>) => executeTool(name, args, bridge, controller.signal);
  return { bridge, root, logo, photo, commit, controller, run, setProject: (next: ProjectState | null) => { project = next; } };
}

afterEach(() => vi.unstubAllGlobals());

describe('asset tools', () => {
  it('searches without a project or reading contents, filters metadata and paginates', async () => {
    const { run, logo, photo, setProject } = setup();
    setProject(null);
    const result = await run('search_assets', { query: '品牌', pageSize: 1 }) as { items: { assetId: string }[]; total: number; hasMore: boolean; folder: { status: string } };
    expect(result).toMatchObject({ total: 2, hasMore: true, folder: { status: 'ready' } });
    expect(result.items).toEqual([expect.objectContaining({ assetId: 'folder:Brand-品牌/logo.svg' })]);
    const next = await run('search_assets', { pageSize: 1, page: 2 }) as typeof result;
    expect(next.items[0].assetId).toBe('folder:Brand-品牌/photo.png');
    expect(next.hasMore).toBe(false);
    expect(await run('search_assets', { query: 'BRAND-品牌/LOGO', type: 'svg' })).toMatchObject({ total: 1 });
    expect(await run('search_assets', { type: 'image' })).toMatchObject({ total: 1 });
    expect(await run('search_assets', { query: ' ', page: 100 })).toMatchObject({ items: [], total: 2 });
    expect(JSON.stringify(result)).not.toMatch(/content|fileHandle|<svg|base64/);
    expect(logo.getFile).not.toHaveBeenCalled();
    expect(photo.getFile).not.toHaveBeenCalled();
  });

  it('reports inaccessible or unconfigured folders without fallback assets', async () => {
    const { bridge, run } = setup();
    bridge.getAssetFolder = async () => { throw new Error('Authorize folder in UI'); };
    expect(await run('search_assets', {})).toMatchObject({ items: [], total: 0, folder: { status: 'unavailable', message: 'Authorize folder in UI' } });
    await expect(run('place_asset', { projectId: 'p1', assetId: 'folder:Brand-品牌/logo.svg' })).rejects.toThrow('Authorize');
    bridge.getAssetFolder = vi.fn(async () => null);
    expect(await run('search_assets', {})).toMatchObject({ items: [], total: 0, folder: { status: 'not_configured' } });
  });

  it('places an exact SVG snapshot centered, preserving original color and aspect ratio', async () => {
    const { run, bridge, commit } = setup();
    const result = await run('place_asset', { projectId: 'p1', assetId: 'folder:Brand-品牌/logo.svg' });
    expect(result).toMatchObject({ success: true, projectId: 'p1', width: 300, height: 75, x: 450, y: 262.5 });
    const layer = bridge.getProject()!.layers[0];
    expect(layer).toMatchObject({ name: 'logo', type: 'svg', ratioLocked: true, zIndex: 1, visible: true, locked: false });
    expect(layer.content).toContain('fill="#e32145"');
    expect(layer.color).toBeUndefined();
    expect(bridge.getProject()!.selectedLayerId).toBe(layer.id);
    expect(layer.id).toMatch(/^[a-z0-9]{9}$/);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('<svg');
  });

  it('does not place an asset on a page selected after the read started', async () => {
    const { run, bridge, logo, commit, setProject } = setup();
    setProject({ ...bridge.getProject()!, activePageId: 'first-page' });
    vi.mocked(logo.getFile).mockImplementation(async () => {
      setProject({ ...bridge.getProject()!, activePageId: 'second-page' });
      return new NodeFile([brandSvg], 'logo.svg') as unknown as File;
    });
    await expect(run('place_asset', { projectId: 'p1', assetId: 'folder:Brand-品牌/logo.svg' })).rejects.toThrow('page changed');
    expect(commit).not.toHaveBeenCalled();
  });

  it('scales from a single dimension and supports explicit position without flattening the resource', async () => {
    const { run, bridge } = setup();
    await run('place_asset', { projectId: 'p1', assetId: 'folder:Brand-品牌/logo.svg', height: 50, x: 12, y: 24 });
    expect(bridge.getProject()!.layers[0]).toMatchObject({ width: 200, height: 50, x: 12, y: 24 });
    await run('place_asset', { projectId: 'p1', assetId: 'folder:Brand-品牌/logo.svg', width: 400, height: 100 });
    expect(bridge.getProject()!.layers[1]).toMatchObject({ width: 400, height: 100, zIndex: 2 });
    await expect(run('place_asset', { projectId: 'p1', assetId: 'folder:Brand-品牌/logo.svg', width: 200, height: 200 })).rejects.toThrow('aspect ratio');
    expect(bridge.getProject()!.layers).toHaveLength(2);
  });

  it('rejects builtin references before accessing any folder', async () => {
    const { run, bridge, commit } = setup();
    await expect(run('place_asset', { projectId: 'p1', assetId: 'builtin:Basic Shapes/Circle' })).rejects.toThrow('Invalid assetId');
    expect(bridge.getAssetFolder).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('embeds original PNG bytes with source metadata and closes the bitmap', async () => {
    const { run, bridge, photo } = setup();
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 800, height: 400, close })));
    await run('place_asset', { projectId: 'p1', assetId: 'folder:Brand-品牌/photo.png', width: 400 });
    const layer = bridge.getProject()!.layers[0];
    expect(layer).toMatchObject({ type: 'image', width: 400, height: 200, imageSource: 'folder:Brand-品牌/photo.png', imageDescription: 'photo' });
    const original = await (await photo.getFile()).arrayBuffer();
    expect(Buffer.from(layer.content.split(',')[1], 'base64')).toEqual(Buffer.from(original));
    expect(layer.content).toMatch(/^data:image\/png;base64,/);
    expect(close).toHaveBeenCalledOnce();
  });

  it('validates parameters before folder access or commits', async () => {
    const { run, bridge, commit } = setup();
    for (const args of [{ page: 1.5 }, { pageSize: 51 }, { source: 'folder' }, { source: 'builtin' }, { type: 'text' }, { query: 7 }, { extra: true }]) {
      await expect(run('search_assets', args)).rejects.toThrow();
    }
    for (const args of [{}, { projectId: 'p2' }, { width: 0 }, { x: NaN }, { height: Infinity }, { zIndex: 0 }]) {
      await expect(run('place_asset', { projectId: 'p1', assetId: 'folder:Brand-品牌/logo.svg', ...args, ...(Object.keys(args).length ? {} : { assetId: '' }) })).rejects.toThrow();
    }
    expect(bridge.getAssetFolder).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('does not commit missing, unsafe, malformed or oversized files', async () => {
    const { run, logo, photo, commit } = setup();
    const args = { projectId: 'p1', assetId: 'folder:Brand-品牌/logo.svg' };
    await expect(run('place_asset', { ...args, assetId: 'folder:Brand-品牌/missing.svg' })).rejects.toThrow('not found');
    for (const content of ['', '<svg><broken></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"/></svg>']) {
      vi.mocked(logo.getFile).mockResolvedValue(new NodeFile([content], 'logo.svg') as unknown as File);
      await expect(run('place_asset', args)).rejects.toThrow();
    }
    vi.mocked(logo.getFile).mockResolvedValue(new NodeFile([' '.repeat(2 * 1024 * 1024 + 1)], 'logo.svg') as unknown as File);
    await expect(run('place_asset', args)).rejects.toThrow('2 MB');
    vi.mocked(photo.getFile).mockResolvedValue(new NodeFile(['not a PNG'], 'photo.png') as unknown as File);
    await expect(run('place_asset', { ...args, assetId: 'folder:Brand-品牌/photo.png' })).rejects.toThrow('PNG');
    expect(commit).not.toHaveBeenCalled();
  });

  it('rejects cancellation and project switches after async reads without losing concurrent edits', async () => {
    const { run, logo, bridge, setProject, commit, controller } = setup();
    const original = bridge.getProject()!;
    const args = { projectId: 'p1', assetId: 'folder:Brand-品牌/logo.svg' };
    vi.mocked(logo.getFile).mockImplementation(async () => {
      setProject({ ...original, id: 'other' });
      return new NodeFile([brandSvg], 'logo.svg') as unknown as File;
    });
    await expect(run('place_asset', args)).rejects.toThrow('project changed');
    expect(commit).not.toHaveBeenCalled();
    setProject(original);
    vi.mocked(logo.getFile).mockImplementation(async () => {
      setProject({ ...original, title: 'Concurrent edit' });
      return new NodeFile([brandSvg], 'logo.svg') as unknown as File;
    });
    await run('place_asset', args);
    expect(bridge.getProject()!.title).toBe('Concurrent edit');
    commit.mockClear();
    vi.mocked(logo.getFile).mockImplementation(async () => {
      controller.abort(new Error('Stopped'));
      return new NodeFile([brandSvg], 'logo.svg') as unknown as File;
    });
    await expect(run('place_asset', args)).rejects.toThrow('Stopped');
    expect(commit).not.toHaveBeenCalled();
  });
});