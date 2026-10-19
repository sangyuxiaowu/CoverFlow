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
  return { bridge: createWorkspaceBridge(() => options, async () => approve), stored, signal: new AbortController().signal, options };
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