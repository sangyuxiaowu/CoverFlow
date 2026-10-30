import { describe, expect, it } from 'vitest';
import type { ProjectState } from '../types.ts';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { copyProject, deleteProjectPage, insertProjectPage, moveProjectPage, pageNumber, renameProjectPage, selectProjectPage } from './projectPages.ts';

const initial = (): ProjectState => syncProjectPages({
  id: 'project', title: 'Article', layers: [], selectedLayerId: null, updatedAt: 1,
  background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 },
  canvasConfig: { width: 1200, height: 630, ratio: '40:21' }
});

describe('project pages', () => {
  it('inserts after the current page and defaults to its dimensions', () => {
    const first = initial();
    const second = insertProjectPage(first, 'Detail');
    expect(second.pages).toHaveLength(2);
    expect(second.pages![1].canvasConfig).toEqual(first.canvasConfig);
    expect(second.activePageId).toBe(second.pages![1].id);
    expect(insertProjectPage(selectProjectPage(second, first.activePageId!), '').pages!.map(page => page.name)).toEqual(['', '', 'Detail']);
    expect(pageNumber(0)).toBe('P01');
    expect(pageNumber(98)).toBe('P99');
  });

  it('retains the active page through reordering and chooses a neighbor on deletion', () => {
    const second = insertProjectPage(initial(), 'Detail');
    const moved = moveProjectPage(second, second.activePageId!, second.pages![0].id);
    expect(moved.pages![0].id).toBe(second.activePageId);
    expect(moved.activePageId).toBe(second.activePageId);
    const remaining = deleteProjectPage(moved, moved.activePageId!);
    expect(remaining.activePageId).toBe(remaining.pages![0].id);
    expect(() => deleteProjectPage(remaining, remaining.activePageId!)).toThrow();
  });

  it('copies page groups with fresh IDs and leaves source content unchanged', () => {
    const base = initial();
    const properties = { x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 };
    const project = syncProjectPages({ ...base, layers: [
      { ...properties, id: 'group', name: 'Group', type: 'group', content: '', children: ['text'] },
      { ...properties, id: 'text', name: 'Text', type: 'text', content: 'Hello', parentId: 'group' }
    ] });
    const duplicate = insertProjectPage(project, '', project.canvasConfig, project.activePageId);
    expect(duplicate.layers[0].id).not.toBe('group');
    expect(duplicate.layers[0].children).toEqual([duplicate.layers[1].id]);
    expect(duplicate.layers[1].parentId).toBe(duplicate.layers[0].id);
    expect(project.pages).toHaveLength(1);
    const copied = copyProject(duplicate, 'Copy');
    expect(copied.id).not.toBe(project.id);
    expect(copied.pages).toHaveLength(2);
    expect(copied.pages![0].id).not.toBe(project.pages![0].id);
    expect(renameProjectPage(copied, copied.activePageId!, ' ').pages![0].name).toBe('');
  });

  it('enforces the page limit for both new pages and copies', () => {
    let project = initial();
    for (let index = 1; index < 99; index++) project = insertProjectPage(project, '');
    expect(project.pages).toHaveLength(99);
    expect(() => insertProjectPage(project, '')).toThrow('99');
    expect(() => insertProjectPage(project, '', project.canvasConfig, project.activePageId)).toThrow('99');
  });
});