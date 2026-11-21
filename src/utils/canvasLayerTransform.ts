import type { Layer, ProjectState } from '../types.ts';
import { updateProjectLayer } from '../features/ai/domain/layerOperations.ts';

export type CanvasLayerUpdate = {
  layerId: string;
  updates: Partial<Layer>;
};

export type LayerBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type LayerBoundsSource = Pick<Layer, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

export function boundsOfLayers(layers: readonly LayerBoundsSource[]): LayerBounds | null {
  if (!layers.length) return null;
  const points = layers.flatMap(layer => {
    const radians = (layer.rotation || 0) * Math.PI / 180;
    const centerX = layer.x + layer.width / 2;
    const centerY = layer.y + layer.height / 2;
    return [
      [-layer.width / 2, -layer.height / 2],
      [layer.width / 2, -layer.height / 2],
      [layer.width / 2, layer.height / 2],
      [-layer.width / 2, layer.height / 2]
    ].map(([relativeX, relativeY]) => ({
      x: centerX + relativeX * Math.cos(radians) - relativeY * Math.sin(radians),
      y: centerY + relativeX * Math.sin(radians) + relativeY * Math.cos(radians)
    }));
  });
  const left = Math.min(...points.map(point => point.x));
  const top = Math.min(...points.map(point => point.y));
  const right = Math.max(...points.map(point => point.x));
  const bottom = Math.max(...points.map(point => point.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function selectedRoots(project: ProjectState, selectedLayerIds: readonly string[]): Layer[] {
  const selected = new Set(selectedLayerIds);
  return project.layers.filter(layer => selected.has(layer.id) && (!layer.parentId || !selected.has(layer.parentId)));
}

export function rootSelectionIds(project: ProjectState, selectedLayerIds: readonly string[]): string[] {
  return selectedRoots(project, selectedLayerIds)
    .filter(layer => !layer.locked && !project.layers.find(parent => parent.id === layer.parentId)?.locked)
    .map(layer => layer.id);
}

export function selectionBounds(project: ProjectState, selectedLayerIds: readonly string[]): LayerBounds | null {
  return boundsOfLayers(selectedRoots(project, selectedLayerIds));
}

export function applyCanvasLayerUpdates(project: ProjectState, updates: readonly CanvasLayerUpdate[]): ProjectState {
  const selected = new Set(updates.map(update => update.layerId));
  let next = project;
  for (const update of updates) {
    if (!next.layers.some(layer => layer.id === update.layerId)) continue;
    const layer = next.layers.find(item => item.id === update.layerId)!;
    if (layer.parentId && selected.has(layer.parentId)) continue;
    next = updateProjectLayer(next, update.layerId, update.updates);
  }
  return next;
}
