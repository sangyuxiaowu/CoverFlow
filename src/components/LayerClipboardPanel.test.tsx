// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { ProjectState } from '../types.ts';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { LayerClipboard } from '../utils/layerClipboard.ts';
import LayerClipboardPanel from './LayerClipboardPanel.tsx';

it('shows live metadata and allows pasting, removing and clearing shared entries', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let project: ProjectState = syncProjectPages({ id: 'p', title: 'Source', layers: [{ id: 'a', name: 'Title', type: 'text', content: 'hello', x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 }], pageInfo: { ...({ width: 100, height: 100 }), background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } }, selectedLayerId: null, updatedAt: 0 });
  const clipboard = new LayerClipboard();
  const entry = { projectId: 'p', pageId: project.activePageId!, layerId: 'a' };
  await clipboard.copy([entry], async () => project);
  const bridge = { clipboard, getProject: () => project, getProjectById: async () => project, getSelection: () => [], commit: async (next: ProjectState) => { project = next; }, manageProjects: async () => ({}) };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<LayerClipboardPanel clipboard={clipboard} bridge={bridge} project={project} lang="zh" />));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="图层剪贴板"]')!.click());
    expect(host.textContent).toContain('Title');
    expect(host.textContent).toContain('Source');
    const paste = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('粘贴到当前页'))!;
    await act(async () => paste.click());
    expect(project.layers).toHaveLength(2);
    expect(clipboard.getSnapshot()).toHaveLength(1);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="移除 Title"]')!.click());
    expect(clipboard.getSnapshot()).toHaveLength(0);
    await act(async () => { await clipboard.copy([entry], async () => project); });
    const clear = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('清空'))!;
    await act(async () => clear.click());
    expect(host.textContent).toContain('剪贴板为空');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});