import { expect, it, vi } from 'vitest';
import type { WorkspaceBridge } from '../types.ts';
import { syncProjectPages } from '../../../storage/projectCompatibility.ts';
import { executePageTool } from './pages.ts';

it('manages pages, retains each page content and confirms deletion', async () => {
  let project = syncProjectPages({ id: 'project', title: 'Test', layers: [], selectedLayerId: null, updatedAt: 1, pageInfo: { ...({ width: 900, height: 383 }), background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 } } });
  const confirm = vi.fn(async () => true);
  const bridge: WorkspaceBridge = { getProject: () => project, getSelection: () => [], commit: async next => { project = syncProjectPages(next); }, manageProjects: async () => {}, confirm };
  const signal = new AbortController().signal;
  const run = (action: string, rest = {}) => executePageTool({ action, ...rest }, bridge, signal);
  const firstId = project.activePageId!;
  await run('create', { afterPageId: firstId, name: 'Detail', pageInfo: { width: 500 } });
  expect(project.pageInfo).toMatchObject({ width: 500, height: 383, background: { type: 'color', value: '#fff' } });
  const secondId = project.activePageId!;
  const context = await run('list');
  expect(context.pages.map(page => page.index)).toEqual([1, 2]);
  expect(context.pages.map(page => page.canvas)).toEqual(['900x383', '500x383']);
  await run('switch', { pageId: firstId });
  expect(project.pageInfo.width).toBe(900);
  await run('duplicate', { pageId: secondId });
  expect(project.pages).toHaveLength(3);
  expect(project.pageInfo.width).toBe(500);
  expect(project.pages!.map(page => page.id)).toEqual([firstId, project.activePageId, secondId]);
  await run('delete', { pageId: secondId });
  expect(confirm).toHaveBeenCalledOnce();
  expect(project.pages).toHaveLength(2);
  confirm.mockResolvedValueOnce(false);
  await expect(run('delete', { pageId: firstId })).rejects.toThrow('cancelled');
  expect(project.pages).toHaveLength(2);
  await run('switch', { pageId: firstId });
  await run('create', { afterPageId: firstId, name: 'No switch', autoSwitch: false });
  expect(project.activePageId).toBe(firstId);
  await run('duplicate', { pageId: firstId, afterPageId: firstId, autoSwitch: false });
  expect(project.activePageId).toBe(firstId);
  await run('move', { pageId: firstId, afterPageId: firstId, autoSwitch: false });
  expect(project.activePageId).toBe(firstId);
  await expect(run('switch', { pageId: 'missing' })).rejects.toThrow('not found');
  await expect(run('list', { width: 100 })).rejects.toThrow('Unsupported');
  await expect(executePageTool({ projectId: 'wrong', action: 'list' }, bridge, signal)).rejects.toThrow('Unsupported');
  await expect(executePageTool({ action: 'list' }, { ...bridge, getProject: () => null }, signal)).rejects.toThrow('No project open');
});

it('uses afterPageId and autoSwitch for create, duplicate and move', async () => {
  let project = syncProjectPages({ id: 'project', title: 'Test', layers: [], selectedLayerId: null, updatedAt: 1, pageInfo: { ...({ width: 900, height: 383 }), background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 } } });
  const bridge: WorkspaceBridge = { getProject: () => project, getSelection: () => [], commit: async next => { project = syncProjectPages(next); }, manageProjects: async () => {} };
  const signal = new AbortController().signal;
  const run = (args: Record<string, unknown>) => executePageTool(args, bridge, signal);
  const firstId = project.activePageId!;

  await run({ action: 'create', afterPageId: firstId, name: 'Created', autoSwitch: false });
  expect(project.activePageId).toBe(firstId);
  const createdId = project.pages!.find(page => page.name === 'Created')!.id;

  await run({ action: 'duplicate', pageId: firstId, afterPageId: createdId });
  const copyId = project.activePageId!;
  expect(project.pages!.map(page => page.id)).toContain(copyId);
  expect(project.pages!.map(page => page.id).indexOf(copyId)).toBe(project.pages!.map(page => page.id).indexOf(createdId) + 1);

  await run({ action: 'move', pageId: firstId, afterPageId: createdId, autoSwitch: false });
  expect(project.activePageId).toBe(copyId);
  expect(project.pages!.map(page => page.id).indexOf(firstId)).toBe(project.pages!.map(page => page.id).indexOf(createdId) + 1);

  await run({ action: 'move', pageId: firstId, afterPageId: createdId });
  expect(project.activePageId).toBe(firstId);
});