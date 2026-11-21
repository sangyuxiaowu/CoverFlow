import type { ImageToolExtension, ImageToolExtensions, ImageToolResult, ImageToolSchemaExtension } from 'sang-ai-kit/built-in-tools';
import { blobToDataUrl, encodeWebp, imageMimeType } from 'sang-ai-kit/image-attachments';
import { download } from 'sang-ai-kit/background-removal/resources.ts';
import type { Layer, ProjectState } from '../../../types.ts';
import type { WorkspaceBridge } from '../types.ts';
import { safeImage, text } from './validation.ts';
import { generateId } from '../../../utils/helpers.ts';
import { applyRemovalResult } from '../../../utils/backgroundRemovalResult.ts';
import { findAsset } from '../../../storage/assets.ts';
import { imageAssets, isImageAsset } from '../../../storage/imageAssets.ts';

export const IMAGE_TOOL_SCHEMAS: ImageToolExtensions<ImageToolSchemaExtension> = {
  generate_image: {
    description: '生成或修改图像并直接添加到当前画布，返回图层 ID。',
    properties: {
      references: { type: 'array', items: { type: 'string' }, description: '可选，按顺序提供参考图标识：当前页 layer:layerId、项目内 layer:pageId/layerId、跨项目 layer:projectId/pageId/layerId、素材 folder:分类/文件.png、会话图片 attachment://imageId。使用原图，可混合多种来源；数量须符合模型限制。' }
    }
  },
  remove_background: {
    description: '移除图层或附件图片背景并直接应用到当前画布。',
    properties: {
      layerId: { type: 'string', description: '当前页图片图层 ID；与 imageId 二选一。' },
      keepOriginal: { type: 'boolean', description: '仅图层抠图可用，默认 true：保留并隐藏原图；false 替换原图。' }
    },
    optional: ['imageId']
  }
};

export function coverFlowImageDefinition<T extends { name: string; parameters: Record<string, unknown> }>(definition: T): T {
  if (definition.name !== 'generate_image') return definition;
  const { referenceImageId, referenceImageIds, references, ...properties } = definition.parameters.properties as Record<string, Record<string, unknown>>;
  return { ...definition, parameters: { ...definition.parameters, properties: {
    ...properties,
    ...(referenceImageIds ? { references: { ...references, ...(referenceImageIds.maxItems !== undefined ? { maxItems: referenceImageIds.maxItems } : {}) } } : {})
  } } };
}

function currentProject(bridge: WorkspaceBridge, projectId?: string): ProjectState {
  const project = bridge.getProject();
  if (!project || (projectId !== undefined && project.id !== projectId)) throw new Error('The active project changed or is not open. Read get_context again.');
  return project;
}

function currentPage(bridge: WorkspaceBridge, projectId: string, pageId: string | undefined): ProjectState {
  const project = currentProject(bridge, projectId);
  if (project.activePageId !== pageId) throw new Error('The active page changed. Read get_context again.');
  return project;
}

function imageLayer(project: ProjectState, layerId: string, removal: boolean): Layer {
  const layer = project.layers.find(item => item.id === layerId);
  if (!layer || layer.type !== 'image') throw new Error('Target must be an existing image layer on the current page.');
  if (removal && (layer.locked || project.layers.find(item => item.id === layer.parentId)?.locked)) throw new Error('Unlock the image layer and its group before background removal.');
  if (removal && layer.backgroundRemoved) throw new Error('Background already removed.');
  return layer;
}

async function loadLayerImage(content: string, signal: AbortSignal): Promise<Blob> {
  let blob: Blob;
  if (isImageAsset(content)) {
    signal.throwIfAborted();
    const stored = imageAssets.blob(content);
    if (!stored) throw new Error('Image asset is unavailable.');
    if (stored.size > 25 * 1024 * 1024) throw new Error('Image exceeds the 25 MB source limit.');
    blob = stored;
  } else {
    safeImage(content);
    const url = new URL(content);
    if (url.username || url.password) throw new Error('Image URLs must not contain credentials.');
    blob = await download(content, 25 * 1024 * 1024, signal);
  }
  if (blob.type === 'image/gif') return encodeWebp(blob, Infinity, 0.95);
  imageMimeType(blob.type);
  return blob;
}

async function applyImages(bridge: WorkspaceBridge, projectId: string, pageId: string | undefined, result: ImageToolResult,
  signal: AbortSignal, removal: boolean, source?: { layerId: string; content: string; removal: boolean; keepOriginal: boolean }, validateReferences?: (project: ProjectState) => void) {
  const decoded = await Promise.all(result.images.map(async blob => {
    imageMimeType(blob.type);
    if (blob.size > 25 * 1024 * 1024) throw new Error('Image exceeds the 25 MB source limit.');
    const content = bridge.registerImage ? await bridge.registerImage(blob) : await blobToDataUrl(blob);
    const bitmap = await createImageBitmap(blob);
    const width = bitmap.width, height = bitmap.height;
    bitmap.close();
    if (!width || !height || width * height > 67108864) throw new Error('Image has invalid dimensions or exceeds 64 megapixels.');
    return { content, width, height };
  }));
  signal.throwIfAborted();
  let project = currentPage(bridge, projectId, pageId);
  validateReferences?.(project);
  if (source && imageLayer(project, source.layerId, source.removal).content !== source.content) throw new Error('Original image changed while processing; result was not applied.');
  const layerIds: string[] = [];
  for (const image of decoded) {
    const id = generateId();
    if (source?.removal) {
      const next = applyRemovalResult(project, { layerId: source.layerId, originalContent: source.content, content: image.content, keepOriginal: source.keepOriginal }, id);
      if (next === project) throw new Error('Target changed, is locked or already processed; result was not applied.');
      const layerId = source.keepOriginal ? id : source.layerId;
      project = { ...next, selectedLayerId: layerId };
      layerIds.push(layerId);
    } else {
      const scale = Math.min(1, project.pageInfo.width / image.width, project.pageInfo.height / image.height);
      const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
      const layer: Layer = {
        id, type: 'image', name: 'Image', content: image.content, width, height,
        imageSource: removal ? 'upload' : result.model, imageDescription: result.prompt ?? '',
        backgroundRemoved: removal,
        x: Math.round((project.pageInfo.width - width) / 2), y: Math.round((project.pageInfo.height - height) / 2),
        visible: true, locked: false, rotation: 0, opacity: 1, ratioLocked: true,
        zIndex: Math.max(0, ...project.layers.map(item => item.zIndex)) + 1
      };
      project = { ...project, updatedAt: Date.now(), layers: [...project.layers, layer], selectedLayerId: id };
      layerIds.push(id);
    }
  }
  signal.throwIfAborted();
  try { await bridge.commit(project); }
  catch (error) {
    throw new Error(`Saving failed; changes may already be applied to layers ${layerIds.join(', ')}. Read get_context before retrying. ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  return { success: true, projectId, pageId, layerIds, ...(layerIds.length === 1 ? { layerId: layerIds[0] } : {}),
    ...(removal ? { modelId: result.model, backgroundRemoved: true } : { model: result.model, prompt: result.prompt }),
    ...(source?.removal ? { sourceLayerId: source.layerId, keepOriginal: source.keepOriginal } : {}) };
}

export function createImageToolExtensions(bridge: WorkspaceBridge, loadImage?: (id: string) => Promise<Blob | null>): ImageToolExtensions<ImageToolExtension> {
  return {
    generate_image: {
      ...IMAGE_TOOL_SCHEMAS.generate_image!,
      prepare: async (args, signal) => {
        const initial = currentProject(bridge);
        const projectId = initial.id;
        const pageId = initial.activePageId;
        if (args.references !== undefined && !Array.isArray(args.references)) throw new Error('references must be an array.');
        const layers: { pageId: string | undefined; layerId: string; content: string }[] = [];
        const inputImages = await Promise.all(((args.references ?? []) as unknown[]).map(async value => {
          const reference = text(value, 'reference');
          if (reference.startsWith('attachment://')) {
            const id = reference.slice('attachment://'.length);
            if (!id || id.includes('/')) throw new Error('Invalid attachment reference.');
            const image = await loadImage?.(id);
            if (!image) throw new Error('Reference attachment not found.');
            imageMimeType(image.type);
            return image;
          }
          if (reference.startsWith('folder:')) {
            const entry = await findAsset(reference, await bridge.getAssetFolder?.() ?? null);
            if (entry.type !== 'image') throw new Error('Reference asset must be a PNG image.');
            const file = await entry.fileHandle.getFile();
            if (file.size > 25 * 1024 * 1024) throw new Error('Image exceeds the 25 MB source limit.');
            const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
            if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => signature[index] === byte)) throw new Error('Reference asset must contain a PNG.');
            return file.slice(0, file.size, 'image/png');
          }
          if (!reference.startsWith('layer:')) throw new Error('Invalid reference protocol. Use layer:, folder: or attachment://.');
          const parts = reference.slice('layer:'.length).split('/');
          if (parts.length > 3 || parts.some(part => !part)) throw new Error('Invalid layer reference.');
          const layerId = parts.at(-1)!;
          const referencePageId = parts.length > 1 ? parts.at(-2)! : pageId;
          const referenceProjectId = parts.length === 3 ? parts[0] : projectId;
          const project = referenceProjectId === projectId ? initial : await bridge.getProjectById?.(referenceProjectId);
          if (!project) throw new Error('Reference project not found: ' + referenceProjectId);
          const pageLayers = referencePageId === project.activePageId ? project.layers : project.pages?.find(page => page.id === referencePageId)?.layers;
          if (!pageLayers) throw new Error('Reference page not found: ' + referencePageId);
          const content = imageLayer({ ...project, layers: pageLayers }, layerId, false).content;
          if (referenceProjectId === projectId) layers.push({ pageId: referencePageId, layerId, content });
          return loadLayerImage(content, signal);
        }));
        signal.throwIfAborted();
        const validateReferences = (project: ProjectState) => {
          for (const layer of layers) {
            const pageLayers = layer.pageId === project.activePageId ? project.layers : project.pages?.find(page => page.id === layer.pageId)?.layers;
            if (!pageLayers || imageLayer({ ...project, layers: pageLayers }, layer.layerId, false).content !== layer.content) throw new Error('Reference image changed while processing.');
          }
        };
        validateReferences(currentPage(bridge, projectId, pageId));
        return { inputImages, complete: async (result, signal) => {
          return applyImages(bridge, projectId, pageId, result, signal, false, undefined, validateReferences);
        } };
      }
    },
    remove_background: {
      ...IMAGE_TOOL_SCHEMAS.remove_background!,
      prepare: async (args, signal) => {
        const initial = currentProject(bridge);
        const projectId = initial.id;
        const pageId = initial.activePageId;
        if ((args.layerId === undefined) === (args.imageId === undefined)) throw new Error('Provide either layerId or imageId.');
        if (args.keepOriginal !== undefined && typeof args.keepOriginal !== 'boolean') throw new Error('keepOriginal must be a boolean.');
        if (args.layerId === undefined && args.keepOriginal !== undefined) throw new Error('keepOriginal requires layerId.');
        const layerId = args.layerId === undefined ? undefined : text(args.layerId, 'layerId');
        const content = layerId ? imageLayer(initial, layerId, true).content : undefined;
        const inputImage = content ? await loadLayerImage(content, signal) : undefined;
        signal.throwIfAborted();
        const latest = currentPage(bridge, projectId, pageId);
        if (layerId && imageLayer(latest, layerId, true).content !== content) throw new Error('Original image changed while reading.');
        return { inputImage, complete: (result, signal) => applyImages(bridge, projectId, pageId, result, signal, true,
          layerId && content ? { layerId, content, removal: true, keepOriginal: args.keepOriginal !== false } : undefined) };
      }
    }
  };
}
