// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Layer, ProjectState } from '../types.ts';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { editLayers } from '../features/ai/domain/layerOperations.ts';
import { LayerClipboard } from '../utils/layerClipboard.ts';
import ArrangeLayersMenu, { analyzeLayerArrangement, type ArrangeAction } from './ArrangeLayersMenu.tsx';
import EditorHeader from './EditorHeader.tsx';

function makeLayer(id: string, zIndex: number, overrides: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id,
    type: 'text',
    content: id,
    x: zIndex * 40,
    y: 50,
    width: 100,
    height: 40,
    rotation: 0,
    zIndex,
    visible: true,
    locked: false,
    opacity: 1,
    ...overrides
  };
}

function makeProject(layers: Layer[]): ProjectState {
  return syncProjectPages({
    id: 'proj-1',
    title: 'Cover Test',
    layers,
    pageInfo: {
      width: 1000,
      height: 600,
      background: {
        type: 'color',
        value: '#0f172a',
        overlayType: 'none',
        overlayColor: '#ffffff',
        overlayOpacity: 0,
        overlayScale: 20
      }
    },
    selectedLayerId: null,
    updatedAt: 0
  });
}

describe('analyzeLayerArrangement', () => {
  it('computes stacking, alignment, distribute, group, and lock eligibility accurately', () => {
    const project = makeProject([
      makeLayer('l1', 1),
      makeLayer('l2', 2),
      makeLayer('l3', 3),
      makeLayer('l4', 4, { locked: true })
    ]);

    expect(analyzeLayerArrangement(project, [])).toMatchObject({
      hasSelection: false,
      canStackUp: false,
      canStackDown: false,
      canAlign: false,
      canDistribute: false,
      canGroup: false,
      canUngroup: false
    });

    // Bottom layer can only move up
    expect(analyzeLayerArrangement(project, ['l1'])).toMatchObject({
      hasSelection: true,
      canStackUp: true,
      canStackDown: false,
      canAlign: true,
      canDistribute: false,
      canGroup: false
    });

    // Two middle layers can stack, align, group, not distribute
    expect(analyzeLayerArrangement(project, ['l1', 'l2'])).toMatchObject({
      selectedCount: 2,
      canStackUp: true,
      canStackDown: false,
      canAlign: true,
      canDistribute: false,
      canGroup: true
    });

    // Three unlocked independent layers enable distribution
    expect(analyzeLayerArrangement(project, ['l1', 'l2', 'l3'])).toMatchObject({
      selectedCount: 3,
      canStackUp: true,
      canStackDown: false,
      canAlign: true,
      canDistribute: true,
      canGroup: true
    });

    // Locked selection disables all actions
    expect(analyzeLayerArrangement(project, ['l2', 'l4'])).toMatchObject({
      hasLocked: true,
      canStackUp: false,
      canStackDown: false,
      canAlign: false,
      canDistribute: false,
      canGroup: false
    });
  });

  it('deduplicates children when their parent group is also selected', () => {
    const project = makeProject([
      makeLayer('c1', 1, { parentId: 'g1' }),
      makeLayer('c2', 2, { parentId: 'g1' }),
      makeLayer('g1', 3, { type: 'group', content: '', children: ['c1', 'c2'] }),
      makeLayer('l4', 4)
    ]);

    const analysis = analyzeLayerArrangement(project, ['g1', 'c1', 'c2']);
    expect(analysis.independentIds).toEqual(['g1']);
    expect(analysis.canDistribute).toBe(false);
    expect(analysis.canStackUp).toBe(true);
    expect(analysis.canStackDown).toBe(false);
  });

  it('uses the group as a unit for stacking boundaries', () => {
    const project = makeProject([
      makeLayer('c1', 1, { parentId: 'g1' }),
      makeLayer('c2', 2, { parentId: 'g1' }),
      makeLayer('other', 3),
      makeLayer('g1', 4, { type: 'group', children: ['c1', 'c2'] })
    ]);
    expect(analyzeLayerArrangement(project, ['g1'])).toMatchObject({ canStackUp: true, canStackDown: false });
    const moved = editLayers(project, 'forward', ['g1']);
    expect(analyzeLayerArrangement(moved, ['g1'])).toMatchObject({ canStackUp: false, canStackDown: true });
  });
});

describe('ArrangeLayersMenu UI', () => {
  it('invokes multi-layer stacking, align, distribute and group actions cleanly', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let project = makeProject([
      makeLayer('a', 1, { x: 0 }),
      makeLayer('b', 2, { x: 100 }),
      makeLayer('c', 3, { x: 600 }),
      makeLayer('d', 4, { x: 700 })
    ]);
    let selected = ['a', 'b', 'c'];

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    const handleAction = (action: ArrangeAction, mode?: string) => {
      const ids = action === 'group' ? selected : analyzeLayerArrangement(project, selected).independentIds;
      project = editLayers(project, action, ids, {}, mode);
      if (action === 'group' && project.selectedLayerId) {
        selected = [project.selectedLayerId];
      }
    };

    try {
      await act(async () => {
        root.render(
          <ArrangeLayersMenu project={project} selectedLayerIds={selected} lang="zh" onAction={handleAction} />
        );
      });

      const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="图层堆叠与排列"]')!;
      expect(trigger.textContent).toContain('3');
      await act(async () => trigger.click());

      const findBtn = (label: string) =>
        [...host.querySelectorAll('button')].find((btn) => btn.textContent?.includes(label))!;

      // Multi-select Bring Forward moves a,b,c past d while preserving relative order
      await act(async () => findBtn('上移一层').click());
      const orderedAfterForward = [...project.layers]
        .sort((x, y) => x.zIndex - y.zIndex)
        .map((l) => l.id);
      expect(orderedAfterForward).toEqual(['d', 'a', 'b', 'c']);

      // Distribute horizontally evenly spaces a, b, c between 0 and 700
      await act(async () => findBtn('水平等距').click());
      const bAfterDistribute = project.layers.find((l) => l.id === 'b')!;
      expect(bAfterDistribute.x).toBe(300);

      // Center align horizontally moves all 3 layers to canvas center (450)
      await act(async () => findBtn('水平居中').click());
      expect(project.layers.find((l) => l.id === 'a')!.x).toBe(450);
      expect(project.layers.find((l) => l.id === 'c')!.x).toBe(450);

      // Re-render with updated project and group
      await act(async () => {
        root.render(
          <ArrangeLayersMenu project={project} selectedLayerIds={selected} lang="zh" onAction={handleAction} />
        );
      });
      await act(async () => findBtn('组合').click());
      expect(project.layers.some((l) => l.type === 'group')).toBe(true);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});

describe('EditorHeader', () => {
  it('renders consolidated 3-zone header and opens More menu actions', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const project = makeProject([makeLayer('a', 1)]);
    const clipboard = new LayerClipboard();
    const bridge = {
      clipboard,
      getProject: () => project,
      getSelection: () => ['a'],
      commit: async () => {},
      manageProjects: async () => ({})
    };
    const onPreview = vi.fn();
    const onExportProject = vi.fn();
    const onExportImage = vi.fn();
    const onSave = vi.fn();
    const onOpenVersions = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      const renderHeader = async (saveStatus: 'saved' | 'unsaved' | 'saving' | 'error') => {
        await act(async () => {
          root.render(
            <EditorHeader
              lang="en"
              project={project}
              selectedLayerIds={['a']}
              exitingEditor={false}
              onBack={() => {}}
              onTitleChange={() => {}}
              canUndo={true}
              canRedo={false}
              onUndo={() => {}}
              onRedo={() => {}}
              onArrangeAction={() => {}}
              layerClipboard={clipboard}
              clipboardBridge={bridge}
              saveStatus={saveStatus}
              lastSavedAt={null}
              onSave={onSave}
              onOpenVersions={onOpenVersions}
              isAiOpen={false}
              aiBusy={false}
              onToggleAi={() => {}}
              onPreview={onPreview}
              onExportProject={onExportProject}
              onExportImage={onExportImage}
              isExporting={false}
            />
          );
        });
      };

      await renderHeader('unsaved');
      expect(host.querySelector('.animate-ping')).toBeNull();
      expect(host.querySelector('[role="status"]')).toBeNull();
      expect(host.textContent).not.toContain('Unsaved');
      const saveBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Save Project"]')!;
      expect(saveBtn.querySelector('[data-save-status="unsaved"]')?.className).toContain('bg-amber-400');

      await renderHeader('error');
      expect(saveBtn.querySelector('[data-save-status="error"]')?.className).toContain('bg-red-500');

      await renderHeader('saving');
      expect(saveBtn.querySelector('[data-save-status="saving"]')?.className).toContain('bg-blue-400');

      await renderHeader('saved');
      expect(saveBtn.querySelector('[data-save-status]')).toBeNull();

      await act(async () => saveBtn.click());
      expect(onSave).toHaveBeenCalledTimes(1);

      await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Version History"]')!.click());
      expect(onOpenVersions).toHaveBeenCalledTimes(1);

      // More menu exposes Preview and Export Project (.cfjx) without header clutter
      await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="More project actions"]')!.click());
      const previewItem = [...host.querySelectorAll('[role="menuitem"]')].find((el) =>
        el.textContent?.includes('Full-screen project preview')
      ) as HTMLButtonElement;
      await act(async () => previewItem.click());
      expect(onPreview).toHaveBeenCalledTimes(1);

      await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="More project actions"]')!.click());
      const exportProjItem = [...host.querySelectorAll('[role="menuitem"]')].find((el) =>
        el.textContent?.includes('Export Project')
      ) as HTMLButtonElement;
      await act(async () => exportProjItem.click());
      expect(onExportProject).toHaveBeenCalledTimes(1);

      const exportImgBtn = [...host.querySelectorAll('button')].find((btn) =>
        btn.textContent?.includes('Export Image')
      )!;
      await act(async () => exportImgBtn.click());
      expect(onExportImage).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
