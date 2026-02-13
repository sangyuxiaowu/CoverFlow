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

export interface StorageAdapter {
  type: StorageAdapterType;
  isAvailable: () => boolean;
  ensureReady: (options?: { prompt?: boolean }) => Promise<boolean>;
  listProjects: (options?: ListProjectsOptions) => Promise<ListProjectsResult>;
  saveProjects: (projects: ProjectState[]) => Promise<void>;
}
