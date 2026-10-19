import { ImageCrop, ImageFilters, Layer } from '../types.ts';

export const DEFAULT_IMAGE_FILTERS: ImageFilters = {
  brightness: 100,
  contrast: 100,
  grayscale: 0,
  blur: 0,
};

export const DEFAULT_IMAGE_CROP: ImageCrop = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export const normalizeImageFilters = (filters?: Partial<ImageFilters>): ImageFilters => ({
  brightness: clamp(filters?.brightness ?? DEFAULT_IMAGE_FILTERS.brightness, 0, 200),
  contrast: clamp(filters?.contrast ?? DEFAULT_IMAGE_FILTERS.contrast, 0, 200),
  grayscale: clamp(filters?.grayscale ?? DEFAULT_IMAGE_FILTERS.grayscale, 0, 100),
  blur: clamp(filters?.blur ?? DEFAULT_IMAGE_FILTERS.blur, 0, 50),
});

export const hasActiveImageFilters = (filters?: Partial<ImageFilters>): boolean => {
  if (!filters) return false;
  const f = normalizeImageFilters(filters);
  return (
    Math.abs(f.brightness - 100) > 0.01 ||
    Math.abs(f.contrast - 100) > 0.01 ||
    Math.abs(f.grayscale) > 0.01 ||
    Math.abs(f.blur) > 0.01
  );
};

export const buildImageFilterCss = (filters?: Partial<ImageFilters>): string | undefined => {
  if (!hasActiveImageFilters(filters)) return undefined;
  const f = normalizeImageFilters(filters);
  const parts: string[] = [];
  if (Math.abs(f.brightness - 100) > 0.01) parts.push(`brightness(${Math.round(f.brightness)}%)`);
  if (Math.abs(f.contrast - 100) > 0.01) parts.push(`contrast(${Math.round(f.contrast)}%)`);
  if (Math.abs(f.grayscale) > 0.01) parts.push(`grayscale(${Math.round(f.grayscale)}%)`);
  if (Math.abs(f.blur) > 0.01) parts.push(`blur(${Number(f.blur.toFixed(1))}px)`);
  return parts.length > 0 ? parts.join(' ') : undefined;
};

export const normalizeImageCrop = (crop?: Partial<ImageCrop>): ImageCrop => {
  const width = clamp(crop?.width ?? 100, 1, 100);
  const height = clamp(crop?.height ?? 100, 1, 100);
  const x = clamp(crop?.x ?? 0, 0, 100 - width);
  const y = clamp(crop?.y ?? 0, 0, 100 - height);
  return {
    x: Number(x.toFixed(3)),
    y: Number(y.toFixed(3)),
    width: Number(width.toFixed(3)),
    height: Number(height.toFixed(3)),
  };
};

export const hasActiveImageCrop = (crop?: Partial<ImageCrop>): boolean => {
  if (!crop) return false;
  const c = normalizeImageCrop(crop);
  return (
    c.x > 0.05 ||
    c.y > 0.05 ||
    c.width < 99.95 ||
    c.height < 99.95
  );
};

export const buildFlipTransform = (flipX?: boolean, flipY?: boolean): string | undefined => {
  if (!flipX && !flipY) return undefined;
  return `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`;
};

/**
 * Toggles horizontal or vertical flip on an image layer while keeping any active
 * non-destructive crop anchored to the same visual sub-region of the image.
 */
export const computeLayerFlipUpdates = (
  layer: Pick<Layer, 'flipX' | 'flipY' | 'imageCrop'>,
  axis: 'horizontal' | 'vertical'
): Partial<Layer> => {
  const nextFlipX = axis === 'horizontal' ? !layer.flipX : Boolean(layer.flipX);
  const nextFlipY = axis === 'vertical' ? !layer.flipY : Boolean(layer.flipY);
  const updates: Partial<Layer> = {
    flipX: nextFlipX,
    flipY: nextFlipY,
  };

  if (hasActiveImageCrop(layer.imageCrop)) {
    const c = normalizeImageCrop(layer.imageCrop);
    updates.imageCrop = normalizeImageCrop({
      ...c,
      x: axis === 'horizontal' ? 100 - c.x - c.width : c.x,
      y: axis === 'vertical' ? 100 - c.y - c.height : c.y,
    });
  }

  return updates;
};

/**
 * Computes the updated layer position & dimensions when applying or resetting
 * a non-destructive crop, preserving the layer's center and visual scale.
 */
export const computeCroppedLayerGeometry = (
  layer: Pick<Layer, 'x' | 'y' | 'width' | 'height' | 'imageCrop'>,
  nextCrop: ImageCrop
): Pick<Layer, 'x' | 'y' | 'width' | 'height' | 'imageCrop'> => {
  const prevCrop = normalizeImageCrop(layer.imageCrop);
  const normalizedNext = normalizeImageCrop(nextCrop);

  // Estimate full uncropped layer dimensions from current layer box and previous crop
  const fullWidth = Math.max(10, layer.width / (prevCrop.width / 100));
  const fullHeight = Math.max(10, layer.height / (prevCrop.height / 100));

  const nextWidth = Math.max(10, Math.round(fullWidth * (normalizedNext.width / 100)));
  const nextHeight = Math.max(10, Math.round(fullHeight * (normalizedNext.height / 100)));

  const centerX = layer.x + layer.width / 2;
  const centerY = layer.y + layer.height / 2;

  return {
    x: Math.round(centerX - nextWidth / 2),
    y: Math.round(centerY - nextHeight / 2),
    width: nextWidth,
    height: nextHeight,
    imageCrop: hasActiveImageCrop(normalizedNext) ? normalizedNext : undefined,
  };
};
