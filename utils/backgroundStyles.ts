import type { CSSProperties } from 'react';
import { BackgroundConfig } from '../types.ts';
import { backgroundCssStyle } from './customContent.ts';

export type BackgroundStyleOptions = {
  patternScale?: number;
};

// 生成背景样式（含叠加纹理），用于画布与预览。
export const buildBackgroundStyles = (
  bg: BackgroundConfig,
  options: BackgroundStyleOptions = {}
): CSSProperties => {
  const styles: CSSProperties = {};
  let baseBackground = '';

  if (bg.type === 'color') {
    styles.backgroundColor = bg.value;
  } else if (bg.type === 'gradient') {
    baseBackground = bg.value;
  } else if (bg.type === 'image') {
    baseBackground = `url(${bg.value})`;
    styles.backgroundSize = 'cover';
    styles.backgroundPosition = 'center';
  } else if (bg.type === 'css') {
    Object.assign(styles, backgroundCssStyle(bg.value));
  }

  const patternImages: string[] = [];
  let patternSize = '';
  if (bg.type !== 'css' && bg.overlayType !== 'none') {
    const rgba = bg.overlayColor.startsWith('#')
      ? `${bg.overlayColor}${Math.round(bg.overlayOpacity * 255)
          .toString(16)
          .padStart(2, '0')}`
      : bg.overlayColor;
    const scale = Math.max(20, bg.overlayScale ?? 20);

    if (bg.overlayType === 'dots') {
      patternImages.push(`radial-gradient(${rgba} 2px, transparent 2px)`);
    } else if (bg.overlayType === 'grid') {
      const line = 0.5 * (options.patternScale ?? 1);
      const edge = options.patternScale ?? 1;
      patternImages.push(
        `linear-gradient(${rgba} ${line}px, transparent ${edge}px)`,
        `linear-gradient(90deg, ${rgba} ${line}px, transparent ${edge}px)`
      );
    } else if (bg.overlayType === 'stripes') {
      patternImages.push(`repeating-linear-gradient(45deg, ${rgba}, ${rgba} 2px, transparent 2px, transparent ${scale / 2}px)`);
    }

    const size = scale * (options.patternScale ?? 1);
    patternSize = `${size}px ${size}px`;
  }

  const backgroundImages: string[] = [];
  const backgroundSizes: string[] = [];

  for (const patternImage of patternImages) {
    backgroundImages.push(patternImage);
    backgroundSizes.push(patternSize);
  }

  if (baseBackground) {
    backgroundImages.push(baseBackground);
    backgroundSizes.push(bg.type === 'image' ? 'cover' : '100% 100%');
  }

  if (backgroundImages.length > 0) {
    if (bg.type === 'css' && styles.backgroundImage) {
      backgroundImages.push(styles.backgroundImage);
      backgroundSizes.push(String(styles.backgroundSize || 'auto'));
    }
    styles.backgroundImage = backgroundImages.join(', ');
    styles.backgroundSize = backgroundSizes.join(', ');
  }

  return styles;
};
