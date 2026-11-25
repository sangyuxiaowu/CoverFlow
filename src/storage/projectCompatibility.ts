import type { ProjectDocument, ProjectPage, ProjectState, ProjectVersion } from '../types.ts';
import { generateId } from '../utils/helpers.ts';
import { migrateLegacyProject } from './legacyCfj.ts';

export const PROJECT_FORMAT_VERSION = '9.0.0';
export const MAX_PROJECT_PAGES = 99;
type StoredData = Record<string, unknown>;

export const sameStoredValue = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => sameStoredValue(item, right[index]));
  }
  const leftObject = left as Record<string, unknown>;
  const rightObject = right as Record<string, unknown>;
  const keys = Object.keys(leftObject).filter(key => leftObject[key] !== undefined);
  return keys.length === Object.keys(rightObject).filter(key => rightObject[key] !== undefined).length &&
    keys.every(key => Object.hasOwn(rightObject, key) && sameStoredValue(leftObject[key], rightObject[key]));
};

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

const normalizePages = (rawPages: unknown): ProjectPage[] => {
  if (!Array.isArray(rawPages) || !rawPages.length || rawPages.length > MAX_PROJECT_PAGES) throw new Error('A project must contain 1-99 pages.');
  const ids = new Set<string>();
  return rawPages.map((item): ProjectPage => {
    if (!item || typeof item !== 'object') throw new Error('Invalid page.');
    const page = item as ProjectPage;
    if (typeof page.id !== 'string' || !page.id || ids.has(page.id)) throw new Error('Invalid or duplicate page ID.');
    if (!Array.isArray(page.layers) || !page.pageInfo || !page.pageInfo.background || !Number.isFinite(page.pageInfo.width) || !Number.isFinite(page.pageInfo.height) || page.pageInfo.width <= 0 || page.pageInfo.height <= 0) throw new Error('Invalid page content.');
    ids.add(page.id);
    return { id: page.id, name: typeof page.name === 'string' ? page.name : '', ...(typeof page.notes === 'string' ? { notes: page.notes } : {}), layers: page.layers, pageInfo: { width: page.pageInfo.width, height: page.pageInfo.height, background: page.pageInfo.background } };
  });
};

const normalizeVersions = (rawVersions: unknown): ProjectVersion[] | undefined => {
  if (rawVersions === undefined) return undefined;
  if (!Array.isArray(rawVersions)) throw new Error('Invalid project versions.');
  if (!rawVersions.length) return undefined;
  const ids = new Set<string>();
  return rawVersions.map((item): ProjectVersion => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid project version entry.');
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string' || !record.id || ids.has(record.id)) throw new Error('Invalid or duplicate project version ID.');
    if (typeof record.info !== 'string' || !record.info.trim() || record.info.trim().length > 200) throw new Error('Invalid project version info.');
    if (typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) throw new Error('Invalid project version timestamp.');
    if (typeof record.title !== 'string') throw new Error('Invalid project version title.');
    if (record.version !== undefined) versionNumber(record.version);
    ids.add(record.id);
    return {
      id: record.id,
      info: record.info.trim(),
      createdAt: record.createdAt,
      title: record.title,
      ...(typeof record.version === 'string' ? { version: record.version } : {}),
      pages: normalizePages(record.pages)
    };
  });
};

export function migrateProject(input: unknown): ProjectDocument {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid project data.');
  const data = migrateLegacyProject({ ...input } as StoredData);
  if (data.schemaVersion !== 1) throw new Error('Unsupported project schema version.');
  if (typeof data.id !== 'string' || !data.id || typeof data.title !== 'string') throw new Error('Invalid project metadata.');
  const pages = normalizePages(data.pages);
  const versions = normalizeVersions(data.versions);
  return {
    id: data.id,
    title: data.title,
    version: typeof data.version === 'string' ? data.version : PROJECT_FORMAT_VERSION,
    schemaVersion: 1,
    pages,
    ...(versions ? { versions } : {}),
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now()
  };
}

export function readProject(input: unknown): ProjectState {
  const document = migrateProject(input);
  const first = document.pages[0];
  return { ...document, activePageId: first.id, layers: first.layers, pageInfo: first.pageInfo, selectedLayerId: null };
}

export function syncProjectPages(project: ProjectState): ProjectState {
  const versions = project.versions?.length ? project.versions : undefined;
  if (!project.pages?.length) {
    const page: ProjectPage = { id: generateId(), name: '', layers: project.layers, pageInfo: project.pageInfo };
    const next: ProjectState = { ...project, version: PROJECT_FORMAT_VERSION, pages: [page], activePageId: page.id };
    if (versions) next.versions = versions;
    else delete next.versions;
    return next;
  }
  const active = project.pages.find(page => page.id === project.activePageId) ?? project.pages[0];
  const pages = active.layers === project.layers && active.pageInfo === project.pageInfo
    ? project.pages
    : project.pages.map(page => page.id !== active.id ? page : { ...page, layers: project.layers, pageInfo: project.pageInfo });
  const next: ProjectState = { ...project, version: project.version && compareVersions(project.version, PROJECT_FORMAT_VERSION) >= 0 ? project.version : PROJECT_FORMAT_VERSION, activePageId: active.id, pages };
  if (versions) next.versions = versions;
  else delete next.versions;
  return next;
}

export function writeProject(project: ProjectState): ProjectDocument {
  const synced = syncProjectPages(project);
  return {
    id: synced.id,
    title: synced.title,
    version: synced.version ?? PROJECT_FORMAT_VERSION,
    schemaVersion: 1,
    updatedAt: synced.updatedAt,
    pages: synced.pages!,
    ...(synced.versions?.length ? { versions: synced.versions } : {})
  };
}