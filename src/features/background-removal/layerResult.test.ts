import { describe, expect, it } from 'vitest';
import type { Layer, ProjectState } from '../../types.ts';
import { applyRemovalResult } from './layerResult.ts';
import type { RemovalResult } from './types.ts';

const image: Layer = {
  id: 'image', name: 'Photo', type: 'image', content: 'original', x: 10, y: 20, width: 200, height: 100,
  rotation: 15, zIndex: 1, visible: true, locked: false, opacity: .8, imageSource: 'upload', imageDescription: 'original prompt'
};
const makeProject = (): ProjectState => ({
  id: 'project', title: 'Test', layers: [structuredClone(image)], selectedLayerId: image.id, updatedAt: 0,
  canvasConfig: { width: 800, height: 600, ratio: '4:3' },
  background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 1 }
});
const result: RemovalResult = { layerId: image.id, originalContent: 'original', content: 'cutout', keepOriginal: true };

describe('atomic background-removal layer results', () => {
  it('hides the original and selects a processed copy at identical geometry', () => {
    const original = makeProject();
    const changed = applyRemovalResult(original, result, 'copy');
    expect(changed.layers[0]).toMatchObject({ ...image, visible: false });
    expect(changed.layers[1]).toMatchObject({ ...image, id: 'copy', content: 'cutout', backgroundRemoved: true, zIndex: 2 });
    expect(changed.selectedLayerId).toBe('copy');
    expect(original).toEqual(makeProject());
    expect(JSON.parse(JSON.stringify(changed)).layers[1].backgroundRemoved).toBe(true);
  });
  it('replaces in place when keeping the original is unchecked', () => {
    const changed = applyRemovalResult(makeProject(), { ...result, keepOriginal: false }, 'unused');
    expect(changed.layers).toHaveLength(1);
    expect(changed.layers[0]).toMatchObject({ content: 'cutout', visible: true, backgroundRemoved: true, imageDescription: 'original prompt' });
  });
  it('never processes a marked, locked, replaced, deleted or nonimage layer', () => {
    for (const patch of [{ backgroundRemoved: true }, { locked: true }, { content: 'new-image' }, { type: 'text' as const }]) {
      const project = makeProject();
      Object.assign(project.layers[0], patch);
      expect(applyRemovalResult(project, result, 'copy')).toBe(project);
    }
    const missing = { ...makeProject(), layers: [] };
    expect(applyRemovalResult(missing, result, 'copy')).toBe(missing);
  });
  it('maintains group membership, geometry and stacking order', () => {
    const project = makeProject();
    project.layers[0].parentId = 'group';
    project.layers.push({ ...image, id: 'caption', type: 'text', zIndex: 1.1 });
    project.layers.push({ ...image, id: 'group', type: 'group', zIndex: 3, children: ['image'] });
    const changed = applyRemovalResult(project, result, 'copy');
    expect(changed.layers.map(layer => layer.id)).toEqual(['image', 'copy', 'caption', 'group']);
    expect(changed.layers.find(layer => layer.id === 'group')?.children).toEqual(['image', 'copy']);
    expect(changed.layers.find(layer => layer.id === 'copy')?.parentId).toBe('group');
    project.layers[2].locked = true;
    expect(applyRemovalResult(project, result, 'copy')).toBe(project);
  });
});