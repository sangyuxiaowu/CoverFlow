import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_CROP,
  DEFAULT_IMAGE_FILTERS,
  buildFlipTransform,
  buildImageFilterCss,
  computeCroppedLayerGeometry,
  computeLayerFlipUpdates,
  hasActiveImageCrop,
  hasActiveImageFilters,
  normalizeImageCrop,
  normalizeImageFilters,
} from './imageLayer.ts';
import { buildProjectSvg } from './svgExport.ts';
import type { ProjectState } from '../types.ts';

describe('imageLayer utilities', () => {
  it('normalizes and formats image filters into CSS filter strings', () => {
    expect(hasActiveImageFilters(undefined)).toBe(false);
    expect(hasActiveImageFilters(DEFAULT_IMAGE_FILTERS)).toBe(false);
    expect(buildImageFilterCss(DEFAULT_IMAGE_FILTERS)).toBeUndefined();

    const custom = normalizeImageFilters({
      brightness: 125,
      contrast: 85,
      grayscale: 40,
      blur: 3.5,
    });
    expect(hasActiveImageFilters(custom)).toBe(true);
    expect(buildImageFilterCss(custom)).toBe(
      'brightness(125%) contrast(85%) grayscale(40%) blur(3.5px)'
    );
  });

  it('normalizes and detects non-destructive image crop regions', () => {
    expect(hasActiveImageCrop(undefined)).toBe(false);
    expect(hasActiveImageCrop(DEFAULT_IMAGE_CROP)).toBe(false);

    const crop = normalizeImageCrop({ x: 15, y: 20, width: 50, height: 60 });
    expect(hasActiveImageCrop(crop)).toBe(true);
    expect(crop).toEqual({ x: 15, y: 20, width: 50, height: 60 });

    // Clamps out-of-bounds crop regions safely
    const clamped = normalizeImageCrop({ x: 80, y: 90, width: 50, height: 40 });
    expect(clamped).toEqual({ x: 50, y: 60, width: 50, height: 40 });
  });

  it('computes non-destructive cropped layer geometry while preserving center', () => {
    const baseLayer = {
      x: 100,
      y: 50,
      width: 400,
      height: 300,
    };
    const cropped = computeCroppedLayerGeometry(baseLayer, {
      x: 25,
      y: 10,
      width: 50,
      height: 50,
    });
    expect(cropped.width).toBe(200);
    expect(cropped.height).toBe(150);
    expect(cropped.x + cropped.width / 2).toBe(baseLayer.x + baseLayer.width / 2);
    expect(cropped.y + cropped.height / 2).toBe(baseLayer.y + baseLayer.height / 2);
    expect(cropped.imageCrop).toEqual({ x: 25, y: 10, width: 50, height: 50 });

    // Restoring crop to full 100x100 restores original dimensions and clears imageCrop
    const restored = computeCroppedLayerGeometry(cropped, DEFAULT_IMAGE_CROP);
    expect(restored.width).toBe(400);
    expect(restored.height).toBe(300);
    expect(restored.imageCrop).toBeUndefined();
  });

  it('toggles horizontal and vertical flips and mirrors active crop coordinates', () => {
    expect(buildFlipTransform(false, false)).toBeUndefined();
    expect(buildFlipTransform(true, false)).toBe('scale(-1, 1)');
    expect(buildFlipTransform(false, true)).toBe('scale(1, -1)');
    expect(buildFlipTransform(true, true)).toBe('scale(-1, -1)');

    const layer = {
      flipX: false,
      flipY: false,
      imageCrop: { x: 10, y: 20, width: 30, height: 40 },
    };

    const hFlipped = computeLayerFlipUpdates(layer, 'horizontal');
    expect(hFlipped.flipX).toBe(true);
    expect(hFlipped.flipY).toBe(false);
    expect(hFlipped.imageCrop).toEqual({ x: 60, y: 20, width: 30, height: 40 });

    const vFlipped = computeLayerFlipUpdates(layer, 'vertical');
    expect(vFlipped.flipX).toBe(false);
    expect(vFlipped.flipY).toBe(true);
    expect(vFlipped.imageCrop).toEqual({ x: 10, y: 40, width: 30, height: 40 });
  });

  it('exports SVG with image filters, non-destructive crop clipPath, and flip transforms', () => {
    const project: ProjectState = {
      id: 'p1',
      title: 'Test',
      updatedAt: 1,
      selectedLayerId: null,
      canvasConfig: { width: 800, height: 600, ratio: '4:3' },
      background: {
        type: 'color',
        value: '#000000',
        overlayType: 'none',
        overlayColor: '#ffffff',
        overlayOpacity: 0.1,
        overlayScale: 20,
      },
      layers: [
        {
          id: 'img1',
          name: 'Photo',
          type: 'image',
          content: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          x: 100,
          y: 100,
          width: 200,
          height: 150,
          rotation: 0,
          zIndex: 1,
          visible: true,
          locked: false,
          opacity: 1,
          ratioLocked: true,
          flipX: true,
          flipY: false,
          imageFilters: { brightness: 120, contrast: 110, grayscale: 50, blur: 2 },
          imageCrop: { x: 25, y: 0, width: 50, height: 100 },
        },
      ],
    };

    const svg = buildProjectSvg(project);
    expect(svg).toContain('clipPath id="cf-crop-img1"');
    expect(svg).toContain('filter: brightness(120%) contrast(110%) grayscale(50%) blur(2px);');
    expect(svg).toContain('scale(-1, 1)');
  });
});
