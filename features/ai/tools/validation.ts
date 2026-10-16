import type { BackgroundConfig, Layer } from '../../../types.ts';
import { sanitizeDecorationContent } from '../../../utils/decorationStyles.ts';

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}

export function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200000) throw new Error('Invalid ' + field);
  return value;
}

export function number(value: unknown, field: string, min = -100000, max = 100000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid ' + field);
  return value;
}

export function choice<Value extends string>(value: unknown, field: string, choices: readonly Value[]): Value {
  if (typeof value !== 'string' || !choices.includes(value as Value)) throw new Error('Invalid ' + field);
  return value as Value;
}

export function ids(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 500) throw new Error('layerIds must contain 1-500 IDs.');
  return [...new Set(value.map(id => text(id, 'layerId')))];
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid ' + field);
  return value;
}

export function safeImage(value: string): string {
  if (/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Images require an HTTP(S) URL or bitmap data URL.');
  return value;
}

export function layerPatch(value: unknown): Partial<Layer> {
  const input = record(value);
  const output: Record<string, unknown> = {};
  const strings = ['name', 'content', 'color', 'fontFamily'];
  const booleans = ['visible', 'locked', 'ratioLocked'];
  const numeric = ['x', 'y', 'rotation', 'width', 'height', 'opacity', 'fontSize', 'zIndex'];
  for (const [field, raw] of Object.entries(input)) {
    if (strings.includes(field)) {
      if (typeof raw !== 'string' || raw.length > 200000) throw new Error('Invalid ' + field);
      output[field] = raw;
    } else if (booleans.includes(field)) output[field] = boolean(raw, field);
    else if (numeric.includes(field)) output[field] = number(raw, field, ['width', 'height', 'fontSize'].includes(field) ? 1 : field === 'opacity' ? 0 : -100000, field === 'opacity' ? 1 : 100000);
    else if (field === 'fontWeight') output[field] = typeof raw === 'string' ? text(raw, field) : number(raw, field, 1, 1000);
    else if (field === 'textAlign') output[field] = choice(raw, field, ['left', 'center', 'right']);
    else if (field === 'writingMode') output[field] = choice(raw, field, ['horizontal', 'vertical']);
    else if (field === 'decorationFormat') output[field] = choice(raw, field, ['css', 'html']);
    else if (field === 'textGradient' || field === 'textShadow') {
      const nested = record(raw);
      const allowed = field === 'textGradient' ? ['enabled', 'from', 'to', 'angle'] : ['enabled', 'color', 'blur', 'offsetX', 'offsetY'];
      if (Object.keys(nested).some(key => !allowed.includes(key)) || allowed.some(key => nested[key] === undefined)) throw new Error('Provide every field of ' + field);
      output[field] = Object.fromEntries(allowed.map(key => [key, key === 'enabled' ? boolean(nested[key], key) : ['from', 'to', 'color'].includes(key) ? text(nested[key], key) : number(nested[key], key, key === 'blur' ? 0 : -100000)]));
    } else throw new Error('Unsupported layer field: ' + field);
  }
  return output as Partial<Layer>;
}

export function validateContent(type: Layer['type'], content: string, format?: Layer['decorationFormat']): string {
  if (type === 'image') return safeImage(content);
  if (type === 'svg') {
    const document = new DOMParser().parseFromString(content, 'image/svg+xml');
    if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') throw new Error('Invalid SVG.');
    for (const element of document.querySelectorAll('*')) {
      if (['script', 'foreignObject', 'iframe', 'style', 'animate', 'set', 'animateTransform', 'animateMotion'].includes(element.localName)) throw new Error('Active SVG content is not allowed.');
      for (const attribute of element.attributes) {
        if (attribute.name.toLowerCase().startsWith('on') || (/href$/i.test(attribute.name) && !attribute.value.startsWith('#')) || /url\(\s*['"]?(?!#)/i.test(attribute.value)) throw new Error('External or active SVG attributes are not allowed.');
      }
    }
  }
  if (type === 'decoration') {
    const result = sanitizeDecorationContent(content, format);
    if (result.issues.length) throw new Error(result.issues.map((issue) => issue.detail || issue.code).join('; '));
  }
  return content;
}

export function backgroundPatch(value: unknown): Partial<BackgroundConfig> {
  const output: Record<string, unknown> = {};
  for (const [field, raw] of Object.entries(record(value))) {
    if (field === 'type') output[field] = choice(raw, field, ['color', 'gradient', 'image', 'css']);
    else if (field === 'value') output[field] = text(raw, field);
    else if (field === 'overlay') {
      for (const [overlayField, overlayValue] of Object.entries(record(raw))) {
        if (overlayField === 'type') output.overlayType = choice(overlayValue, overlayField, ['none', 'dots', 'grid', 'stripes']);
        else if (overlayField === 'color') output.overlayColor = text(overlayValue, overlayField);
        else if (overlayField === 'opacity') output.overlayOpacity = number(overlayValue, overlayField, 0, 1);
        else if (overlayField === 'scale') output.overlayScale = number(overlayValue, overlayField, 20, 1000);
        else throw new Error('Unsupported overlay field: ' + overlayField);
      }
    }
    else throw new Error('Unsupported background field: ' + field);
  }
  return output as Partial<BackgroundConfig>;
}