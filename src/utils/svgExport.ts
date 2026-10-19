import { BackgroundConfig, Layer, ProjectState } from '../types.ts';
import { applySvgAspectRatio, normalizeSVG } from './helpers.ts';
import { detectDecorationFormat, sanitizeBackgroundCss, sanitizeDecorationHtml } from './customContent.ts';
import { sanitizeDecorationCss } from './decorationStyles.ts';
import { buildImageFilterCss, hasActiveImageCrop, normalizeImageCrop } from './imageLayer.ts';

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

interface GradientStop {
  color: string;
  opacity?: number;
  offset: string;
}

interface ParsedLinearGradient {
  angle: number;
  stops: GradientStop[];
}

interface ParsedColor {
  color: string;
  opacity?: number;
}

const parseCssColor = (raw: string): ParsedColor => {
  const trimmed = raw.trim();
  const rgbaMatch = trimmed.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*\.?\d+))?\s*\)$/i
  );
  if (rgbaMatch) {
    const r = Math.round(Number(rgbaMatch[1]));
    const g = Math.round(Number(rgbaMatch[2]));
    const b = Math.round(Number(rgbaMatch[3]));
    const a = rgbaMatch[4] !== undefined ? Number(rgbaMatch[4]) : 1;
    return {
      color: `rgb(${r}, ${g}, ${b})`,
      opacity: a < 1 ? Number(a.toFixed(3)) : undefined
    };
  }

  const hex8Match = trimmed.match(/^#([0-9a-f]{6})([0-9a-f]{2})$/i);
  if (hex8Match) {
    const alpha = parseInt(hex8Match[2], 16) / 255;
    return {
      color: `#${hex8Match[1]}`,
      opacity: alpha < 1 ? Number(alpha.toFixed(3)) : undefined
    };
  }

  return { color: trimmed };
};

const splitTopLevelArgs = (input: string, delimiter = ','): string[] => {
  const result: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);

    if (ch === delimiter && depth === 0) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
};

const parseDirectionAngle = (dir: string): number | null => {
  const normalized = dir.trim().toLowerCase().replace(/\s+/g, ' ');
  const degMatch = normalized.match(/^(-?\d+(?:\.\d+)?)deg$/);
  if (degMatch) return Number(degMatch[1]);
  const turnMatch = normalized.match(/^(-?\d+(?:\.\d+)?)turn$/);
  if (turnMatch) return Number(turnMatch[1]) * 360;

  const map: Record<string, number> = {
    'to top': 0,
    'to top right': 45,
    'to right top': 45,
    'to right': 90,
    'to bottom right': 135,
    'to right bottom': 135,
    'to bottom': 180,
    'to bottom left': 225,
    'to left bottom': 225,
    'to left': 270,
    'to top left': 315,
    'to left top': 315
  };
  return normalized in map ? map[normalized] : null;
};

export const parseCssLinearGradient = (value: string): ParsedLinearGradient | null => {
  const trimmed = value.trim();
  const match = trimmed.match(/^linear-gradient\((.*)\)$/i);
  if (!match) return null;

  const parts = splitTopLevelArgs(match[1]);
  if (parts.length < 2) return null;

  let angle = 180;
  let stopStartIndex = 0;
  const maybeAngle = parseDirectionAngle(parts[0]);
  if (maybeAngle !== null) {
    angle = maybeAngle;
    stopStartIndex = 1;
  }

  const rawStops = parts.slice(stopStartIndex);
  if (rawStops.length < 2) return null;

  const stops: GradientStop[] = rawStops.map((stopStr, idx) => {
    const stopTrimmed = stopStr.trim();
    const posMatch = stopTrimmed.match(/^(.*?)\s+(-?\d+(?:\.\d+)?%)$/);
    const rawColor = posMatch ? posMatch[1].trim() : stopTrimmed;
    const offset = posMatch
      ? posMatch[2]
      : `${Math.round((idx / Math.max(1, rawStops.length - 1)) * 100)}%`;
    const parsedColor = parseCssColor(rawColor);
    return {
      color: parsedColor.color,
      opacity: parsedColor.opacity,
      offset
    };
  });

  return { angle, stops };
};

const angleToSvgCoords = (angle: number) => {
  const rad = ((angle - 90) * Math.PI) / 180;
  const vx = Math.cos(rad);
  const vy = Math.sin(rad);
  const scale = Math.max(Math.abs(vx), Math.abs(vy)) || 1;
  const x1 = Math.round((50 - (vx / scale) * 50) * 100) / 100;
  const y1 = Math.round((50 - (vy / scale) * 50) * 100) / 100;
  const x2 = Math.round((50 + (vx / scale) * 50) * 100) / 100;
  const y2 = Math.round((50 + (vy / scale) * 50) * 100) / 100;
  return { x1: `${x1}%`, y1: `${y1}%`, x2: `${x2}%`, y2: `${y2}%` };
};

const buildLinearGradientDef = (id: string, grad: ParsedLinearGradient): string => {
  const coords = angleToSvgCoords(grad.angle);
  const stopsXml = grad.stops
    .map((s) => {
      const opacityAttr = s.opacity !== undefined ? ` stop-opacity="${s.opacity}"` : '';
      return `<stop offset="${escapeXml(s.offset)}" stop-color="${escapeXml(s.color)}"${opacityAttr} />`;
    })
    .join('');
  return `<linearGradient id="${escapeXml(id)}" x1="${coords.x1}" y1="${coords.y1}" x2="${coords.x2}" y2="${coords.y2}">${stopsXml}</linearGradient>`;
};

const buildBackgroundSvg = (
  bg: BackgroundConfig,
  width: number,
  height: number
): { defs: string[]; elements: string[] } => {
  const defs: string[] = [];
  const elements: string[] = [];

  if (bg.type === 'color') {
    const parsed = parseCssColor(bg.value || '#1e293b');
    const opacityAttr = parsed.opacity !== undefined ? ` fill-opacity="${parsed.opacity}"` : '';
    elements.push(`<rect width="${width}" height="${height}" fill="${escapeXml(parsed.color)}"${opacityAttr} />`);
  } else if (bg.type === 'gradient') {
    const parsedGrad = parseCssLinearGradient(bg.value);
    if (parsedGrad) {
      defs.push(buildLinearGradientDef('cf-bg-gradient', parsedGrad));
      elements.push(`<rect width="${width}" height="${height}" fill="url(#cf-bg-gradient)" />`);
    } else {
      elements.push(
        `<foreignObject width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;background:${escapeXml(bg.value)};"></div></foreignObject>`
      );
    }
  } else if (bg.type === 'image' && bg.value) {
    const rawUrl = bg.value.replace(/^url\((['"]?)(.*?)\1\)$/i, '$2');
    elements.push(
      `<image href="${escapeXml(rawUrl)}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" />`
    );
  } else if (bg.type === 'css' && bg.value) {
    const sanitized = sanitizeBackgroundCss(bg.value);
    elements.push(
      `<foreignObject width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;${escapeXml(sanitized.source)}"></div></foreignObject>`
    );
  } else {
    elements.push(`<rect width="${width}" height="${height}" fill="#1e293b" />`);
  }

  if (bg.type !== 'css' && bg.overlayType && bg.overlayType !== 'none') {
    const scale = Math.max(20, bg.overlayScale ?? 20);
    const parsedOverlay = parseCssColor(bg.overlayColor || '#ffffff');
    const opacity = Math.min(1, Math.max(0, bg.overlayOpacity ?? 0.1));
    const patternId = 'cf-bg-overlay-pattern';

    if (bg.overlayType === 'dots') {
      defs.push(
        `<pattern id="${patternId}" width="${scale}" height="${scale}" patternUnits="userSpaceOnUse">` +
          `<circle cx="${scale / 2}" cy="${scale / 2}" r="2" fill="${escapeXml(parsedOverlay.color)}" fill-opacity="${opacity}" />` +
          `</pattern>`
      );
      elements.push(`<rect width="${width}" height="${height}" fill="url(#${patternId})" />`);
    } else if (bg.overlayType === 'grid') {
      defs.push(
        `<pattern id="${patternId}" width="${scale}" height="${scale}" patternUnits="userSpaceOnUse">` +
          `<path d="M ${scale} 0 L 0 0 0 ${scale}" fill="none" stroke="${escapeXml(parsedOverlay.color)}" stroke-opacity="${opacity}" stroke-width="1" />` +
          `</pattern>`
      );
      elements.push(`<rect width="${width}" height="${height}" fill="url(#${patternId})" />`);
    } else if (bg.overlayType === 'stripes') {
      const stripeStep = scale / 2;
      defs.push(
        `<pattern id="${patternId}" width="${stripeStep}" height="${stripeStep}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
          `<rect x="0" y="0" width="2" height="${stripeStep}" fill="${escapeXml(parsedOverlay.color)}" fill-opacity="${opacity}" />` +
          `</pattern>`
      );
      elements.push(`<rect width="${width}" height="${height}" fill="url(#${patternId})" />`);
    }
  }

  return { defs, elements };
};

const buildSvgLayerMarkup = (layer: Layer): string => {
  const rawSvg = applySvgAspectRatio(normalizeSVG(layer.content), Boolean(layer.ratioLocked));
  const layerColor = layer.color || '#ffffff';

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    const parserError = doc.querySelector('parsererror');

    if (svgEl && !parserError) {
      svgEl.setAttribute('x', '0');
      svgEl.setAttribute('y', '0');
      svgEl.setAttribute('width', `${layer.width}`);
      svgEl.setAttribute('height', `${layer.height}`);
      if (!svgEl.getAttribute('viewBox')) {
        svgEl.setAttribute('viewBox', '0 0 100 100');
      }
      svgEl.setAttribute(
        'preserveAspectRatio',
        layer.ratioLocked ? svgEl.getAttribute('preserveAspectRatio') || 'xMidYMid meet' : 'none'
      );
      svgEl.setAttribute('color', layerColor);

      const styleAttr = svgEl.getAttribute('style') || '';
      const cleanedStyle = styleAttr
        .replace(/(?:^|;)\s*(?:width|height|display)\s*:[^;]+/gi, '')
        .trim();
      if (cleanedStyle) {
        svgEl.setAttribute('style', `${cleanedStyle}; color: ${layerColor};`);
      } else {
        svgEl.setAttribute('style', `color: ${layerColor};`);
      }

      const serialized = new XMLSerializer().serializeToString(svgEl);
      return serialized.replace(/currentColor/gi, layerColor);
    }
  } catch {
    // Fall back to string replacement below
  }

  const inner = rawSvg
    .replace(/^[\s\S]*?<svg[^>]*>/i, '')
    .replace(/<\/svg>[\s\S]*$/i, '')
    .replace(/currentColor/gi, layerColor);
  const viewBoxMatch = rawSvg.match(/viewBox=(["'])(.*?)\1/i);
  const viewBox = viewBoxMatch ? viewBoxMatch[2] : '0 0 100 100';
  const par = layer.ratioLocked ? 'xMidYMid meet' : 'none';

  return `<svg x="0" y="0" width="${layer.width}" height="${layer.height}" viewBox="${escapeXml(viewBox)}" preserveAspectRatio="${par}" color="${escapeXml(layerColor)}">${inner}</svg>`;
};

const buildForeignObject = (layer: Layer, element: HTMLDivElement): string => {
  const markup = new XMLSerializer().serializeToString(element);
  return `<foreignObject x="0" y="0" width="${layer.width}" height="${layer.height}" overflow="visible">${markup}</foreignObject>`;
};

const buildTextLayerSvg = (layer: Layer): string => {
  const element = document.createElement('div');
  const align = layer.textAlign || 'center';
  element.style.cssText = 'box-sizing:border-box;width:100%;height:100%;display:flex;align-items:center;word-break:break-word;line-height:1.1;padding:0 16px;';
  Object.assign(element.style, {
    fontSize: `${layer.fontSize || Math.max(12, layer.height * 0.7)}px`,
    fontFamily: layer.fontFamily || 'Inter, sans-serif',
    fontWeight: String(layer.fontWeight || 'bold'),
    justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
    textAlign: align,
    color: layer.color || '#ffffff'
  });
  if (layer.writingMode === 'vertical') {
    Object.assign(element.style, { writingMode: 'vertical-rl', textOrientation: 'upright', padding: '16px 0' });
  }
  if (layer.textGradient?.enabled) {
    Object.assign(element.style, {
      backgroundImage: `linear-gradient(${layer.textGradient.angle}deg, ${layer.textGradient.from}, ${layer.textGradient.to})`,
      WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', color: 'transparent'
    });
  }
  if (layer.textShadow?.enabled) {
    const shadow = layer.textShadow;
    element.style.textShadow = `${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.color}`;
  }
  element.textContent = layer.content || '';
  return buildForeignObject(layer, element);
};

const buildDecorationLayerSvg = (layer: Layer): string => {
  const element = document.createElement('div');
  const format = layer.decorationFormat || detectDecorationFormat(layer.content);
  if (format === 'html') {
    const scopeId = `svg-${layer.id}`.replace(/[^a-z0-9-]/gi, '');
    const sanitized = sanitizeDecorationHtml(layer.content, scopeId);
    element.style.cssText = 'width:100%;height:100%;position:relative;overflow:hidden;isolation:isolate;contain:layout paint style;pointer-events:none;box-sizing:border-box;';
    const fragment = document.createElement('div');
    fragment.setAttribute('data-cf-fragment', scopeId);
    fragment.style.cssText = 'width:100%;height:100%;position:relative;box-sizing:border-box;';
    fragment.innerHTML = sanitized.source;
    element.append(fragment);
  } else {
    element.style.cssText = `width:100%;height:100%;box-sizing:border-box;${sanitizeDecorationCss(layer.content).cssText}`;
  }
  return buildForeignObject(layer, element);
};

export const buildProjectSvg = (project: ProjectState): string => {
  const { width, height } = project.canvasConfig;
  const allDefs: string[] = [
    `<clipPath id="cf-canvas-clip"><rect width="${width}" height="${height}" /></clipPath>`
  ];

  const bgResult = buildBackgroundSvg(project.background, width, height);
  allDefs.push(...bgResult.defs);

  const layerElements: string[] = [];
  const visibleLayers = project.layers
    .filter((l) => l.visible && l.type !== 'group')
    .sort((a, b) => a.zIndex - b.zIndex);

  for (const layer of visibleLayers) {
    const cx = layer.width / 2;
    const cy = layer.height / 2;
    const transforms: string[] = [`translate(${layer.x}, ${layer.y})`];
    if (layer.rotation) {
      transforms.push(`rotate(${layer.rotation}, ${cx}, ${cy})`);
    }
    const opacityAttr = layer.opacity !== undefined && layer.opacity < 1 ? ` opacity="${layer.opacity}"` : '';
    const nameAttr = layer.name ? ` data-name="${escapeXml(layer.name)}"` : '';

    let innerMarkup = '';
    if (layer.type === 'svg') {
      innerMarkup = buildSvgLayerMarkup(layer);
    } else if (layer.type === 'text') {
      innerMarkup = buildTextLayerSvg(layer);
    } else if (layer.type === 'image') {
      const filterCss = buildImageFilterCss(layer.imageFilters);
      const filterStyleAttr = filterCss ? ` style="filter: ${escapeXml(filterCss)};"` : '';
      const hasFlip = Boolean(layer.flipX || layer.flipY);
      const sx = layer.flipX ? -1 : 1;
      const sy = layer.flipY ? -1 : 1;

      if (hasActiveImageCrop(layer.imageCrop)) {
        const crop = normalizeImageCrop(layer.imageCrop);
        const clipId = `cf-crop-${layer.id}`.replace(/[^a-z0-9-_]/gi, '');
        allDefs.push(
          `<clipPath id="${escapeXml(clipId)}"><rect x="0" y="0" width="${layer.width}" height="${layer.height}" /></clipPath>`
        );
        const imgX = Number(((-crop.x / crop.width) * layer.width).toFixed(3));
        const imgY = Number(((-crop.y / crop.height) * layer.height).toFixed(3));
        const imgW = Number(((100 / crop.width) * layer.width).toFixed(3));
        const imgH = Number(((100 / crop.height) * layer.height).toFixed(3));
        const imgCx = Number((imgX + imgW / 2).toFixed(3));
        const imgCy = Number((imgY + imgH / 2).toFixed(3));
        const imgTransformAttr = hasFlip
          ? ` transform="translate(${imgCx}, ${imgCy}) scale(${sx}, ${sy}) translate(${-imgCx}, ${-imgCy})"`
          : '';
        innerMarkup = `<g clip-path="url(#${escapeXml(clipId)})"><image href="${escapeXml(layer.content)}" x="${imgX}" y="${imgY}" width="${imgW}" height="${imgH}" preserveAspectRatio="none"${imgTransformAttr}${filterStyleAttr} /></g>`;
      } else {
        const par = layer.ratioLocked ? 'xMidYMid meet' : 'none';
        const imgTransformAttr = hasFlip
          ? ` transform="translate(${cx}, ${cy}) scale(${sx}, ${sy}) translate(${-cx}, ${-cy})"`
          : '';
        innerMarkup = `<image href="${escapeXml(layer.content)}" x="0" y="0" width="${layer.width}" height="${layer.height}" preserveAspectRatio="${par}"${imgTransformAttr}${filterStyleAttr} />`;
      }
    } else if (layer.type === 'decoration') {
      innerMarkup = buildDecorationLayerSvg(layer);
    }

    if (innerMarkup) {
      layerElements.push(
        `<g id="${escapeXml(`layer-${layer.id}`)}"${nameAttr} transform="${transforms.join(' ')}"${opacityAttr}>${innerMarkup}</g>`
      );
    }
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" style="font-family:Inter,sans-serif;line-height:1.5;color:#e2e8f0;">`,
    `<style>:where(foreignObject *,foreignObject ::before,foreignObject ::after){box-sizing:border-box;margin:0;padding:0;border-width:0;border-style:solid;}</style>`,
    `<defs>${allDefs.join('')}</defs>`,
    `<g clip-path="url(#cf-canvas-clip)">`,
    ...bgResult.elements,
    ...layerElements,
    `</g>`,
    `</svg>`
  ].join('\n');
};
