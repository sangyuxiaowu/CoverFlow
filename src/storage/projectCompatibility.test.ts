import { describe, expect, it } from 'vitest';
import type { ProjectState } from '../types.ts';
import { migrateProject, readProject, syncProjectPages, writeProject } from './projectCompatibility.ts';

const legacy: ProjectState = {
  id: 'legacy', title: 'Article', version: '8.0.0', layers: [], selectedLayerId: null, updatedAt: 123,
  background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#000', overlayOpacity: 0, overlayScale: 20 },
  canvasConfig: { width: 1200, height: 630, ratio: '40:21' }
};

describe('project format upgrades', () => {
  it('converts an old or unversioned project into its first page without mutating it', () => {
    for (const version of [undefined, '1.0.0', '8.0.0']) {
      const source = { ...legacy, version };
      const result = migrateProject(source);
      expect(result.version).toBe('9.0.0');
      expect(result.pages).toEqual([{ id: expect.stringMatching(/^[a-z0-9]{9}$/), name: '', layers: legacy.layers, background: legacy.background, canvasConfig: legacy.canvasConfig }]);
      expect(source).not.toHaveProperty('pages');
      expect(result.updatedAt).toBe(123);
    }
  });

  it('is idempotent and preserves newer version metadata', () => {
    const document = migrateProject(legacy);
    expect(migrateProject(document)).toEqual(document);
    expect(migrateProject({ ...document, version: '10.0.0' }).version).toBe('10.0.0');
  });

  it('does not silently repair malformed new-format projects', () => {
    expect(() => migrateProject({ ...legacy, version: '9.0.0' })).toThrow();
    const document = migrateProject(legacy);
    expect(() => migrateProject({ ...document, pages: [] })).toThrow();
    expect(() => migrateProject({ ...document, pages: [document.pages[0], document.pages[0]] })).toThrow();
    expect(() => migrateProject({ ...document, pages: Array.from({ length: 100 }, (_, index) => ({ ...document.pages[0], id: String(index) })) })).toThrow();
  });

  it('writes only document content and opens the first page', () => {
    const project = readProject(legacy);
    const second = { ...project.pages![0], id: 'second', name: 'Detail' };
    const multi = { ...project, pages: [...project.pages!, second], activePageId: 'second', background: { ...second.background, value: '#123456' } };
    const document = writeProject(multi);
    expect(document.pages[1].background.value).toBe('#123456');
    expect(document).not.toHaveProperty('layers');
    expect(document).not.toHaveProperty('activePageId');
    expect(readProject(document).activePageId).toBe(project.pages![0].id);
    expect(syncProjectPages(project).pages![0]).toBe(project.pages![0]);
  });

  it('initializes a newly created 9.0 editor project before persistence', () => {
    const document = writeProject({ ...legacy, version: '9.0.0' });
    expect(document.pages).toHaveLength(1);
    expect(readProject(document).layers).toEqual(legacy.layers);
  });
});