import { readProject } from './projectCompatibility.ts';
import { generateId } from '../utils/helpers.ts';
import type { PageInfo } from '../types.ts';

// Remove this file and all CFJ compatibility handling when version 10.0.0 is released.
export function migrateLegacyProject(input: Record<string, unknown>): Record<string, unknown> {
  if (input.schemaVersion !== undefined) return input;
  const version = input.version;
  if (version !== undefined && (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version))) throw new Error('Invalid project version.');
  let pages = input.pages;
  if (!pages && (version === undefined || Number(String(version).split('.')[0]) < 9)) {
    pages = [{ id: generateId(), name: '', layers: input.layers, background: input.background, canvasConfig: input.canvasConfig }];
  }
  if (!Array.isArray(pages)) return input;
  return {
    ...input,
    schemaVersion: 1,
    pages: pages.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const { canvasConfig, background, ...page } = item as Record<string, unknown>;
      if (!canvasConfig || typeof canvasConfig !== 'object' || Array.isArray(canvasConfig)) return item;
      const { width, height } = canvasConfig as Record<string, unknown>;
      return { ...page, pageInfo: { width, height, background } };
    })
  };
}

export function readLegacyCfj(text: string) {
  return readProject(JSON.parse(text));
}

export function migrateLegacyProjectPatch(input: Record<string, unknown>, current: PageInfo): Record<string, unknown> {
  if (!('canvasConfig' in input) && !('background' in input)) return input;
  const { canvasConfig, background, ...rest } = input;
  const dimensions = canvasConfig && typeof canvasConfig === 'object' && !Array.isArray(canvasConfig) ? canvasConfig as Record<string, unknown> : {};
  return { ...rest, pageInfo: { width: dimensions.width ?? current.width, height: dimensions.height ?? current.height, background: background ?? current.background } };
}