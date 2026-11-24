import type { ProjectPage, ProjectState, ProjectVersion, ProjectVersionSummary } from '../types.ts';
import { generateId } from '../utils/helpers.ts';
import { clonePlainData } from '../utils/clonePlainData.ts';
import { readProject, syncProjectPages, writeProject } from './projectCompatibility.ts';

export const normalizeVersionInfo = (info: string): string => {
  const trimmed = info.trim();
  if (!trimmed) throw new Error('Version info is required.');
  if (trimmed.length > 200) throw new Error('Version info must be at most 200 characters.');
  return trimmed;
};

export const summarizeProjectVersionRecord = (projectId: string, record: ProjectVersion): ProjectVersionSummary => {
  const first = record.pages[0];
  return {
    id: record.id,
    projectId,
    info: record.info,
    createdAt: record.createdAt,
    title: record.title,
    pageCount: record.pages.length,
    width: first.pageInfo.width,
    height: first.pageInfo.height
  };
};

export const listProjectVersionSummaries = (
  project: Pick<ProjectState, 'id' | 'versions'> | null | undefined
): ProjectVersionSummary[] => {
  if (!project?.versions?.length) return [];
  return project.versions
    .map(record => summarizeProjectVersionRecord(project.id, record))
    .sort((a, b) => b.createdAt - a.createdAt);
};

export const appendProjectVersion = (
  project: ProjectState,
  rawInfo: string,
  createdAt = Date.now()
): { project: ProjectState; version: ProjectVersion; summary: ProjectVersionSummary } => {
  const info = normalizeVersionInfo(rawInfo);
  const document = writeProject(project);
  const versionId = generateId();
  const version: ProjectVersion = {
    id: versionId,
    info,
    createdAt,
    title: document.title,
    version: document.version,
    pages: clonePlainData(document.pages) as ProjectPage[]
  };
  const nextVersions = [version, ...(document.versions ?? []).filter(item => item.id !== versionId)]
    .sort((a, b) => b.createdAt - a.createdAt);
  const synced = syncProjectPages({
    ...project,
    versions: nextVersions
  });
  return {
    project: synced,
    version,
    summary: summarizeProjectVersionRecord(synced.id, version)
  };
};

export const getProjectVersionState = (
  project: ProjectState,
  versionId: string
): ProjectState | null => {
  const found = project.versions?.find(item => item.id === versionId);
  if (!found) return null;
  const restored = readProject({
    id: project.id,
    title: found.title,
    version: found.version ?? project.version,
    schemaVersion: 1,
    pages: clonePlainData(found.pages),
    updatedAt: found.createdAt,
    ...(project.versions?.length ? { versions: project.versions } : {})
  });
  return restored;
};

export const restoreProjectFromVersion = (
  project: ProjectState,
  versionId: string,
  updatedAt = Date.now()
): ProjectState => {
  const restored = getProjectVersionState(project, versionId);
  if (!restored) throw new Error('Project version not found.');
  return {
    ...restored,
    updatedAt
  };
};

export const removeProjectVersion = (
  project: ProjectState,
  versionId: string
): ProjectState => {
  const nextVersions = (project.versions ?? []).filter(item => item.id !== versionId);
  const next: ProjectState = { ...project };
  if (nextVersions.length) next.versions = nextVersions;
  else delete next.versions;
  return syncProjectPages(next);
};

export const mergeProjectVersionChanges = (
  current: ProjectState,
  original: ProjectState,
  saved: ProjectState
): ProjectState => {
  const originalIds = new Set((original.versions ?? []).map(version => version.id));
  const savedIds = new Set((saved.versions ?? []).map(version => version.id));
  const added = (saved.versions ?? []).filter(version => !originalIds.has(version.id));
  const versions = [
    ...added,
    ...(current.versions ?? []).filter(version => !added.some(item => item.id === version.id) && (!originalIds.has(version.id) || savedIds.has(version.id)))
  ];
  return syncProjectPages({ ...current, versions: versions.length ? versions : undefined });
};
