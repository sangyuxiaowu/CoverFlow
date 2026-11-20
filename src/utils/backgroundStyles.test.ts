import { describe, expect, it, vi } from 'vitest';
import { Blob } from 'node:buffer';
import type { BackgroundConfig } from '../types.ts';
import { buildBackgroundStyles } from './backgroundStyles.ts';
import { imageAssets } from '../storage/imageAssets.ts';

const background: BackgroundConfig = {
  type: 'gradient',
  value: 'linear-gradient(135deg, #17202a, #345)',
  overlayType: 'grid',
  overlayColor: '#ffffff',
  overlayOpacity: 0.08,
  overlayScale: 40
};

describe('background textures', () => {
  it('assigns each grid layer its own tile size before the base gradient', () => {
    expect(buildBackgroundStyles(background).backgroundSize).toBe('40px 40px, 40px 40px, 100% 100%');
  });

  it('keeps both grid axes at the same scale in thumbnails', () => {
    expect(buildBackgroundStyles(background, { patternScale: 0.2 }).backgroundSize).toBe('8px 8px, 8px 8px, 100% 100%');
  });

  it('preserves image sizing beneath the grid', () => {
    expect(buildBackgroundStyles({ ...background, type: 'image', value: 'data:image/png;base64,AA==' }).backgroundSize).toBe('40px 40px, 40px 40px, cover');
  });

  it('resolves binary backgrounds through one owned object URL', async () => {
    const owner = imageAssets.createOwner();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:background');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      const reference = await imageAssets.add(owner, new Blob(['image'], { type: 'image/png' }) as globalThis.Blob);
      const styles = buildBackgroundStyles({ ...background, type: 'image', value: reference });
      expect(styles.backgroundImage).toContain('url(blob:background)');
      expect(create).toHaveBeenCalledOnce();
      imageAssets.release(owner);
      expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:background');
    } finally { imageAssets.release(owner); create.mockRestore(); revoke.mockRestore(); }
  });

  it('leaves untextured backgrounds unchanged', () => {
    const styles = buildBackgroundStyles({ ...background, overlayType: 'none' });
    expect(styles.backgroundImage).toBe(background.value);
    expect(styles.backgroundSize).toBe('100% 100%');
  });

  it('scales fine grid strokes with thumbnail spacing', () => {
    expect(buildBackgroundStyles(background, { patternScale: 0.2 }).backgroundImage).toContain('#ffffff14 0.1px, transparent 0.2px');
  });

  it.each(['dots', 'grid', 'stripes'] as const)('enforces a 20px minimum for %s before thumbnail scaling', (overlayType) => {
    const config = { ...background, overlayType, overlayScale: 5 };
    expect(buildBackgroundStyles(config).backgroundSize).toContain('20px 20px');
    expect(buildBackgroundStyles(config, { patternScale: 0.2 }).backgroundSize).toContain('4px 4px');
  });

  it.each([1, 0.2])('preserves dots and stripes at preview scale %s', (patternScale) => {
    expect(buildBackgroundStyles({ ...background, overlayType: 'dots' }, { patternScale }).backgroundImage)
      .toBe(`radial-gradient(#ffffff14 2px, transparent 2px), ${background.value}`);
    expect(buildBackgroundStyles({ ...background, overlayType: 'stripes' }, { patternScale }).backgroundImage)
      .toBe(`repeating-linear-gradient(45deg, #ffffff14, #ffffff14 2px, transparent 2px, transparent 20px), ${background.value}`);
  });
});