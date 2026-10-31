import type { ProjectDocument, ProjectPage, ProjectState } from '../types.ts';
import { generateId } from '../utils/helpers.ts';

export const PROJECT_FORMAT_VERSION = '9.0.0';
export const MAX_PROJECT_PAGES = 99;
type StoredData = Record<string, unknown>;

const versionNumber = (version: unknown): number[] => {
  if (version === undefined) return [0, 0, 0];
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version)) throw new Error('Invalid project version.');
  return version.split(/[.+-]/).slice(0, 3).map(Number);
};

const compareVersions = (left: unknown, right: string) => {
  const leftParts = versionNumber(left);
  const rightParts = versionNumber(right);
  for (let index = 0; index < 3; index++) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
};

const upgrades: { version: string; convert: (data: StoredData) => StoredData }[] = [
  {
    version: '9.0.0',
    convert: data => ({ ...data, pages: data.pages ?? [{ id: generateId(), name: '', layers: data.layers, background: data.background, canvasConfig: data.canvasConfig }] })
  }
];

export function migrateProject(input: unknown): ProjectDocument {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid project data.');
  let data = { ...input } as StoredData;
  for (const upgrade of upgrades) {
    if (compareVersions(data.version, upgrade.version) < 0) data = { ...upgrade.convert(data), version: upgrade.version };
  }
  if (typeof data.id !== 'string' || !data.id || typeof data.title !== 'string') throw new Error('Invalid project metadata.');
  if (!Array.isArray(data.pages) || !data.pages.length || data.pages.length > MAX_PROJECT_PAGES) throw new Error('A project must contain 1-99 pages.');
  const ids = new Set<string>();
  const pages = data.pages.map((item): ProjectPage => {
    if (!item || typeof item !== 'object') throw new Error('Invalid page.');
    const page = item as ProjectPage;
    if (typeof page.id !== 'string' || !page.id || ids.has(page.id)) throw new Error('Invalid or duplicate page ID.');
    if (!Array.isArray(page.layers) || !page.background || !page.canvasConfig || !Number.isFinite(page.canvasConfig.width) || !Number.isFinite(page.canvasConfig.height) || page.canvasConfig.width <= 0 || page.canvasConfig.height <= 0) throw new Error('Invalid page content.');
    ids.add(page.id);
    return { id: page.id, name: typeof page.name === 'string' ? page.name : '', layers: page.layers, background: page.background, canvasConfig: page.canvasConfig };
  });
  return { id: data.id, title: data.title, version: data.version as string, pages, updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now() };
}

export function readProject(input: unknown): ProjectState {
  const document = migrateProject(input);
  const first = document.pages[0];
  return { ...document, activePageId: first.id, layers: first.layers, background: first.background, canvasConfig: first.canvasConfig, selectedLayerId: null };
}

export function syncProjectPages(project: ProjectState): ProjectState {
  if (!project.pages?.length) {
    const page: ProjectPage = { id: generateId(), name: '', layers: project.layers, background: project.background, canvasConfig: project.canvasConfig };
    return { ...project, version: PROJECT_FORMAT_VERSION, pages: [page], activePageId: page.id };
  }
  const active = project.pages.find(page => page.id === project.activePageId) ?? project.pages[0];
  const pages = project.pages.map(page => page.id !== active.id || (page.layers === project.layers && page.background === project.background && page.canvasConfig === project.canvasConfig)
    ? page : { ...page, layers: project.layers, background: project.background, canvasConfig: project.canvasConfig });
  return { ...project, version: project.version && compareVersions(project.version, PROJECT_FORMAT_VERSION) >= 0 ? project.version : PROJECT_FORMAT_VERSION, activePageId: active.id, pages };
}

export function writeProject(project: ProjectState): ProjectDocument {
  const synced = syncProjectPages(project);
  return { id: synced.id, title: synced.title, version: synced.version ?? PROJECT_FORMAT_VERSION, updatedAt: synced.updatedAt, pages: synced.pages! };
}