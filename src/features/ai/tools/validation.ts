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
  const errorMessage = 'Images require an HTTP(S) URL or bitmap data URL.';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(errorMessage);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(errorMessage);
  return value;
}

export const LAYER_FIELD_GROUPS: Record<string, readonly (keyof Layer)[]> = {
  image: ['content', 'imageSource', 'imageDescription', 'flipX', 'flipY', 'imageFilters', 'imageCrop'],
  text: ['content', 'color', 'fontFamily', 'fontWeight', 'fontSize', 'textAlign', 'writingMode', 'textGradient', 'textShadow'],
  svg: ['content', 'color'],
  decoration: ['content']
};

export const LAYER_INFO_FIELDS: readonly (keyof Layer)[] = [
  'x', 'y', 'width', 'height', 'rotation', 'zIndex', 'opacity', 'visible', 'locked', 'ratioLocked'
];

export function layerDetails(layer: Layer): Record<string, unknown> {
  const groupedFields = new Set([...Object.values(LAYER_FIELD_GROUPS).flat(), ...LAYER_INFO_FIELDS, 'backgroundRemoved', 'children']);
  const identity = Object.fromEntries(Object.entries(layer).filter(([field]) => ['id', 'name', 'type', 'parentId'].includes(field)));
  const layerInfo = Object.fromEntries(LAYER_INFO_FIELDS.filter(field => layer[field] !== undefined).map(field => [field, layer[field]]));
  const fields = layer.type === 'group' ? ['children'] : [...LAYER_FIELD_GROUPS[layer.type], ...(layer.type === 'image' ? ['backgroundRemoved'] : [])];
  const specific = Object.fromEntries(fields.filter(field => layer[field as keyof Layer] !== undefined).map(field => [field, layer[field as keyof Layer]]));
  return { ...identity, layerInfo, ...(Object.keys(specific).length ? { [layer.type]: specific } : {}) };
}

export function validateLayerGroups(value: unknown, type: Layer['type']): void {
  const input = record(value);
  for (const group of Object.keys(LAYER_FIELD_GROUPS)) {
    if (Object.hasOwn(input, group) && group !== type) throw new Error(`properties.${group} is only supported on ${group} layers; target type is ${type}.`);
  }
}

export function layerPatch(value: unknown): Partial<Layer> {
  const input = record(value);
  const fields: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (key === 'layerInfo') {
      const nested = record(raw);
      const allowed = LAYER_INFO_FIELDS.filter(field => field !== 'zIndex') as readonly string[];
      const keys = Object.keys(nested);
      if (!keys.length) throw new Error('properties.layerInfo must contain at least one field.');
      for (const field of keys) {
        if (!allowed.includes(field)) throw new Error(`Unsupported properties.layerInfo.${field}; allowed fields: ${allowed.join(', ')}.`);
        fields[field] = nested[field];
      }
    } else if (Object.hasOwn(LAYER_FIELD_GROUPS, key)) {
      const nested = record(raw);
      const allowed = LAYER_FIELD_GROUPS[key] as readonly string[];
      const keys = Object.keys(nested);
      if (!keys.length) throw new Error(`properties.${key} must contain at least one field.`);
      for (const field of keys) {
        if (!allowed.includes(field)) throw new Error(`Unsupported properties.${key}.${field}; allowed fields: ${allowed.join(', ')}.`);
      }
      for (const [field, fieldValue] of Object.entries(nested)) {
        if (Object.hasOwn(fields, field)) throw new Error('Duplicate layer field: ' + field);
        fields[field] = fieldValue;
      }
    } else {
      const groups = Object.entries(LAYER_FIELD_GROUPS).filter(([, group]) => (group as readonly string[]).includes(key)).map(([group]) => group);
      if (groups.length) throw new Error(`${key} must be nested under ${groups.map(group => `properties.${group}.${key}`).join(' or ')}.`);
      if (LAYER_INFO_FIELDS.includes(key as keyof Layer)) throw new Error(`${key} must be nested under properties.layerInfo.${key}.`);
      fields[key] = raw;
    }
  }
  const output: Record<string, unknown> = {};
  const strings = ['name', 'content', 'color', 'fontFamily', 'imageSource', 'imageDescription'];
  const booleans = ['visible', 'locked', 'ratioLocked', 'flipX', 'flipY'];
  const numeric = ['x', 'y', 'rotation', 'width', 'height', 'opacity', 'fontSize', 'zIndex'];
  for (const [field, raw] of Object.entries(fields)) {
    if (strings.includes(field)) {
      const limit = field === 'imageSource' ? 200 : field === 'imageDescription' ? 10000 : 200000;
      if (typeof raw !== 'string' || raw.length > limit) throw new Error('Invalid ' + field);
      output[field] = raw;
    } else if (booleans.includes(field)) output[field] = boolean(raw, field);
    else if (numeric.includes(field)) output[field] = number(raw, field, ['width', 'height', 'fontSize'].includes(field) ? 1 : field === 'opacity' ? 0 : -100000, field === 'opacity' ? 1 : 100000);
    else if (field === 'fontWeight') output[field] = typeof raw === 'string' ? text(raw, field) : number(raw, field, 1, 1000);
    else if (field === 'textAlign') output[field] = choice(raw, field, ['left', 'center', 'right']);
    else if (field === 'writingMode') output[field] = choice(raw, field, ['horizontal', 'vertical']);
    else if (field === 'imageFilters') {
      const nested = record(raw);
      const allowed = ['brightness', 'contrast', 'grayscale', 'blur'] as const;
      const keys = Object.keys(nested);
      if (!keys.length || keys.some(key => !allowed.includes(key as typeof allowed[number]))) {
        throw new Error('Invalid imageFilters');
      }
      const filters: Record<string, number> = {};
      if (nested.brightness !== undefined) filters.brightness = number(nested.brightness, 'brightness', 0, 200);
      if (nested.contrast !== undefined) filters.contrast = number(nested.contrast, 'contrast', 0, 200);
      if (nested.grayscale !== undefined) filters.grayscale = number(nested.grayscale, 'grayscale', 0, 100);
      if (nested.blur !== undefined) filters.blur = number(nested.blur, 'blur', 0, 20);
      output[field] = filters;
    } else if (field === 'imageCrop') {
      const nested = record(raw);
      const allowed = ['x', 'y', 'width', 'height'] as const;
      const keys = Object.keys(nested);
      if (!keys.length || keys.some(key => !allowed.includes(key as typeof allowed[number]))) {
        throw new Error('Invalid imageCrop');
      }
      const crop: Record<string, number> = {};
      if (nested.x !== undefined) crop.x = number(nested.x, 'x', 0, 100);
      if (nested.y !== undefined) crop.y = number(nested.y, 'y', 0, 100);
      if (nested.width !== undefined) crop.width = number(nested.width, 'width', 1, 100);
      if (nested.height !== undefined) crop.height = number(nested.height, 'height', 1, 100);
      if ((crop.x ?? 0) + (crop.width ?? 0) > 100.001 || (crop.y ?? 0) + (crop.height ?? 0) > 100.001) {
        throw new Error('Invalid imageCrop: crop bounds cannot exceed 100%.');
      }
      output[field] = crop;
    } else if (field === 'textGradient' || field === 'textShadow') {
      const nested = record(raw);
      const allowed = field === 'textGradient' ? ['enabled', 'from', 'to', 'angle'] : ['enabled', 'color', 'blur', 'offsetX', 'offsetY'];
      if (Object.keys(nested).some(key => !allowed.includes(key)) || allowed.some(key => nested[key] === undefined)) throw new Error('Provide every field of ' + field);
      output[field] = Object.fromEntries(allowed.map(key => [key, key === 'enabled' ? boolean(nested[key], key) : ['from', 'to', 'color'].includes(key) ? text(nested[key], key) : number(nested[key], key, key === 'blur' ? 0 : -100000)]));
    } else throw new Error('Unsupported layer field: ' + field);
  }
  return output as Partial<Layer>;
}

export function validateContent(type: Layer['type'], content: string): string {
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
    const result = sanitizeDecorationContent(content);
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