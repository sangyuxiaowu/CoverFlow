import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Download,
  FileOutput,
  History,
  LoaderCircle,
  MoreHorizontal,
  Redo2,
  Save,
  Undo2
} from 'lucide-react';
import type { WorkspaceBridge } from '../features/ai/types.ts';
import ArrangeLayersMenu, { type ArrangeAction } from './ArrangeLayersMenu.tsx';
import LayerClipboardPanel from './LayerClipboardPanel.tsx';
import { translations, type Language } from '../translations.ts';
import type { ProjectSaveStatus, ProjectState } from '../types.ts';
import type { LayerClipboard } from '../utils/layerClipboard.ts';

interface EditorHeaderProps {
  lang: Language;
  project: ProjectState;
  selectedLayerIds: string[];
  exitingEditor: boolean;
  onBack: () => void;
  onTitleChange: (title: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onArrangeAction: (action: ArrangeAction, mode?: string) => void;
  layerClipboard: LayerClipboard;
  clipboardBridge: WorkspaceBridge;
  saveStatus: ProjectSaveStatus;
  lastSavedAt: number | null;
  onSave: () => void;
  onOpenVersions: () => void;
  isAiOpen: boolean;
  aiBusy: boolean;
  onToggleAi: () => void;
  onExportProject: () => void;
  onExportImage: () => void;
  isExporting: boolean;
}

export default function EditorHeader({
  lang,
  project,
  selectedLayerIds,
  exitingEditor,
  onBack,
  onTitleChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onArrangeAction,
  layerClipboard,
  clipboardBridge,
  saveStatus,
  lastSavedAt,
  onSave,
  onOpenVersions,
  isAiOpen,
  aiBusy,
  onToggleAi,
  onExportProject,
  onExportImage,
  isExporting
}: EditorHeaderProps) {
  const t = translations[lang];
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [moreOpen]);

  const aiLabel = lang === 'en' ? 'AI Assistant' : 'AI 助手';
  const saveStatusText = saveStatus === 'saving'
    ? t.saveStatusSaving
    : saveStatus === 'unsaved'
      ? t.saveStatusUnsaved
      : saveStatus === 'error'
        ? t.saveStatusError
        : t.saveStatusSaved;

  return (
    <header className="h-14 border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm flex items-center justify-between gap-3 px-4 z-50">
      {/* Left Zone: Back + Title + Quiet Save Status */}
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <button
          type="button"
          disabled={exitingEditor}
          onClick={onBack}
          className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors shrink-0 disabled:opacity-40 cursor-pointer"
          aria-label={t.backToLanding}
          title={t.backToLanding}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div aria-hidden="true" className="w-px h-4 bg-slate-800 shrink-0" />

        <div className="inline-grid items-center min-w-[60px] max-w-[220px]">
          <span className="invisible col-start-1 row-start-1 px-2 py-1 font-semibold text-sm whitespace-pre truncate pointer-events-none">
            {project.title || ' '}
          </span>
          <input
            value={project.title}
            onChange={(e) => onTitleChange(e.target.value)}
            aria-label={t.untitled}
            className="col-start-1 row-start-1 bg-transparent font-semibold text-sm text-slate-100 outline-none hover:bg-slate-800/80 focus:bg-slate-800 rounded-md px-2 py-1 w-full min-w-0 transition-colors"
          />
        </div>
      </div>

      {/* Center Zone: History + Arrange & Stacking + Clipboard */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="inline-flex items-center h-8 rounded-lg border border-slate-800 bg-slate-950/60 divide-x divide-slate-800 overflow-hidden shrink-0">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label={`${t.undo} (Ctrl+Z)`}
            title={`${t.undo} (Ctrl+Z)`}
            className="w-8 h-full inline-flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label={`${t.redo} (Ctrl+Shift+Z)`}
            title={`${t.redo} (Ctrl+Shift+Z)`}
            className="w-8 h-full inline-flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div aria-hidden="true" className="w-px h-4 bg-slate-800 mx-0.5 shrink-0" />

        <ArrangeLayersMenu
          project={project}
          selectedLayerIds={selectedLayerIds}
          lang={lang}
          onAction={onArrangeAction}
        />

        <LayerClipboardPanel
          clipboard={layerClipboard}
          bridge={clipboardBridge}
          project={project}
          lang={lang}
        />
      </div>

      {/* Right Zone: Save/Versions + AI + Project Menu + Export CTA */}
      <div className="flex items-center justify-end gap-2 flex-1 min-w-0">
        <div className="inline-flex items-center h-8 rounded-lg border border-slate-700/80 bg-slate-800/70 divide-x divide-slate-700/80 shrink-0">
          <button
            type="button"
            onClick={onSave}
            disabled={saveStatus === 'saving' || exitingEditor}
            title={
              saveStatus !== 'saved'
                ? `${t.save} · ${saveStatusText}`
                : lastSavedAt
                  ? `${t.save} · ${t.lastSavedAt}: ${new Date(lastSavedAt).toLocaleTimeString()}`
                  : t.save
            }
            aria-label={t.save}
            className="relative h-full px-2.5 rounded-l-lg inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700/80 hover:text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden md:inline">{t.saveShort}</span>
            {saveStatus !== 'saved' && (
              <span
                aria-hidden="true"
                data-save-status={saveStatus}
                className={`absolute top-1 right-1 w-2 h-2 rounded-full pointer-events-none ${
                  saveStatus === 'error'
                    ? 'bg-red-500'
                    : saveStatus === 'saving'
                      ? 'bg-blue-400'
                      : 'bg-amber-400'
                }`}
              />
            )}
          </button>
          <button
            type="button"
            onClick={onOpenVersions}
            disabled={exitingEditor}
            title={t.versionHistory}
            aria-label={t.versionHistory}
            className="h-full px-2.5 rounded-r-lg inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700/80 hover:text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
          >
            <History className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden md:inline">{t.versions}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onToggleAi}
          title={aiLabel}
          aria-label={aiLabel}
          aria-expanded={isAiOpen}
          className={`h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            isAiOpen
              ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
              : 'bg-slate-800/70 hover:bg-slate-700/80 border-slate-700/80 hover:border-emerald-500/40 text-slate-300 hover:text-white'
          }`}
        >
          {aiBusy ? (
            <LoaderCircle className="w-3.5 h-3.5 text-emerald-400 animate-spin shrink-0" />
          ) : (
            <Bot className={`w-3.5 h-3.5 shrink-0 ${isAiOpen ? 'text-emerald-400' : 'text-emerald-500'}`} />
          )}
          <span className="hidden lg:inline">{aiLabel}</span>
        </button>

        <div ref={moreRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMoreOpen((prev) => !prev)}
            title={t.moreActions}
            aria-label={t.moreActions}
            aria-expanded={moreOpen}
            className={`h-8 w-8 inline-flex items-center justify-center rounded-lg border transition-colors cursor-pointer ${
              moreOpen
                ? 'bg-slate-700 border-slate-600 text-white'
                : 'bg-slate-800/70 hover:bg-slate-700/80 border-slate-700/80 text-slate-300 hover:text-white'
            }`}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {moreOpen && (
            <div
              role="menu"
              aria-label={t.moreActions}
              className="absolute right-0 top-full mt-2 w-48 bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl shadow-black/75 py-1.5 z-[100] text-xs"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false);
                  onExportProject();
                }}
                className="w-full px-3 py-2 text-left flex items-center gap-2.5 text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                <FileOutput className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>{t.exportJson} (.cfjx)</span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onExportImage}
          disabled={isExporting}
          className="h-8 px-3.5 inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-semibold rounded-lg text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
        >
          {isExporting ? (
            <LoaderCircle className="w-3.5 h-3.5 animate-spin shrink-0" />
          ) : (
            <Download className="w-3.5 h-3.5 shrink-0" />
          )}
          <span>{t.export}</span>
        </button>
      </div>
    </header>
  );
}
