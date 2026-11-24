import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createWorkspaceBridge, type WorkspaceOptions } from './workspace.ts';
import type { ProjectState } from '../../../types.ts';

function setup(approve = true) {
  const stored = new Map<string, ProjectState>();
  let options: WorkspaceOptions = {
    project: null, selectedLayerIds: [], localProjects: [], activeLocalPath: null,
    storage: { type: 'indexeddb', isAvailable: () => true, ensureReady: async () => true, listProjects: async ({ page = 1, pageSize = 20, query = '' } = {}) => { const all = [...stored.values()].filter(project => project.title.includes(query)); return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length }; }, saveProject: async project => { stored.set(project.id, structuredClone(project)); }, deleteProject: async id => { stored.delete(id); } },
    onCommit: project => { options = { ...options, project }; }, onOpen: async project => { options = { ...options, project }; }, onUpsert: () => {}, onDelete: id => { if (options.project?.id === id) options = { ...options, project: null }; }, onSearch: () => {}, saveLocal: async () => {}
  };
  return { bridge: createWorkspaceBridge(() => options, async () => approve), stored, signal: new AbortController().signal, options, setReadLocal: (readLocal: WorkspaceOptions['readLocal']) => { options = { ...options, readLocal }; } };
}

test('project create, search, rename, duplicate, open and save use real storage', async () => {
  const { bridge, stored, signal } = setup();
  await bridge.manageProjects({ action: 'create', title: 'Launch' }, signal);
  const first = bridge.getProject()!;
  assert.match(first.id, /^[0-9a-z]{9}$/);
  first.layers.push({ id: 'source01', name: 'Title', type: 'text', content: 'Launch', x: 0, y: 0, width: 100, height: 50, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 });
  await bridge.commit(first);
  await bridge.manageProjects({ action: 'rename', projectId: first.id, title: 'Release' }, signal);
  const list = await bridge.manageProjects({ action: 'list', query: 'Release' }, signal) as { total: number };
  assert.equal(list.total, 1);
  await bridge.manageProjects({ action: 'duplicate', projectId: first.id }, signal);
  assert.equal(stored.size, 2);
  const copy = [...stored.values()].find(project => project.id !== first.id)!;
  assert.match(copy.id, /^[0-9a-z]{9}$/);
  assert.equal(copy.layers.length, 1);
  assert.match(copy.layers[0].id, /^[0-9a-z]{9}$/);
  assert.notEqual(copy.layers[0].id, first.layers[0].id);
  await bridge.manageProjects({ action: 'open', projectId: copy.id }, signal);
  await bridge.manageProjects({ action: 'save', projectId: copy.id }, signal);
  assert.equal(bridge.getProject()!.id, copy.id);
});

test('cancelled deletion leaves the project untouched', async () => {
  const { bridge, stored, signal } = setup(false);
  await bridge.manageProjects({ action: 'create', title: 'Keep' }, signal);
  await assert.rejects(bridge.manageProjects({ action: 'delete', projectId: bridge.getProject()!.id }, signal), /cancelled/);
  assert.equal(stored.size, 1);
});

test('confirmed deletion clears the current project', async () => {
  const { bridge, stored, signal } = setup();
  await bridge.manageProjects({ action: 'create', title: 'Delete' }, signal);
  await bridge.manageProjects({ action: 'delete', projectId: bridge.getProject()!.id }, signal);
  assert.equal(stored.size, 0);
  assert.equal(bridge.getProject(), null);
});

test('storage failures propagate rather than report success', async () => {
  const { bridge, stored, signal, options } = setup();
  options.storage.saveProject = async () => { throw new Error('Disk full'); };
  await assert.rejects(bridge.manageProjects({ action: 'create', title: 'Failed' }, signal), /Disk full/);
  assert.equal(stored.size, 0);
  assert.equal(bridge.getProject(), null);
});

test('project action contracts reject invalid fields before storage or UI side effects', async () => {
  const { bridge, stored, signal, options } = setup();
  await bridge.manageProjects({ action: 'create', title: 'Keep' }, signal);
  const projectId = bridge.getProject()!.id;
  const before = structuredClone(bridge.getProject());
  let effects = 0;
  options.storage.ensureReady = async () => { effects++; return true; };
  options.onSearch = () => { effects++; };
  const invalid = [
    { action: 'list', projectId }, { action: 'list', title: 'Ignored' },
    { action: 'list', page: 1.5 }, { action: 'list', query: ' ' },
    { action: 'create', projectId }, { action: 'create', width: 0 },
    { action: 'open' }, { action: 'rename', projectId },
    { action: 'rename', projectId, title: ' ' },
    { action: 'duplicate', projectId, width: 500 },
    { action: 'delete', projectId, title: 'Ignored' },
    { action: 'save', projectId, extra: true }
  ];
  for (const args of invalid) {
    await assert.rejects(bridge.manageProjects(args, signal), Error, JSON.stringify(args));
    assert.deepEqual(bridge.getProject(), before);
    assert.deepEqual([...stored.values()], [before]);
  }
  assert.equal(effects, 0);
});

test('reads another stored or local project without changing the active project', async () => {
  const { bridge, stored, signal, options, setReadLocal } = setup();
  await bridge.manageProjects({ action: 'create', title: 'Active' }, signal);
  const active = bridge.getProject()!;
  for (let index = 0; index < 51; index++) stored.set(`stored-${index}`, { ...active, id: `stored-${index}` });
  options.localProjects.push({ project: { ...active, id: 'local' }, localPath: 'local.cfj' });
  assert.equal((await bridge.getProjectById!('stored-50')).id, 'stored-50');
  assert.equal((await bridge.getProjectById!('local')).id, 'local');
  setReadLocal(async () => ({ ...active, id: 'local', title: 'Updated on disk' }));
  assert.equal((await bridge.getProjectById!('local')).title, 'Updated on disk');
  setReadLocal(async () => ({ ...active, id: 'replacement' }));
  await assert.rejects(bridge.getProjectById!('local'), /ID changed/);
  await assert.rejects(bridge.getProjectById!('missing'), /Project not found/);
  assert.equal(bridge.getProject()!.id, active.id);
});

test('project search does not return embedded background data', async () => {
  const { bridge, stored, signal } = setup();
  await bridge.manageProjects({ action: 'create', title: 'Image' }, signal);
  const project = bridge.getProject()!;
  const pageInfo = { ...project.pageInfo, background: { ...project.pageInfo.background, type: 'image' as const, value: 'data:image/png;base64,AQIDBA==' } };
  stored.clear();
  stored.set('other', { ...project, id: 'other', pageInfo, pages: project.pages!.map(page => ({ ...page, pageInfo })) });
  const result = await bridge.manageProjects({ action: 'list' }, signal) as { items: { canvas: unknown }[] };
  assert.deepEqual(result.items[0].canvas, { width: 1200, height: 630 });
  assert.doesNotMatch(JSON.stringify(result), /base64/);
});

test('active commits use the shared save coordinator and propagate its failures', async () => {
  const { bridge, options, signal } = setup();
  const writes: ProjectState[] = [];
  const error = new Error('Coordinator failed');
  options.saveActive = async project => { writes.push(project); throw error; };
  await bridge.manageProjects({ action: 'create', title: 'Active' }, signal);
  const changed = { ...bridge.getProject()!, title: 'Changed' };
  await assert.rejects(bridge.commit(changed), error);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].title, 'Changed');
});

test('deferred commits avoid immediate writes but explicit save and project switches flush changes', async () => {
  const { bridge, options, signal, stored } = setup();
  options.saveOnCommit = false;
  await bridge.manageProjects({ action: 'create', title: 'Initial' }, signal);
  const initial = bridge.getProject()!;
  await bridge.commit({ ...initial, title: 'First edit' });
  await bridge.commit({ ...bridge.getProject()!, title: 'Second edit' });
  assert.equal(stored.get(initial.id)?.title, 'Initial');
  await bridge.manageProjects({ action: 'save', projectId: initial.id }, signal);
  assert.equal(stored.get(initial.id)?.title, 'Second edit');

  await bridge.commit({ ...bridge.getProject()!, title: 'Before switch' });
  await bridge.manageProjects({ action: 'create', title: 'Other' }, signal);
  assert.equal(stored.get(initial.id)?.title, 'Before switch');
});

test('rejects a stale concurrent commit even before the UI publishes its new project', async () => {
  const { bridge, options, signal, stored } = setup();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  options.prepareCommit = async project => { if (project.title === 'Slow') await gate; return project; };
  options.onCommit = () => {};
  await bridge.manageProjects({ action: 'create', title: 'Initial' }, signal);
  const original = bridge.getProject()!;
  const slow = bridge.commit({ ...original, title: 'Slow' }).catch(error => error);
  await bridge.commit({ ...original, title: 'Fast' });
  release();
  assert.match((await slow).message, /changed while preparing/);
  assert.equal(stored.get(original.id)?.title, 'Fast');
});

test('manageProjects save supports optional versionInfo and rejects blank info', async () => {
  const { bridge, options, signal } = setup();
  const savedVersions: Array<{ projectId: string; info: string }> = [];
  options.saveVersion = async (project, info) => {
    savedVersions.push({ projectId: project.id, info });
    return {
      id: 'ver-1',
      projectId: project.id,
      info,
      createdAt: 123,
      title: project.title,
      pageCount: project.pages?.length ?? 1,
      width: project.pageInfo.width,
      height: project.pageInfo.height
    };
  };
  await bridge.manageProjects({ action: 'create', title: 'Versioned' }, signal);
  const projectId = bridge.getProject()!.id;

  const plainSave = await bridge.manageProjects({ action: 'save', projectId }, signal);
  assert.deepEqual(plainSave, { success: true, projectId });
  assert.equal(savedVersions.length, 0);

  const versionSave = await bridge.manageProjects({ action: 'save', projectId, versionInfo: '  Before hero tweak  ' }, signal);
  assert.deepEqual(versionSave, { success: true, projectId, versionId: 'ver-1', versionInfo: 'Before hero tweak' });
  assert.deepEqual(savedVersions, [{ projectId, info: 'Before hero tweak' }]);

  await assert.rejects(bridge.manageProjects({ action: 'save', projectId, versionInfo: '   ' }, signal), /Invalid versionInfo/);
});

test('manageProjects save embeds versions inside project data by default', async () => {
  const { bridge, stored, signal } = setup();
  await bridge.manageProjects({ action: 'create', title: 'Embedded' }, signal);
  const projectId = bridge.getProject()!.id;

  const result = await bridge.manageProjects({ action: 'save', projectId, versionInfo: 'Snapshot A' }, signal) as {
    success: boolean;
    projectId: string;
    versionId: string;
    versionInfo: string;
  };
  assert.equal(result.success, true);
  assert.equal(result.versionInfo, 'Snapshot A');

  const active = bridge.getProject()!;
  assert.equal(active.versions?.length, 1);
  assert.equal(active.versions?.[0].id, result.versionId);
  assert.equal(stored.get(projectId)?.versions?.length, 1);
});