import type { AiConfig, ChatImageRef, WorkspaceBridge } from '../types.ts';
import { availableImageModels, generateImages, imageCapabilities, imageModelToolId, imageTimeoutSeconds, type ImageQuality } from '../image-generation/index.ts';
import { blobToDataUrl, encodeWebp, IMAGE_FORMATS, imageMimeType } from '../services/imageAttachments.ts';
import { text } from './validation.ts';
import { generateId } from '../../../utils/helpers.ts';

export interface ImageToolContext {
  getConfig: () => AiConfig;
  loadImage: (imageId: string) => Promise<Blob | null>;
  saveImage: (blob: Blob, name: string) => Promise<ChatImageRef>;
  onImage: (image: ChatImageRef) => void;
  bridge: WorkspaceBridge;
  defaultModelConfigId?: string;
}

function currentProject(projectId: string, context: ImageToolContext, pageId?: string) {
  const project = context.bridge.getProject();
  if (!project || project.id !== projectId) throw new Error('The active project changed or is not open. Read get_context and open the target project first.');
  if (pageId !== undefined && project.activePageId !== pageId) throw new Error('The active page changed. Read get_context again.');
  return project;
}

async function placeGeneratedImage(blob: Blob, image: ChatImageRef, projectId: string, pageId: string | undefined, name: string, imageSource: string, imageDescription: string, context: ImageToolContext, signal: AbortSignal) {
  const content = await blobToDataUrl(blob);
  const bitmap = await createImageBitmap(blob);
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  bitmap.close();
  if (!sourceWidth || !sourceHeight || sourceWidth * sourceHeight > 67108864) throw new Error('Generated image has invalid dimensions or exceeds 64 megapixels.');
  signal.throwIfAborted();
  const project = currentProject(projectId, context, pageId);
  const scale = Math.min(1, project.canvasConfig.width / sourceWidth, project.canvasConfig.height / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const layer = {
    id: generateId(), type: 'image' as const, name, content, width, height, imageSource, imageDescription,
    x: Math.round((project.canvasConfig.width - width) / 2), y: Math.round((project.canvasConfig.height - height) / 2),
    visible: true, locked: false, rotation: 0, opacity: 1, ratioLocked: true,
    zIndex: Math.max(0, ...project.layers.map(item => item.zIndex)) + 1
  };
  await context.bridge.commit({ ...project, updatedAt: Date.now(), layers: [...project.layers, layer], selectedLayerId: layer.id });
  return { projectId, pageId, layerId: layer.id, imageId: image.id, x: layer.x, y: layer.y, width, height };
}

async function storedImage(id: string, context: ImageToolContext): Promise<Blob> {
  const blob = await context.loadImage(id);
  if (!blob) throw new Error('Image resource not found in this session.');
  return blob;
}

async function referenceImage(args: Record<string, unknown>, context: ImageToolContext, signal: AbortSignal): Promise<string | undefined> {
  if (args.referenceImageId !== undefined && args.referenceLayerId !== undefined) throw new Error('Only one reference image is supported.');
  if (args.referenceImageId !== undefined) return blobToDataUrl(await storedImage(text(args.referenceImageId, 'referenceImageId'), context));
  if (args.referenceLayerId === undefined) return undefined;
  const project = context.bridge.getProject();
  if (!project || project.id !== text(args.projectId, 'projectId')) throw new Error('The active project changed. Read get_context again.');
  const layer = project.layers.find(item => item.id === text(args.referenceLayerId, 'referenceLayerId'));
  if (!layer || layer.type !== 'image') throw new Error('Reference must be an existing image layer.');
  let blob: Blob;
  if (/^data:image\/(png|jpeg|webp|gif);base64,/.test(layer.content)) {
    const response = await fetch(layer.content, { signal });
    blob = await response.blob();
  } else {
    const url = new URL(layer.content);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Reference layer must contain an embedded image or HTTPS image URL.');
    const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Unable to download the reference layer image.');
    blob = await response.blob();
  }
  signal.throwIfAborted();
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(blob.type)) throw new Error('Unsupported reference image format.');
  return blobToDataUrl(await encodeWebp(blob, Infinity, 0.95));
}

export async function executeImageTool(name: string, args: Record<string, unknown>, context: ImageToolContext, signal: AbortSignal): Promise<{ value: unknown; image?: ChatImageRef }> {
  signal.throwIfAborted();
  const fields: Record<string, string[]> = {
    list_image_models: [],
    generate_image: ['modelConfigId', 'prompt', 'size', 'ratio', 'quality', 'referenceImageId', 'referenceLayerId', 'projectId']
  };
  if (!fields[name] || Object.keys(args).some(field => !fields[name].includes(field))) throw new Error('Unsupported image tool or parameter.');
  const models = availableImageModels(context.getConfig());
  if (name === 'list_image_models') return { value: {
    models: models.map(model => {
      const { sizePattern, sizeDescription, ...capabilities } = imageCapabilities(model);
      return {
        id: imageModelToolId(model), label: model.label, description: model.description,
        version: model.version?.trim() || null, releasedAt: model.releasedAt || null, timeoutSeconds: imageTimeoutSeconds(model),
        defaultSize: model.size, ...capabilities,
        ...(capabilities.ratios ? { defaultRatio: model.ratio } : {}),
        ...(capabilities.qualities ? { defaultQuality: model.quality ?? 'high' } : {})
      };
    })
  } };
  if (name === 'generate_image') {
    const projectId = text(args.projectId, 'projectId');
    const pageId = currentProject(projectId, context).activePageId;
    const modelConfigId = args.modelConfigId === undefined
      ? context.defaultModelConfigId ?? (models.length === 1 ? imageModelToolId(models[0]) : '')
      : text(args.modelConfigId, 'modelConfigId');
    const matches = models.filter(model => imageModelToolId(model) === modelConfigId);
    if (matches.length !== 1) throw new Error('Image model is disabled, unavailable or ambiguous. Read list_image_models when multiple models are enabled.');
    const model = matches[0];
    const reference = await referenceImage(args, context, signal);
    currentProject(projectId, context, pageId);
    const sources = await generateImages(context.getConfig(), {
      modelConfigId: model.id, prompt: text(args.prompt, 'prompt'),
      ...(args.size !== undefined ? { size: text(args.size, 'size') } : {}),
      ...(args.ratio !== undefined ? { ratio: text(args.ratio, 'ratio') } : {}),
      ...(args.quality !== undefined ? { quality: text(args.quality, 'quality') as ImageQuality } : {})
    }, signal, reference);
    signal.throwIfAborted();
    const saved: { source: Blob; image: ChatImageRef }[] = [];
    for (const [index, source] of sources.entries()) {
      const extension = IMAGE_FORMATS[imageMimeType(source.type)];
      const image = await context.saveImage(source, `generated-${Date.now()}-${index + 1}.${extension}`);
      saved.push({ source, image });
      context.onImage(image);
    }
    try {
      const placements = [];
      for (const { source, image } of saved) placements.push(await placeGeneratedImage(source, image, projectId, pageId, model.label, model.modelId, text(args.prompt, 'prompt'), context, signal));
      return { value: placements.length === 1 ? placements[0] : { projectId, images: placements }, image: saved[0].image };
    } catch (error) {
      throw new Error(`Image ${saved.map(item => item.image.id).join(', ')} was generated and saved, but placement failed: ${error instanceof Error ? error.message : 'Unknown error'}.`);
    }
  }
  throw new Error('Unknown image tool.');
}