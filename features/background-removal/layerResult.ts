import type { Layer, ProjectState } from '../../types.ts';
import { updateProjectLayer } from '../ai/domain/layerOperations.ts';
import type { RemovalResult } from './types.ts';

export function applyRemovalResult(project: ProjectState, result: RemovalResult, copyId: string): ProjectState {
  const original = project.layers.find(layer => layer.id === result.layerId);
  const parent = project.layers.find(layer => layer.id === original?.parentId);
  if (!original || original.type !== 'image' || original.content !== result.originalContent ||
      original.locked || parent?.locked || original.backgroundRemoved) return project;
  const updates: Partial<Layer> = {
    content: result.content, backgroundRemoved: true,
    imageSource: original.imageSource ?? 'unknown', imageDescription: original.imageDescription ?? ''
  };
  if (!result.keepOriginal) return updateProjectLayer(project, original.id, updates);
  if (!copyId || project.layers.some(layer => layer.id === copyId)) return project;
  const copy: Layer = {
    ...original, ...updates, id: copyId,
    zIndex: original.zIndex + 0.5
  };
  const layers = project.layers.map(layer => {
    if (layer.id === original.id) return { ...layer, visible: false };
    if (layer.id === original.parentId) return {
      ...layer, children: layer.children?.flatMap(id => id === original.id ? [id, copyId] : [id])
    };
    return layer;
  });
  const ordered = [...layers].sort((left, right) => left.zIndex - right.zIndex)
    .flatMap(layer => layer.id === original.id ? [layer, copy] : [layer]);
  return {
    ...project, layers: ordered.map((layer, index) => ({ ...layer, zIndex: index + 1 })),
    selectedLayerId: copyId, updatedAt: Date.now()
  };
}