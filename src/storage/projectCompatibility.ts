import type { ProjectDocument, ProjectPage, ProjectState } from '../types.ts';
import { generateId } from '../utils/helpers.ts';
import { migrateLegacyProject } from './legacyCfj.ts';

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

export function migrateProject(input: unknown): ProjectDocument {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid project data.');
  const data = migrateLegacyProject({ ...input } as StoredData);
  if (data.schemaVersion !== 1) throw new Error('Unsupported project schema version.');
  if (typeof data.id !== 'string' || !data.id || typeof data.title !== 'string') throw new Error('Invalid project metadata.');
  if (!Array.isArray(data.pages) || !data.pages.length || data.pages.length > MAX_PROJECT_PAGES) throw new Error('A project must contain 1-99 pages.');
  const ids = new Set<string>();
  const pages = data.pages.map((item): ProjectPage => {
    if (!item || typeof item !== 'object') throw new Error('Invalid page.');
    const page = item as ProjectPage;
    if (typeof page.id !== 'string' || !page.id || ids.has(page.id)) throw new Error('Invalid or duplicate page ID.');
    if (!Array.isArray(page.layers) || !page.pageInfo || !page.pageInfo.background || !Number.isFinite(page.pageInfo.width) || !Number.isFinite(page.pageInfo.height) || page.pageInfo.width <= 0 || page.pageInfo.height <= 0) throw new Error('Invalid page content.');
    ids.add(page.id);
    return { id: page.id, name: typeof page.name === 'string' ? page.name : '', layers: page.layers, pageInfo: { width: page.pageInfo.width, height: page.pageInfo.height, background: page.pageInfo.background } };
  });
  return { id: data.id, title: data.title, version: typeof data.version === 'string' ? data.version : PROJECT_FORMAT_VERSION, schemaVersion: 1, pages, updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now() };
}

export function readProject(input: unknown): ProjectState {
  const document = migrateProject(input);
  const first = document.pages[0];
  return { ...document, activePageId: first.id, layers: first.layers, pageInfo: first.pageInfo, selectedLayerId: null };
}

export function syncProjectPages(project: ProjectState): ProjectState {
  if (!project.pages?.length) {
    const page: ProjectPage = { id: generateId(), name: '', layers: project.layers, pageInfo: project.pageInfo };
    return { ...project, version: PROJECT_FORMAT_VERSION, pages: [page], activePageId: page.id };
  }
  const active = project.pages.find(page => page.id === project.activePageId) ?? project.pages[0];
  const pages = project.pages.map(page => page.id !== active.id || (page.layers === project.layers && page.pageInfo === project.pageInfo)
    ? page : { ...page, layers: project.layers, pageInfo: project.pageInfo });
  return { ...project, version: project.version && compareVersions(project.version, PROJECT_FORMAT_VERSION) >= 0 ? project.version : PROJECT_FORMAT_VERSION, activePageId: active.id, pages };
}

export function writeProject(project: ProjectState): ProjectDocument {
  const synced = syncProjectPages(project);
  return { id: synced.id, title: synced.title, version: synced.version ?? PROJECT_FORMAT_VERSION, schemaVersion: 1, updatedAt: synced.updatedAt, pages: synced.pages! };
}