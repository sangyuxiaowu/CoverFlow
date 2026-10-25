import type { Layer } from '../../../types.ts';
import type { WorkspaceBridge } from '../types.ts';
import { PRESET_RATIOS } from '../../../constants.ts';
import { editLayers } from '../domain/layerOperations.ts';
import { backgroundPatch, choice, ids, layerDetails, layerPatch, number, record, safeImage, text, validateContent, validateLayerGroups } from './validation.ts';
import { sanitizeBackgroundCss } from '../../../utils/customContent.ts';
import { hasActiveImageCrop, hasActiveImageFilters, normalizeImageCrop, normalizeImageFilters } from '../../../utils/imageLayer.ts';
import { ADD_LAYER_TYPES, LAYER_TOOL_ACTIONS, parseLayerToolRequest, parseManageProjectsRequest } from './requests.ts';
import { executeBackgroundRemovalTool } from './backgroundRemoval.ts';
import { generateId } from '../../../utils/helpers.ts';
import { executeAssetTool } from './assets.ts';

export async function executeTool(name: string, input: unknown, bridge: WorkspaceBridge, signal: AbortSignal, supportsVision = false): Promise<unknown> {
  signal.throwIfAborted();
  if (name === 'search_assets' || name === 'place_asset') return executeAssetTool(name, input, bridge, signal);
  if (name === 'remove_background') return executeBackgroundRemovalTool(input, bridge, signal);
  const args = record(input);
  if (name === 'get_cover_size_recommendations') return {
    note: '以下为常见用途的设计建议，不是平台强制规格。用户明确指定的尺寸优先；调整已有画布尺寸前应确认需求，图层不会自动缩放。',
    presets: PRESET_RATIOS
  };
  if (name === 'create_project') return bridge.manageProjects(parseManageProjectsRequest({ ...args, action: 'create' }), signal);
  if (name === 'search_projects') return bridge.manageProjects(parseManageProjectsRequest({ ...args, action: 'list' }), signal);
  if (name === 'manage_projects') {
    const request = parseManageProjectsRequest(args);
    if (request.action === 'create' || request.action === 'list') throw new Error('Use create_project or search_projects for this action.');
    return bridge.manageProjects(request, signal);
  }
  if (name === 'get_canvas_preview') {
    if (!bridge.getCanvasPreview) throw new Error('Canvas preview is unavailable.');
    return bridge.getCanvasPreview();
  }
  const project = bridge.getProject();
  if (name === 'get_context') return project ? {
    projectId: project.id, title: project.title, canvas: project.canvasConfig,
    background: { ...project.background, value: project.background.value.startsWith('data:') ? '[embedded image]' : project.background.value },
    selectedLayerIds: bridge.getSelection(),
    layers: project.layers.map(({ id, name, type, x, y, width, height, rotation, zIndex, visible, locked, opacity, ratioLocked, parentId, children }) => ({
      id, name, type, parentId, layerInfo: { x, y, width, height, rotation, zIndex, visible, locked, opacity, ratioLocked }, ...(type === 'group' && children ? { group: { children } } : {})
    }))
  } : { projectId: null, message: '当前未打开项目。请区分修改和新建，然后使用 search_projects 查找已有项目或 create_project 新建项目；新建前建议调用 get_cover_size_recommendations 获取常见封面尺寸及适配建议。' };
  if (!project) throw new Error('No project open.');
  if (name === 'get_selected_layers') {
    const selected = new Set(bridge.getSelection());
    const layers: unknown[] = [];
    const images: { layerId: string; name: string; blob: Blob }[] = [];
    for (const layer of project.layers) {
      if (!selected.has(layer.id)) continue;
      if (layer.type !== 'image') {
        layers.push(layerDetails(layer));
        continue;
      }
      const { content } = layer;
      const imageInfo: Record<string, unknown> = {
        sourceType: content.startsWith('data:') ? 'embedded' : 'url',
        sourceLength: content.length,
        previewStatus: supportsVision ? 'unavailable' : 'not_requested'
      };
      if (supportsVision && bridge.getLayerPreview) {
        try {
          const blob = await bridge.getLayerPreview(layer.id);
          signal.throwIfAborted();
          imageInfo.previewStatus = 'available';
          images.push({ layerId: layer.id, name: layer.name, blob });
        } catch {
          signal.throwIfAborted();
        }
      }
      const details = layerDetails(layer);
      const imageProperties = record(details.image);
      delete imageProperties.content;
      layers.push({ ...details, image: { ...imageProperties, imageInfo } });
    }
    return { kind: 'selected_layers', projectId: project.id, layers, images };
  }
  if (text(args.projectId, 'projectId') !== project.id) throw new Error('The active project changed. Read get_context again.');
  if (name === 'read_layers') {
    const selected = args.layerIds === undefined ? null : ids(args.layerIds);
    const query = args.query === undefined ? '' : text(args.query, 'query').toLowerCase();
    return project.layers.filter(layer => (!selected || selected.includes(layer.id)) && (!query || (layer.name + ' ' + layer.content).toLowerCase().includes(query))).map(layer => layerDetails({ ...layer, content: layer.content.startsWith('data:') ? '[embedded image]' : layer.content }));
  }
  let next = project;
  if (name === 'add_layer') {
    for (const field of Object.keys(args)) {
      if (!['projectId', 'type', 'properties'].includes(field)) throw new Error(`${name}: unsupported field ${field}.`);
    }
    const type = choice(args.type, 'type', ADD_LAYER_TYPES);
    if (Object.hasOwn(record(args.properties), 'zIndex')) throw new Error(`${name}: unsupported field zIndex. Use reorder_layers after creation.`);
    const patch = layerPatch(args.properties);
    validateLayerGroups(args.properties, type);
    const content = validateContent(type, text(patch.content, `properties.${type}.content`));
    const layer: Layer = { id: generateId(), name: type, type, content, x: 40, y: 40, width: 300, height: 100, rotation: 0, zIndex: Math.max(0, ...project.layers.map(item => item.zIndex)) + 1, visible: true, locked: false, opacity: 1, ...(type === 'text' ? { fontSize: 48, fontFamily: 'Inter, sans-serif', fontWeight: 700, color: '#ffffff', textAlign: 'left' } : {}), ...patch };
    if (type === 'image') {
      layer.imageSource ??= 'unknown';
      layer.imageDescription ??= '';
      if (patch.imageFilters !== undefined) {
        const normalizedFilters = normalizeImageFilters(patch.imageFilters);
        layer.imageFilters = hasActiveImageFilters(normalizedFilters) ? normalizedFilters : undefined;
      }
      if (patch.imageCrop !== undefined) {
        const normalizedCrop = normalizeImageCrop(patch.imageCrop);
        layer.imageCrop = hasActiveImageCrop(normalizedCrop) ? normalizedCrop : undefined;
      }
    }
    next = { ...project, layers: [...project.layers, layer], selectedLayerId: layer.id };
  } else if (Object.hasOwn(LAYER_TOOL_ACTIONS, name)) {
    const request = parseLayerToolRequest(name as keyof typeof LAYER_TOOL_ACTIONS, args);
    const { action, layerIds: selected } = request;
    const patch = request.action === 'update' ? request.properties : request.action === 'group' && request.name !== undefined ? { name: request.name } : {};
    if (action === 'update') selected.forEach(id => {
      const target = project.layers.find(layer => layer.id === id);
      if (!target) throw new Error('Unknown layer: ' + id);
      validateLayerGroups(args.properties, target.type);
    });
    if (patch.content !== undefined) {
      const content = text(patch.content, 'content');
      selected.forEach(id => {
        const target = project.layers.find(layer => layer.id === id);
        if (!target || target.type === 'group') throw new Error('Read the layer before changing content.');
        validateContent(target.type, content);
      });
    }
    next = editLayers(project, action, selected, patch, request.action === 'align' || request.action === 'distribute' ? request.mode : undefined);
  } else if (name === 'update_canvas') {
    const width = args.width === undefined ? project.canvasConfig.width : number(args.width, 'width', 10, 10000);
    const height = args.height === undefined ? project.canvasConfig.height : number(args.height, 'height', 10, 10000);
    const backgroundUpdates = args.background === undefined ? {} : backgroundPatch(args.background);
    const background = { ...project.background, ...backgroundUpdates };
    if (background.type === 'css' && ['overlayType', 'overlayColor', 'overlayOpacity', 'overlayScale'].some(field => field in backgroundUpdates)) {
      throw new Error('Overlay textures are not supported with CSS backgrounds.');
    }
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