import { ProjectState, ProjectVersion, ProjectVersionSummary } from '../types.ts';
import { ListProjectsOptions, StorageAdapter, StorageAdapterType } from './StorageAdapter.ts';
import { readProject, writeProject } from './projectCompatibility.ts';
import { embedProjectImageAssets } from './projectImageSession.ts';
import {
  appendProjectVersion,
  getProjectVersionState,
  listProjectVersionSummaries,
  removeProjectVersion
} from './versionStore.ts';

// 用于使用云端API管理项目时的存储适配器。
// 目前实现为基于 localStorage 的 Mock，后续替换为真实 API 调用。

// Mock 存储 key
const CLOUD_PROJECTS_KEY = 'coverflow_cloud_projects_v1';

const safeJsonParse = <T,>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch (err) {
    return fallback;
  }
};

// Mock: 一次性读取全部项目。
// 注意：真实接口应提供分页与搜索参数，避免全量拉取。
const loadProjects = () => safeJsonParse<unknown[]>(localStorage.getItem(CLOUD_PROJECTS_KEY), []).map(readProject);

// Mock: 全量保存项目列表。
// 注意：真实接口应提供增量更新（创建/更新/删除单个项目）。
const saveProjects = (projects: ProjectState[]) => {
  localStorage.setItem(CLOUD_PROJECTS_KEY, JSON.stringify(projects.map(writeProject)));
};

const mergeStoredVersions = (incoming?: ProjectVersion[], stored?: ProjectVersion[]): ProjectVersion[] | undefined => {
  const merged = [...(incoming ?? [])];
  const seen = new Set(merged.map(item => item.id));
  for (const item of stored ?? []) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged.length ? merged : undefined;
};

// Cloud 模式项目存储适配器（Mock API）。
export class CloudAdapter implements StorageAdapter {
  type: StorageAdapterType = 'cloud';

  isAvailable = () => typeof localStorage !== 'undefined';

  ensureReady = async () => this.isAvailable();

  getProject = async (projectId: string) => {
    if (!this.isAvailable()) return null;
    return loadProjects().find(item => item.id === projectId) ?? null;
  };

  listProjects = async (options?: ListProjectsOptions) => {
    if (!this.isAvailable()) return { items: [], total: 0 };
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 20;
    const query = options?.query?.trim().toLowerCase() || '';

    const all = loadProjects()
      .filter(project => !query || project.title.toLowerCase().includes(query))
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return {
      items: all.slice(start, end),
      total: all.length
    };
  };

  saveProject = async (project: ProjectState) => {
    if (!this.isAvailable()) return;
    const embedded = await embedProjectImageAssets(project);
    const all = loadProjects();
    const idx = all.findIndex(item => item.id === project.id);
    if (idx >= 0) all[idx] = embedded;
    else all.unshift(embedded);
    saveProjects(all);
  };

  deleteProject = async (projectId: string) => {
    if (!this.isAvailable()) return;
    const next = loadProjects().filter(item => item.id !== projectId);
    saveProjects(next);
  };

  listProjectVersions = async (projectId: string): Promise<ProjectVersionSummary[]> => {
    if (!this.isAvailable()) return [];
    const found = loadProjects().find(item => item.id === projectId);
    return listProjectVersionSummaries(found);
  };

  saveProjectVersion = async (project: ProjectState, rawInfo: string): Promise<ProjectVersionSummary> => {
    if (!this.isAvailable()) throw new Error('Cloud storage is unavailable.');
    const all = loadProjects();
    const existing = all.find(item => item.id === project.id);
    const mergedVersions = mergeStoredVersions(project.versions, existing?.versions);
    const target = mergedVersions ? { ...project, versions: mergedVersions } : project;
    const { project: nextProject, summary } = appendProjectVersion(target, rawInfo);
    const embedded = await embedProjectImageAssets(nextProject);
    const idx = all.findIndex(item => item.id === project.id);
    if (idx >= 0) all[idx] = embedded;
    else all.unshift(embedded);
    saveProjects(all);
    return summary;
  };

  getProjectVersion = async (projectId: string, versionId: string): Promise<ProjectState | null> => {
    if (!this.isAvailable()) return null;
    const found = loadProjects().find(item => item.id === projectId);
    return found ? getProjectVersionState(found, versionId) : null;
  };

  deleteProjectVersion = async (projectId: string, versionId: string): Promise<void> => {
    if (!this.isAvailable()) return;
    const all = loadProjects();
    const idx = all.findIndex(item => item.id === projectId);
    if (idx < 0) return;
    all[idx] = removeProjectVersion(all[idx], versionId);
    saveProjects(all);
  };
}

// 创建 Cloud 适配器实例。
export const createCloudAdapter = () => new CloudAdapter();
