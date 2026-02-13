import { ProjectState } from '../types.ts';

export type StorageAdapterType = 'indexeddb' | 'localfile';

export interface StorageAdapter {
  type: StorageAdapterType;
  isAvailable: () => boolean;
  ensureReady: (options?: { prompt?: boolean }) => Promise<boolean>;
  listProjects: () => Promise<ProjectState[]>;
  saveProjects: (projects: ProjectState[]) => Promise<void>;
}
