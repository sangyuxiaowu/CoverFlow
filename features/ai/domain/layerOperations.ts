import type { Layer, ProjectState } from '../../../types.ts';

export type LayerAction = 'update' | 'delete' | 'duplicate' | 'group' | 'ungroup' | 'front' | 'back' | 'forward' | 'backward' | 'align' | 'distribute';

export function groupBounds(layers: Layer[], ids: string[]) {
  const children = layers.filter(layer => ids.includes(layer.id));
  if (!children.length) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(...children.map(layer => layer.x));
  const y = Math.min(...children.map(layer => layer.y));
  return { x, y, width: Math.max(1, ...children.map(layer => layer.x + layer.width - x)), height: Math.max(1, ...children.map(layer => layer.y + layer.height - y)) };
}

export function updateProjectLayer(project: ProjectState, id: string, updates: Partial<Layer>): ProjectState {
  const target = project.layers.find(layer => layer.id === id);
  if (!target) throw new Error('Layer not found: ' + id);
  let layers: Layer[];
  if (target.type === 'group') {
    const baseWidth = Math.max(1, target.width);
    const baseHeight = Math.max(1, target.height);
    const next = { ...target, ...updates, width: Math.max(1, updates.width ?? baseWidth), height: Math.max(1, updates.height ?? baseHeight), rotation: updates.rotation ?? (target.rotation || 0) };
    const scaleX = next.width / baseWidth;
    const scaleY = next.height / baseHeight;
    const rotation = (next.rotation - (target.rotation || 0)) * Math.PI / 180;
    const hasTransform = ['x', 'y', 'width', 'height', 'rotation'].some(field => field in updates);
    layers = project.layers.map(layer => {
      if (layer.id === id) return next;
      if (!target.children?.includes(layer.id)) return layer;
      const child = { ...layer };
      for (const field of ['visible', 'locked', 'opacity'] as const) {
        if (updates[field] !== undefined) Object.assign(child, { [field]: updates[field] });
      }
      if (hasTransform) {
        const relativeX = (layer.x + layer.width / 2 - target.x - baseWidth / 2) * scaleX;
        const relativeY = (layer.y + layer.height / 2 - target.y - baseHeight / 2) * scaleY;
        child.width = Math.max(10, layer.width * scaleX);
        child.height = Math.max(10, layer.height * scaleY);
        child.x = next.x + next.width / 2 + relativeX * Math.cos(rotation) - relativeY * Math.sin(rotation) - child.width / 2;
        child.y = next.y + next.height / 2 + relativeX * Math.sin(rotation) + relativeY * Math.cos(rotation) - child.height / 2;
        child.rotation += next.rotation - (target.rotation || 0);
      }
      return child;
    });
  } else {
    layers = project.layers.map(layer => {
      if (layer.id !== id) return layer;
      const next = { ...layer, ...updates };
      if (layer.ratioLocked) {
        if (updates.width !== undefined && updates.height === undefined) next.height = updates.width * layer.height / layer.width;
        if (updates.height !== undefined && updates.width === undefined) next.width = updates.height * layer.width / layer.height;
      }
      return next;
    });
  }
  if (target.parentId) {
    const parent = layers.find(layer => layer.id === target.parentId);
    if (parent) layers = layers.map(layer => layer.id === parent.id ? { ...layer, ...groupBounds(layers, parent.children || []) } : layer);
  }
  return { ...project, layers, updatedAt: Date.now() };
}

export function editLayers(project: ProjectState, action: LayerAction, ids: string[], patch: Partial<Layer> = {}, mode?: string): ProjectState {
  const selected = [...new Set(ids)].map(id => {
    const layer = project.layers.find(item => item.id === id);
    if (!layer) throw new Error('Layer not found: ' + id);
    return layer;
  });
  if (!selected.length) throw new Error('Select at least one layer.');
  const expanded = new Set(selected.flatMap(layer => [layer.id, ...(layer.children || [])]));
  if (action !== 'update' || Object.keys(patch).some(key => key !== 'locked')) {
    if (project.layers.some(layer => expanded.has(layer.id) && (layer.locked || project.layers.find(parent => parent.id === layer.parentId)?.locked))) {
      throw new Error('Unlock the layers before editing.');
    }
  }
  let result = structuredClone(project);
  if (action === 'update') {
    selected.filter(layer => !layer.parentId || !expanded.has(layer.parentId)).forEach(layer => { result = updateProjectLayer(result, layer.id, patch); });
  } else if (action === 'delete') {
    result.layers = result.layers.filter(layer => !expanded.has(layer.id)).map(layer => ({ ...layer, ...(layer.children ? { children: layer.children.filter(id => !expanded.has(id)) } : {}) }));
    result.layers = result.layers.filter(layer => layer.type !== 'group' || layer.children?.length);
    result.layers = result.layers.map(layer => layer.type === 'group' ? { ...layer, ...groupBounds(result.layers, layer.children || []) } : layer);
    if (result.selectedLayerId && !result.layers.some(layer => layer.id === result.selectedLayerId)) result.selectedLayerId = null;
  } else if (action === 'duplicate') {
    const idMap = new Map([...expanded].map(id => [id, crypto.randomUUID()]));
    const baseZ = Math.max(0, ...result.layers.map(layer => layer.zIndex));
    const clones = result.layers.filter(layer => expanded.has(layer.id)).map((layer, index) => ({
      ...layer, id: idMap.get(layer.id)!, name: layer.name + ' (copy)', x: layer.x + 20, y: layer.y + 20, zIndex: baseZ + index + 1,
      parentId: layer.parentId ? idMap.get(layer.parentId) : undefined,
      ...(layer.children ? { children: layer.children.map(id => idMap.get(id)!) } : {})
    }));
    result.layers.push(...clones);
    result.selectedLayerId = idMap.get(selected[0].id)!;
  } else if (action === 'group') {
    if (selected.length < 2 || selected.some(layer => layer.parentId || layer.type === 'group')) throw new Error('Group at least two ungrouped layers.');
    const id = crypto.randomUUID();
    result.layers = result.layers.map(layer => expanded.has(layer.id) ? { ...layer, parentId: id } : layer);
    result.layers.push({ id, name: patch.name || 'Group', type: 'group', content: '', ...groupBounds(result.layers, ids), rotation: 0, zIndex: Math.max(0, ...result.layers.map(layer => layer.zIndex)) + 1, visible: true, locked: false, opacity: 1, children: selected.map(layer => layer.id) });
    result.selectedLayerId = id;
  } else if (action === 'ungroup') {
    if (selected.some(layer => layer.type !== 'group')) throw new Error('Select groups to ungroup.');
    const groups = new Set(ids);
    result.layers = result.layers.filter(layer => !groups.has(layer.id)).map(layer => groups.has(layer.parentId || '') ? { ...layer, parentId: undefined } : layer);
    result.selectedLayerId = selected[0].children?.[0] || null;
  } else if (action === 'front' || action === 'back') {
    const ordered = [...result.layers].sort((left, right) => left.zIndex - right.zIndex);
    const moving = ordered.filter(layer => expanded.has(layer.id));
    const staying = ordered.filter(layer => !expanded.has(layer.id));
    result.layers = (action === 'front' ? [...staying, ...moving] : [...moving, ...staying]).map((layer, index) => ({ ...layer, zIndex: index + 1 }));
  } else if (action === 'forward' || action === 'backward') {
    const ordered = [...result.layers].sort((left, right) => left.zIndex - right.zIndex);
    const step = action === 'forward' ? 1 : -1;
    const start = step === 1 ? ordered.length - 2 : 1;
    for (let index = start; index >= 0 && index < ordered.length; index -= step) {
      const neighbor = index + step;
      if (neighbor >= 0 && neighbor < ordered.length && expanded.has(ordered[index].id) && !expanded.has(ordered[neighbor].id)) {
        [ordered[index], ordered[neighbor]] = [ordered[neighbor], ordered[index]];
      }
    }
    result.layers = ordered.map((layer, index) => ({ ...layer, zIndex: index + 1 }));
  } else if (action === 'align') {
    if (!['left', 'center', 'right', 'top', 'middle', 'bottom'].includes(mode || '')) throw new Error('Invalid alignment.');
    selected.filter(layer => !layer.parentId || !expanded.has(layer.parentId)).forEach(layer => {
      const { width, height } = result.canvasConfig;
      const transform = mode === 'left' ? { x: 0 } : mode === 'center' ? { x: (width - layer.width) / 2 } : mode === 'right' ? { x: width - layer.width } : mode === 'top' ? { y: 0 } : mode === 'middle' ? { y: (height - layer.height) / 2 } : { y: height - layer.height };
      result = updateProjectLayer(result, layer.id, transform);
    });
  } else if (action === 'distribute') {
    if (!['horizontal', 'vertical'].includes(mode || '') || selected.length < 3 || selected.some(layer => layer.parentId && expanded.has(layer.parentId))) throw new Error('Distribute at least three independent layers.');
    const axis = mode === 'horizontal' ? 'x' : 'y';
    const size = axis === 'x' ? 'width' : 'height';
    const ordered = [...selected].sort((left, right) => left[axis] - right[axis]);
    const start = ordered[0][axis];
    const end = ordered.at(-1)![axis] + ordered.at(-1)![size];
    const gap = (end - start - ordered.reduce((total, layer) => total + layer[size], 0)) / (ordered.length - 1);
    let position = start;
    ordered.forEach(layer => { result = updateProjectLayer(result, layer.id, { [axis]: position }); position += layer[size] + gap; });
  } else throw new Error('Unsupported layer action.');
  return { ...result, updatedAt: Date.now() };
}