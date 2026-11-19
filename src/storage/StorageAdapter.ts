import { ProjectState } from '../types.ts';

export type StorageAdapterType = 'indexeddb' | 'localfile' | 'cloud';

export type ListProjectsOptions = {
  page?: number;
  pageSize?: number;
  query?: string;
};

export type ListProjectsResult = {
  items: ProjectState[];
  total: number;
};

export type ProjectSummary = {
  kind: 'summary';
  id: string;
  title: string;
  updatedAt: number;
  version?: string;
  width: number;
  height: number;
  pageCount: number;
  layerCount: number;
  firstPageId?: string;
  fingerprint?: string;
};

export const summarizeProject = (project: ProjectState): ProjectSummary => {
  const first = project.pages?.[0];
  const pageInfo = first?.pageInfo ?? project.pageInfo;
  return { kind: 'summary', id: project.id, title: project.title, updatedAt: project.updatedAt,
    version: project.version, width: pageInfo.width, height: pageInfo.height,
    pageCount: project.pages?.length ?? 1, layerCount: (first?.layers ?? project.layers).length };
};

export interface StorageAdapter {
  type: StorageAdapterType;
  isAvailable: () => boolean;
  ensureReady: (options?: { prompt?: boolean }) => Promise<boolean>;
  getProject?: (projectId: string) => Promise<ProjectState | null>;
  listProjectSummaries?: () => Promise<ProjectSummary[]>;
  getProjectPreview?: (projectId: string) => Promise<Blob | undefined>;
  saveProjectPreview?: (project: ProjectState, pageId: string, preview: Blob) => Promise<void>;
  listProjects: (options?: ListProjectsOptions) => Promise<ListProjectsResult>;
  saveProject: (project: ProjectState) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
}
