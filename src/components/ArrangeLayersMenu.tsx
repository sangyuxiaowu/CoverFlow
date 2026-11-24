import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Group,
  Layers,
  Ungroup
} from 'lucide-react';
import type { Layer, ProjectState } from '../types.ts';
import { translations, type Language } from '../translations.ts';
import { stackingUnits } from '../features/ai/domain/layerOperations.ts';

export type ArrangeAction = 'front' | 'forward' | 'backward' | 'back' | 'align' | 'distribute' | 'group' | 'ungroup';

export interface LayerArrangementState {
  selectedCount: number;
  selectedIds: string[];
  independentIds: string[];
  hasSelection: boolean;
  hasLocked: boolean;
  canStackUp: boolean;
  canStackDown: boolean;
  canAlign: boolean;
  canDistribute: boolean;
  canGroup: boolean;
  canUngroup: boolean;
}

export function analyzeLayerArrangement(
  project: ProjectState,
  selectedLayerIds: readonly string[]
): LayerArrangementState {
  const layerMap = new Map(project.layers.map((layer) => [layer.id, layer]));
  const selectedIds = Array.from(new Set(selectedLayerIds)).filter((id) => layerMap.has(id));
  const selectedLayers = selectedIds
    .map((id) => layerMap.get(id))
    .filter((layer): layer is Layer => Boolean(layer));
  const selectedSet = new Set(selectedIds);
  const expandedIds = new Set(selectedLayers.flatMap((layer) => [layer.id, ...(layer.children || [])]));
  const independentIds = selectedLayers
    .filter((layer) => !layer.parentId || !selectedSet.has(layer.parentId))
    .map((layer) => layer.id);

  const hasSelection = selectedLayers.length > 0;
  const hasLocked = project.layers.some(
    (layer) =>
      expandedIds.has(layer.id) &&
      (layer.locked || Boolean(layer.parentId && layerMap.get(layer.parentId)?.locked))
  );

  const ordered = stackingUnits(project.layers, selectedSet);
  const canMoveUp = ordered.some(
    (unit, index) => index < ordered.length - 1 && unit.some(layer => expandedIds.has(layer.id)) && !ordered[index + 1].some(layer => expandedIds.has(layer.id))
  );
  const canMoveDown = ordered.some(
    (unit, index) => index > 0 && unit.some(layer => expandedIds.has(layer.id)) && !ordered[index - 1].some(layer => expandedIds.has(layer.id))
  );

  return {
    selectedCount: selectedLayers.length,
    selectedIds,
    independentIds,
    hasSelection,
    hasLocked,
    canStackUp: hasSelection && !hasLocked && canMoveUp,
    canStackDown: hasSelection && !hasLocked && canMoveDown,
    canAlign: hasSelection && !hasLocked,
    canDistribute: !hasLocked && independentIds.length >= 3,
    canGroup: !hasLocked && selectedLayers.length >= 2 && selectedLayers.every((layer) => !layer.parentId && layer.type !== 'group'),
    canUngroup: !hasLocked && selectedLayers.length >= 1 && selectedLayers.every((layer) => layer.type === 'group')
  };
}

interface ArrangeLayersMenuProps {
  project: ProjectState;
  selectedLayerIds: string[];
  lang: Language;
  onAction: (action: ArrangeAction, mode?: string) => void;
}

const ALIGN_OPTIONS: Array<{
  mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
  labelKey: 'alignLeft' | 'alignCenterH' | 'alignRight' | 'alignTop' | 'alignMiddleV' | 'alignBottom';
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { mode: 'left', labelKey: 'alignLeft', Icon: AlignStartVertical },
  { mode: 'center', labelKey: 'alignCenterH', Icon: AlignCenterVertical },
  { mode: 'right', labelKey: 'alignRight', Icon: AlignEndVertical },
  { mode: 'top', labelKey: 'alignTop', Icon: AlignStartHorizontal },
  { mode: 'middle', labelKey: 'alignMiddleV', Icon: AlignCenterHorizontal },
  { mode: 'bottom', labelKey: 'alignBottom', Icon: AlignEndHorizontal }
];

export default function ArrangeLayersMenu({
  project,
  selectedLayerIds,
  lang,
  onAction
}: ArrangeLayersMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const t = translations[lang];

  const state = useMemo(
    () => analyzeLayerArrangement(project, selectedLayerIds),
    [project, selectedLayerIds]
  );

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const selectionSummary = state.hasSelection
    ? t.arrangeSelectedCount.replace('{count}', String(state.selectedCount))
    : t.arrangeSelectHint;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        title={t.arrangeLayersTitle}
        aria-label={t.arrangeLayersTitle}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={`h-8 inline-flex items-center gap-2 px-2.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          open
            ? 'bg-blue-500/15 border-blue-500/50 text-blue-300'
            : state.selectedCount >= 2
              ? 'bg-slate-800/90 hover:bg-slate-700/90 border-blue-500/40 text-slate-100'
              : state.hasSelection
                ? 'bg-slate-800/90 hover:bg-slate-700/90 border-slate-700 text-slate-200'
                : 'bg-slate-800/60 hover:bg-slate-800 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200'
        }`}
      >
        <Layers className={`w-3.5 h-3.5 shrink-0 ${state.hasSelection && !open ? 'text-blue-400' : ''}`} />
        <span className="hidden lg:inline">{t.arrangeLayers}</span>
        {state.hasSelection && (
          <>
            <span aria-hidden="true" className="w-px h-3 bg-slate-700" />
            <span className="font-mono text-[11px] tabular-nums text-blue-300">{state.selectedCount}</span>
          </>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t.arrangeLayersTitle}
          className="absolute left-1/2 -translate-x-1/2 top-full mt-2.5 w-[328px] max-w-[calc(100vw-24px)] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/75 overflow-hidden z-[100] text-xs"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-xs font-bold text-slate-100 truncate">{t.arrangeLayersTitle}</h3>
              <p className="text-[11px] text-slate-400 tabular-nums mt-0.5 truncate">{selectionSummary}</p>
            </div>
            {state.selectedCount >= 2 && !state.hasLocked && (
              <span className="font-mono text-[11px] tabular-nums text-blue-300 shrink-0">
                {state.selectedCount}×
              </span>
            )}
          </div>

          {state.hasLocked && (
            <div
              role="status"
              className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2 text-[11px] text-amber-300"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              <span className="truncate">{t.arrangeLockedHint}</span>
            </div>
          )}

          {/* Stacking Order */}
          <div className="px-4 py-3 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {t.arrangeStackingSection}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={!state.canStackUp}
                onClick={() => onAction('front')}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-slate-800 bg-slate-950/50 hover:bg-slate-800 hover:border-slate-700 text-slate-200 transition-colors disabled:opacity-35 disabled:pointer-events-none whitespace-nowrap"
              >
                <ArrowUpToLine className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{t.bringToFront}</span>
              </button>
              <button
                type="button"
                disabled={!state.canStackUp}
                onClick={() => onAction('forward')}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-slate-800 bg-slate-950/50 hover:bg-slate-800 hover:border-slate-700 text-slate-200 transition-colors disabled:opacity-35 disabled:pointer-events-none whitespace-nowrap"
              >
                <ArrowUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{t.bringForward}</span>
              </button>
              <button
                type="button"
                disabled={!state.canStackDown}
                onClick={() => onAction('backward')}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-slate-800 bg-slate-950/50 hover:bg-slate-800 hover:border-slate-700 text-slate-200 transition-colors disabled:opacity-35 disabled:pointer-events-none whitespace-nowrap"
              >
                <ArrowDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{t.sendBackward}</span>
              </button>
              <button
                type="button"
                disabled={!state.canStackDown}
                onClick={() => onAction('back')}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-slate-800 bg-slate-950/50 hover:bg-slate-800 hover:border-slate-700 text-slate-200 transition-colors disabled:opacity-35 disabled:pointer-events-none whitespace-nowrap"
              >
                <ArrowDownToLine className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{t.sendToBack}</span>
              </button>
            </div>
          </div>

          {/* Align to Canvas */}
          <div className="px-4 py-3 border-t border-slate-800 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {t.arrangeAlignSection}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {ALIGN_OPTIONS.map(({ mode, labelKey, Icon }) => {
                const label = t[labelKey];
                return (
                  <button
                    key={mode}
                    type="button"
                    disabled={!state.canAlign}
                    title={label}
                    aria-label={label}
                    onClick={() => onAction('align', mode)}
                    className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-slate-800 bg-slate-950/50 hover:bg-slate-800 hover:border-slate-700 text-slate-200 transition-colors disabled:opacity-35 disabled:pointer-events-none whitespace-nowrap"
                  >
                    <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-[11px] truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Distribute */}
          <div className="px-4 py-3 border-t border-slate-800 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {t.arrangeDistributeSection}
              </span>
              {!state.canDistribute && !state.hasLocked && (
                <span className="text-[10px] text-slate-500 truncate">{t.distributeHint}</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={!state.canDistribute}
                onClick={() => onAction('distribute', 'horizontal')}
                className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border border-slate-800 bg-slate-950/50 hover:bg-slate-800 hover:border-slate-700 text-slate-200 transition-colors disabled:opacity-35 disabled:pointer-events-none whitespace-nowrap"
              >
                <AlignHorizontalSpaceBetween className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{t.distributeHorizontal}</span>
              </button>
              <button
                type="button"
                disabled={!state.canDistribute}
                onClick={() => onAction('distribute', 'vertical')}
                className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border border-slate-800 bg-slate-950/50 hover:bg-slate-800 hover:border-slate-700 text-slate-200 transition-colors disabled:opacity-35 disabled:pointer-events-none whitespace-nowrap"
              >
                <AlignVerticalSpaceBetween className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{t.distributeVertical}</span>
              </button>
            </div>
          </div>

          {/* Group / Ungroup */}
          <div className="px-4 py-3 border-t border-slate-800 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {t.arrangeGroupSection}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={!state.canGroup}
                onClick={() => onAction('group')}
                className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border border-slate-800 bg-slate-950/50 hover:bg-slate-800 hover:border-slate-700 text-slate-200 transition-colors disabled:opacity-35 disabled:pointer-events-none whitespace-nowrap"
              >
                <Group className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{t.groupLayers}</span>
              </button>
              <button
                type="button"
                disabled={!state.canUngroup}
                onClick={() => onAction('ungroup')}
                className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border border-slate-800 bg-slate-950/50 hover:bg-slate-800 hover:border-slate-700 text-slate-200 transition-colors disabled:opacity-35 disabled:pointer-events-none whitespace-nowrap"
              >
                <Ungroup className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{t.ungroupLayers}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
