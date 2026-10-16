import type { Layer } from '../../../types.ts';
import type { WorkspaceBridge } from '../types.ts';
import { editLayers } from '../domain/layerOperations.ts';
import { backgroundPatch, choice, ids, layerPatch, number, record, safeImage, text, validateContent } from './validation.ts';
import { detectDecorationFormat, sanitizeBackgroundCss } from '../../../utils/customContent.ts';

export async function executeTool(name: string, input: unknown, bridge: WorkspaceBridge, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const args = record(input);
  if (name === 'manage_projects') return bridge.manageProjects(args, signal);
  const project = bridge.getProject();
  if (name === 'get_context') return project ? {
    projectId: project.id, title: project.title, canvas: project.canvasConfig,
    background: { ...project.background, value: project.background.value.startsWith('data:') ? '[embedded image]' : project.background.value },
    selectedLayerIds: bridge.getSelection(), layers: project.layers.map(({ content, ...layer }) => ({ ...layer, contentLength: content.length }))
  } : { projectId: null, message: 'No project open. Use manage_projects to list or create projects.' };
  if (!project) throw new Error('No project open.');
  if (text(args.projectId, 'projectId') !== project.id) throw new Error('The active project changed. Read get_context again.');
  if (name === 'read_layers') {
    const selected = args.layerIds === undefined ? null : ids(args.layerIds);
    const query = args.query === undefined ? '' : text(args.query, 'query').toLowerCase();
    return project.layers.filter(layer => (!selected || selected.includes(layer.id)) && (!query || (layer.name + ' ' + layer.content).toLowerCase().includes(query))).map(layer => ({ ...layer, content: layer.content.startsWith('data:') ? '[embedded image]' : layer.content }));
  }
  let next = project;
  if (name === 'add_layer') {
    const type = choice(args.type, 'type', ['text', 'svg', 'image', 'decoration']);
    const patch = layerPatch(args.properties);
    if (type === 'decoration' && patch.color !== undefined) throw new Error('Decoration colors must be changed in content via CSS variables, not layer.color.');
    const content = validateContent(type, text(patch.content, 'content'), patch.decorationFormat);
    if (type === 'decoration') patch.decorationFormat ??= detectDecorationFormat(content);
    const layer: Layer = { id: crypto.randomUUID(), name: type, type, content, x: 40, y: 40, width: 300, height: 100, rotation: 0, zIndex: Math.max(0, ...project.layers.map(item => item.zIndex)) + 1, visible: true, locked: false, opacity: 1, ...(type === 'text' ? { fontSize: 48, fontFamily: 'Inter, sans-serif', fontWeight: 700, color: '#ffffff', textAlign: 'left' } : {}), ...patch };
    next = { ...project, layers: [...project.layers, layer], selectedLayerId: layer.id };
  } else if (name === 'edit_layers') {
    const action = choice(args.action, 'action', ['update', 'delete', 'duplicate', 'group', 'ungroup', 'front', 'back', 'align', 'distribute']);
    const selected = ids(args.layerIds);
    const patch = args.properties === undefined ? {} : layerPatch(args.properties);
    if (action === 'update' && patch.color !== undefined && selected.some(id => project.layers.find(layer => layer.id === id)?.type === 'decoration')) {
      throw new Error('Decoration colors must be changed in content via CSS variables, not layer.color.');
    }
    if (patch.content !== undefined || patch.decorationFormat !== undefined) {
      selected.forEach(id => {
        const target = project.layers.find(layer => layer.id === id);
        if (!target || target.type === 'group') throw new Error('Read the layer before changing content.');
        validateContent(target.type, patch.content ?? target.content, patch.decorationFormat ?? target.decorationFormat);
      });
    }
    next = editLayers(project, action, selected, patch, args.mode === undefined ? undefined : text(args.mode, 'mode'));
  } else if (name === 'update_canvas') {
    const width = args.width === undefined ? project.canvasConfig.width : number(args.width, 'width', 10, 10000);
    const height = args.height === undefined ? project.canvasConfig.height : number(args.height, 'height', 10, 10000);
    const background = { ...project.background, ...(args.background === undefined ? {} : backgroundPatch(args.background)) };
    if (background.type === 'image') safeImage(background.value);
    if (background.type === 'css') {
      const result = sanitizeBackgroundCss(background.value);
      if (result.issues.length) throw new Error(result.issues.join('; '));
    }
    if (background.type !== 'image' && /url\s*\(/i.test(background.value)) throw new Error('Use an image background for image URLs.');
    next = { ...project, canvasConfig: { width, height, ratio: `${width}x${height}` }, background };
  } else throw new Error('Unknown tool: ' + name);
  signal.throwIfAborted();
  await bridge.commit({ ...next, updatedAt: Date.now() });
  return { success: true, projectId: next.id, selectedLayerId: next.selectedLayerId, layerIds: next.layers.map(layer => layer.id) };
}