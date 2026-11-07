import type { Layer } from '../../../types.ts';
import { type AssetEntry, findAsset, folderAssets } from '../../../storage/assets.ts';
import { generateId, normalizeSVG } from '../../../utils/helpers.ts';
import type { WorkspaceBridge } from '../types.ts';
import { blobToDataUrl } from '../services/imageAttachments.ts';
import { choice, number, record, text, validateContent } from './validation.ts';

function fields(args: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) throw new Error('Unsupported asset parameter: ' + key);
  }
}

function pageNumber(value: unknown, field: string, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  const result = number(value, field, 1, maximum);
  if (!Number.isSafeInteger(result)) throw new Error('Invalid ' + field);
  return result;
}

function activeProject(bridge: WorkspaceBridge, projectId: string, pageId?: string) {
  const project = bridge.getProject();
  if (!project || project.id !== projectId) throw new Error('The active project changed or is not open. Read get_context again.');
  if (pageId !== undefined && project.activePageId !== pageId) throw new Error('The active page changed. Read get_context again.');
  return project;
}

export async function executeAssetTool(name: 'search_assets' | 'place_asset', input: unknown, bridge: WorkspaceBridge, signal: AbortSignal) {
  signal.throwIfAborted();
  const args = record(input);
  if (name === 'search_assets') {
    fields(args, ['query', 'type', 'page', 'pageSize']);
    if (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 1000)) throw new Error('Invalid query');
    const query = ((args.query ?? '') as string).trim().toLowerCase();
    const type = args.type === undefined ? undefined : choice(args.type, 'type', ['svg', 'image']);
    const page = pageNumber(args.page, 'page', 1, 1000000);
    const pageSize = pageNumber(args.pageSize, 'pageSize', 20, 50);
    const entries: AssetEntry[] = [];
    let folder: { status: string; message?: string };
    try {
      const directory = await bridge.getAssetFolder?.();
      signal.throwIfAborted();
      if (directory) entries.push(...await folderAssets(directory));
      folder = { status: directory ? 'ready' : 'not_configured' };
    } catch (error) {
      signal.throwIfAborted();
      folder = { status: 'unavailable', message: error instanceof Error ? error.message : 'Asset folder could not be read.' };
    }
    signal.throwIfAborted();
    const matches = entries.filter(entry => (!type || entry.type === type) && (!query || [entry.name, entry.assetId, entry.category, entry.categoryZh].join(' ').toLowerCase().includes(query)));
    const items = matches.slice((page - 1) * pageSize, page * pageSize).map(({ fileHandle, ...entry }) => entry);
    return { items, total: matches.length, page, pageSize, hasMore: page * pageSize < matches.length, folder };
  }

  fields(args, ['projectId', 'assetId', 'x', 'y', 'width', 'height']);
  const projectId = text(args.projectId, 'projectId');
  const assetId = text(args.assetId, 'assetId');
  const x = args.x === undefined ? undefined : number(args.x, 'x');
  const y = args.y === undefined ? undefined : number(args.y, 'y');
  const requestedWidth = args.width === undefined ? undefined : number(args.width, 'width', 1, 100000);
  const requestedHeight = args.height === undefined ? undefined : number(args.height, 'height', 1, 100000);
  const pageId = activeProject(bridge, projectId).activePageId;
  if (!assetId.startsWith('folder:')) throw new Error('Invalid assetId. Use an ID from search_assets.');
  const directory = await bridge.getAssetFolder?.();
  signal.throwIfAborted();
  const entry = await findAsset(assetId, directory ?? null);
  signal.throwIfAborted();
  let content: string;
  let sourceWidth: number;
  let sourceHeight: number;
  if (entry.type === 'svg') {
    const file = await entry.fileHandle.getFile();
    if (file.size > 2 * 1024 * 1024) throw new Error('SVG asset exceeds 2 MB.');
    content = await file.text();
    if (!content.trim()) throw new Error('SVG asset is empty.');
    content = validateContent('svg', normalizeSVG(content));
    const svg = new DOMParser().parseFromString(content, 'image/svg+xml').documentElement;
    const viewBox = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
    sourceWidth = viewBox[2];
    sourceHeight = viewBox[3];
  } else {
    const file = await entry.fileHandle.getFile();
    if (file.size > 32 * 1024 * 1024) throw new Error('Image asset exceeds 32 MB.');
    const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => signature[index] === byte)) throw new Error('Image asset must contain a PNG.');
    const blob = file.slice(0, file.size, 'image/png');
    const bitmap = await createImageBitmap(blob);
    sourceWidth = bitmap.width;
    sourceHeight = bitmap.height;
    bitmap.close();
    if (sourceWidth * sourceHeight > 67108864) throw new Error('Image asset exceeds 64 megapixels.');
    content = await blobToDataUrl(blob);
  }
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) throw new Error('Asset has invalid dimensions.');
  signal.throwIfAborted();
  const project = activeProject(bridge, projectId, pageId);
  if (requestedWidth !== undefined && requestedHeight !== undefined && Math.abs(requestedWidth / sourceWidth * sourceHeight - requestedHeight) > 1) {
    throw new Error('width and height must preserve the asset aspect ratio. Provide only one dimension to scale automatically.');
  }
  const scale = requestedWidth !== undefined ? requestedWidth / sourceWidth
    : requestedHeight !== undefined ? requestedHeight / sourceHeight
      : Math.min(1, 300 / sourceWidth, 300 / sourceHeight, project.canvasConfig.width / sourceWidth, project.canvasConfig.height / sourceHeight);
  const width = Math.max(1, sourceWidth * scale);
  const height = Math.max(1, sourceHeight * scale);
  const layer: Layer = {
    id: generateId(), name: entry.name, type: entry.type, content,
    x: x ?? (project.canvasConfig.width - width) / 2,
    y: y ?? (project.canvasConfig.height - height) / 2,
    width, height, rotation: 0, opacity: 1, visible: true, locked: false, ratioLocked: true,
    zIndex: Math.max(0, ...project.layers.map(item => item.zIndex)) + 1,
    ...(entry.type === 'image' ? { imageSource: assetId, imageDescription: entry.name } : {})
  };
  await bridge.commit({ ...project, layers: [...project.layers, layer], selectedLayerId: layer.id, updatedAt: Date.now() });
  return { success: true, projectId, pageId, assetId, layerId: layer.id, type: layer.type, x: layer.x, y: layer.y, width, height };
}