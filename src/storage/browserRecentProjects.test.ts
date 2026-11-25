import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { expect, test, vi } from 'vitest';
import { listBrowserRecentProjects, putBrowserRecentProject, removeBrowserRecentProject, type BrowserRecentProject } from './browserRecentProjects.ts';

test('persists, orders, updates and removes recent browser file records', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  try {
    const first = { path: 'pwa:first', handle: { kind: 'file', name: 'first.cfjx' }, summary: { id: 'first', title: 'First' }, lastOpenedAt: 1 } as BrowserRecentProject;
    const second = { ...first, path: 'pwa:second', summary: { ...first.summary, id: 'second' }, lastOpenedAt: 2 };
    await putBrowserRecentProject(first);
    await putBrowserRecentProject(second);
    expect((await listBrowserRecentProjects()).map(item => item.path)).toEqual(['pwa:second', 'pwa:first']);
    await putBrowserRecentProject({ ...first, summary: { ...first.summary, title: 'Updated' }, lastOpenedAt: 3 });
    expect((await listBrowserRecentProjects())[0]).toMatchObject({ path: first.path, handle: { name: 'first.cfjx' }, summary: { title: 'Updated' } });
    await removeBrowserRecentProject(first.path);
    expect((await listBrowserRecentProjects()).map(item => item.path)).toEqual(['pwa:second']);
  } finally { vi.unstubAllGlobals(); }
});