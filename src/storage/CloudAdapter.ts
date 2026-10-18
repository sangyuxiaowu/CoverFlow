import { ProjectState } from '../types.ts';
import { ListProjectsOptions, StorageAdapter, StorageAdapterType } from './StorageAdapter.ts';

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
const loadProjects = () => safeJsonParse<ProjectState[]>(localStorage.getItem(CLOUD_PROJECTS_KEY), []);

// Mock: 全量保存项目列表。
// 注意：真实接口应提供增量更新（创建/更新/删除单个项目）。
const saveProjects = (projects: ProjectState[]) => {
  localStorage.setItem(CLOUD_PROJECTS_KEY, JSON.stringify(projects));
};

// Cloud 模式项目存储适配器（Mock API）。
// 真实 API 设计建议：
// - GET /projects?page=1&pageSize=20&query=keyword&sort=updatedAt_desc
//   返回 { items: ProjectState[], total: number, page: number, pageSize: number }
// - GET /projects/:id
// - POST /projects (body: ProjectState)
// - PUT /projects/:id (body: Partial<ProjectState>)
// - DELETE /projects/:id
// 说明：
// - 列表加载应分页，搜索应由 API 侧完成，避免前端全量过滤。
// - 建议支持只返回列表字段（不含大尺寸 content）以降低带宽。
export class CloudAdapter implements StorageAdapter {
  type: StorageAdapterType = 'cloud';

  isAvailable = () => typeof localStorage !== 'undefined';

  ensureReady = async () => this.isAvailable();

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
    const all = loadProjects();
    const idx = all.findIndex(item => item.id === project.id);
    if (idx >= 0) all[idx] = project;
    else all.unshift(project);
    saveProjects(all);
  };

  deleteProject = async (projectId: string) => {
    if (!this.isAvailable()) return;
    const next = loadProjects().filter(item => item.id !== projectId);
    saveProjects(next);
  };
}

// 创建 Cloud 适配器实例。
export const createCloudAdapter = () => new CloudAdapter();
