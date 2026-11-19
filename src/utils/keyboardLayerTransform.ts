import type { ProjectState } from '../types.ts';
import { updateProjectLayer } from '../features/ai/domain/layerOperations.ts';

export const KEYBOARD_LAYER_TRANSFORM = 'coverflow:keyboard-layer-transform';
export const COMMIT_KEYBOARD_LAYER_TRANSFORM = 'coverflow:commit-keyboard-layer-transform';

export type KeyboardLayerTransform = {
  projectId: string;
  pageId: string | undefined;
  layerIds: string[];
  key: string;
  dx: number;
  dy: number;
  rotation: number;
};

export function applyKeyboardLayerTransform(project: ProjectState, transform: KeyboardLayerTransform): ProjectState {
  if (project.id !== transform.projectId || project.activePageId !== transform.pageId) return project;
  const selected = new Set(transform.layerIds);
  let next = project;
  for (const layer of project.layers) {
    if (!selected.has(layer.id) || layer.locked || (layer.parentId && selected.has(layer.parentId))) continue;
    if (layer.parentId && project.layers.find(parent => parent.id === layer.parentId)?.locked) continue;
    if (layer.children?.some(id => project.layers.find(child => child.id === id)?.locked)) continue;
    const latest = next.layers.find(candidate => candidate.id === layer.id)!;
    const updates = transform.rotation
      ? { rotation: (latest.rotation + transform.rotation) % 360 }
      : { x: latest.x + transform.dx, y: latest.y + transform.dy };
    next = updateProjectLayer(next, layer.id, updates);
  }
  return next;
}