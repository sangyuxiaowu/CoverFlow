import type { AiConfig, ChatImageRef, WorkspaceBridge } from '../types.ts';
import { AGNES_SIZES, availableImageModels, DEFAULT_REFERENCE_IMAGE_PROMPT, DEFAULT_TEXT_IMAGE_PROMPT, generateImage, imageModelToolId, IMAGE_RATIOS, KOLORS_SIZES } from '../services/imageGeneration.ts';
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

function currentProject(projectId: string, context: ImageToolContext) {
  const project = context.bridge.getProject();
  if (!project || project.id !== projectId) throw new Error('The active project changed or is not open. Read get_context and open the target project first.');
  return project;
}

async function placeGeneratedImage(blob: Blob, image: ChatImageRef, projectId: string, name: string, imageSource: string, imageDescription: string, context: ImageToolContext, signal: AbortSignal) {
  const content = await blobToDataUrl(blob);
  const bitmap = await createImageBitmap(blob);
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  bitmap.close();
  if (!sourceWidth || !sourceHeight || sourceWidth * sourceHeight > 67108864) throw new Error('Generated image has invalid dimensions or exceeds 64 megapixels.');
  signal.throwIfAborted();
  const project = currentProject(projectId, context);
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
  return { projectId, layerId: layer.id, imageId: image.id, x: layer.x, y: layer.y, width, height };
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
    generate_image: ['modelConfigId', 'prompt', 'size', 'ratio', 'referenceImageId', 'referenceLayerId', 'projectId']
  };
  if (!fields[name] || Object.keys(args).some(field => !fields[name].includes(field))) throw new Error('Unsupported image tool or parameter.');
  const models = availableImageModels(context.getConfig());
  if (name === 'list_image_models') return { value: {
    models: models.map(model => ({
      id: imageModelToolId(model), label: model.label, description: model.description, modes: ['text_to_image', 'single_reference'],
      ...(models.length > 1 ? {
        textPromptDescription: model.textPromptDescription ?? DEFAULT_TEXT_IMAGE_PROMPT,
        referencePromptDescription: model.referencePromptDescription ?? DEFAULT_REFERENCE_IMAGE_PROMPT
      } : {}),
      defaultSize: model.size, sizes: model.adapter === 'kolors' ? KOLORS_SIZES : AGNES_SIZES,
      ...(model.adapter === 'agnes' ? { ratios: IMAGE_RATIOS, defaultRatio: model.ratio, exactSizeSupported: true } : {})
    }))
  } };
  if (name === 'generate_image') {
    const projectId = text(args.projectId, 'projectId');
    currentProject(projectId, context);
    const modelConfigId = args.modelConfigId === undefined
      ? context.defaultModelConfigId ?? (models.length === 1 ? imageModelToolId(models[0]) : '')
      : text(args.modelConfigId, 'modelConfigId');
    const matches = models.filter(model => imageModelToolId(model) === modelConfigId);
    if (matches.length !== 1) throw new Error('Image model is disabled, unavailable or ambiguous. Read list_image_models when multiple models are enabled.');
    const model = matches[0];
    const reference = await referenceImage(args, context, signal);
    currentProject(projectId, context);
    const source = await generateImage(context.getConfig(), {
      modelConfigId: model.id, prompt: text(args.prompt, 'prompt'),
      ...(args.size !== undefined ? { size: text(args.size, 'size') } : {}),
      ...(args.ratio !== undefined ? { ratio: text(args.ratio, 'ratio') } : {})
    }, signal, reference);
    signal.throwIfAborted();
    const extension = IMAGE_FORMATS[imageMimeType(source.type)];
    const image = await context.saveImage(source, `generated-${Date.now()}.${extension}`);
    context.onImage(image);
    try {
      return { value: await placeGeneratedImage(source, image, projectId, model.label, model.modelId, text(args.prompt, 'prompt'), context, signal), image };
    } catch (error) {
      throw new Error(`Image ${image.id} was generated and saved, but placement failed: ${error instanceof Error ? error.message : 'Unknown error'}. Do not regenerate; the saved image remains in this session.`);
    }
  }
  throw new Error('Unknown image tool.');
}