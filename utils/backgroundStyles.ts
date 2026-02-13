import type { CSSProperties } from 'react';
import { BackgroundConfig } from '../types.ts';

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
  }

  let patternImage = '';
  let patternSize = '';
  if (bg.overlayType !== 'none') {
    const rgba = bg.overlayColor.startsWith('#')
      ? `${bg.overlayColor}${Math.round(bg.overlayOpacity * 255)
          .toString(16)
          .padStart(2, '0')}`
      : bg.overlayColor;
    const scale = bg.overlayScale ?? 20;

    if (bg.overlayType === 'dots') {
      patternImage = `radial-gradient(${rgba} 2px, transparent 2px)`;
    } else if (bg.overlayType === 'grid') {
      patternImage = `linear-gradient(${rgba} 1px, transparent 1px), linear-gradient(90deg, ${rgba} 1px, transparent 1px)`;
    } else if (bg.overlayType === 'stripes') {
      patternImage = `repeating-linear-gradient(45deg, ${rgba}, ${rgba} 2px, transparent 2px, transparent ${scale / 2}px)`;
    }

    const size = scale * (options.patternScale ?? 1);
    patternSize = `${size}px ${size}px`;
  }

  const backgroundImages: string[] = [];
  const backgroundSizes: string[] = [];

  if (patternImage) {
    backgroundImages.push(patternImage);
    backgroundSizes.push(patternSize);
  }

  if (baseBackground) {
    backgroundImages.push(baseBackground);
    backgroundSizes.push(bg.type === 'image' ? 'cover' : '100% 100%');
  }

  if (backgroundImages.length > 0) {
    styles.backgroundImage = backgroundImages.join(', ');
    styles.backgroundSize = backgroundSizes.join(', ');
  }

  return styles;
};
