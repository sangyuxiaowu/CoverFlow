import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardCopy, Copy, Download, Eye, FileImage, ListChecks, X } from 'lucide-react';
import { ProjectState } from '../types.ts';
import { translations, Language } from '../translations.ts';
import LivePreview from './LivePreview.tsx';
import PagesPanel from './PagesPanel.tsx';
import type { PageExportSettings } from '../utils/exportPages.ts';

export type ExportSettings = PageExportSettings;
export type ExportRange = 'current' | 'multiple' | 'all';

interface ExportModalProps {
  isOpen: boolean;
  lang: Language;
  project: ProjectState;
  previewUrl?: string | null;
  settings: ExportSettings;
  estimatedSize: number | null;
  estimating: boolean;
  onChange: (updates: Partial<ExportSettings>) => void;
  onClose: () => void;
  onConfirm: () => void;
  onCopyBase64: () => void;
  onCopyImage: () => void;
  range: ExportRange;
  onRangeChange: (range: ExportRange) => void;
  selectedPageIds: string[];
  onSelectedPagesChange: (ids: string[]) => void;
  onPageChange: (id: string) => void;
  thumbnails: Record<string, string>;
  busy?: boolean;
  progress?: { done: number; total: number } | null;
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
};

const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  lang,
  project,
  previewUrl,
  settings,
  estimatedSize,
  estimating,
  onChange,
  onClose,
  onConfirm,
  onCopyBase64,
  onCopyImage,
  range,
  onRangeChange,
  selectedPageIds,
  onSelectedPagesChange,
  onPageChange,
  thumbnails,
  busy = false,
  progress
}) => {
  const [leftView, setLeftView] = useState<'preview' | 'pages'>('preview');
  useEffect(() => { setLeftView(range !== 'current' ? 'pages' : 'preview'); }, [isOpen, range]);
  if (!isOpen) return null;
  const t = translations[lang];
  const isSvg = settings.format === 'svg';
  const isPng = settings.format === 'png';
  const isPpt = settings.format === 'pptx';
  const pages = project.pages ?? [];
  const selectedIds = range === 'all' ? pages.map(page => page.id) : selectedPageIds.filter(id => pages.some(page => page.id === id));
  const previewPages = range === 'current' ? pages : pages.filter(page => selectedIds.includes(page.id));
  const pageIndex = Math.max(0, previewPages.findIndex(page => page.id === project.activePageId));
  const hasPreviewPage = range === 'current' || previewPages.some(page => page.id === project.activePageId);
  const openPreview = () => {
    if (range !== 'current' && !selectedIds.includes(project.activePageId ?? '') && previewPages.length) onPageChange(previewPages[0].id);
    setLeftView('preview');
  };
  const updateSelectedPages = (ids: string[]) => {
    onSelectedPagesChange(ids);
    if (range === 'all') onRangeChange('multiple');
    if (leftView === 'preview' && !ids.includes(project.activePageId ?? '')) {
      const first = pages.find(page => ids.includes(page.id));
      if (first) onPageChange(first.id);
    }
  };

  const outputWidth = isSvg
    ? project.canvasConfig.width
    : Math.round(project.canvasConfig.width * settings.pixelRatio);
  const outputHeight = isSvg
    ? project.canvasConfig.height
    : Math.round(project.canvasConfig.height * settings.pixelRatio);

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        role="dialog" aria-modal="true" aria-label={t.exportSettingsTitle}
        className="w-full max-w-3xl max-h-[92dvh] overflow-y-auto bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <FileImage className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-bold tracking-wide text-slate-100">
              {t.exportSettingsTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Two-Column Body */}
        <div className="grid grid-cols-1 md:grid-cols-12">
          {/* Left Column: Live Export Result Preview */}
          <div className="md:col-span-6 min-h-0 p-6 border-b md:border-b-0 md:border-r border-slate-800/80 bg-slate-950/30 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button type="button" title={t.decorationPreview} aria-label={t.decorationPreview} aria-pressed={leftView === 'preview'} disabled={busy || (range !== 'current' && !previewPages.length)} onClick={openPreview} className={`p-1.5 rounded disabled:opacity-30 disabled:cursor-not-allowed ${leftView === 'preview' ? 'bg-slate-800 text-blue-400' : 'text-slate-500'}`}><Eye className="w-4 h-4" /></button>
                {range !== 'current' && <button type="button" title={t.pages} aria-label={t.pages} aria-pressed={leftView === 'pages'} onClick={() => setLeftView('pages')} className={`p-1.5 rounded ${leftView === 'pages' ? 'bg-slate-800 text-blue-400' : 'text-slate-500'}`}><ListChecks className="w-4 h-4" /></button>}
              </div>
              {leftView === 'pages' && range !== 'current' ? <div className="flex items-center gap-3 text-xs">
                <span aria-live="polite" aria-atomic="true" className="font-mono tabular-nums text-slate-400">{selectedIds.length}/{pages.length}</span>
                <button type="button" disabled={busy} onClick={() => updateSelectedPages(pages.map(page => page.id))} className="text-blue-400 hover:text-blue-300 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40">{t.selectAllPages}</button>
                <button type="button" disabled={busy} onClick={() => updateSelectedPages(pages.filter(page => !selectedIds.includes(page.id)).map(page => page.id))} className="text-slate-400 hover:text-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-40">{t.invertPages}</button>
              </div> : hasPreviewPage && <span className="text-xs font-mono tabular-nums text-slate-400">
                {outputWidth} × {outputHeight} {isSvg ? 'SVG' : 'px'}
              </span>}
            </div>

            <div className={`relative w-full ${leftView === 'pages' ? 'h-[360px] min-h-0 shrink-0' : 'h-56 p-3 rounded-lg border border-slate-800/90 bg-slate-950'} overflow-hidden flex items-center justify-center`}>
              {leftView === 'pages' ? <div className="w-full h-full" inert={busy}><PagesPanel lang={lang} pages={pages} activePageId={project.activePageId} thumbnails={thumbnails} selectedIds={selectedIds} onSelectionChange={updateSelectedPages} /></div> : !hasPreviewPage ? <span className="text-xs text-slate-500">{t.noSelectedPages}</span> : previewUrl ? (
                <img
                  src={previewUrl}
                  alt={project.title}
                  referrerPolicy="no-referrer"
                  className={`max-w-full max-h-full object-contain shadow-2xl transition-opacity duration-150 ${
                    estimating ? 'opacity-65' : 'opacity-100'
                  }`}
                />
              ) : (
                <div className="w-full h-full">
                  <LivePreview project={project} />
                </div>
              )}
            </div>

            {leftView === 'preview' && hasPreviewPage && (previewPages.length > 1 || (range !== 'current' && previewPages.length === 1)) && <div role="group" aria-label={t.pages} className="inline-flex self-center items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/70 p-1">
              <button type="button" title={t.previousPage} aria-label={t.previousPage} disabled={busy || pageIndex === 0} onClick={() => onPageChange(previewPages[pageIndex - 1].id)} className="flex h-8 w-8 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-blue-400 cursor-pointer disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-transparent"><ChevronLeft className="h-4 w-4" /></button>
              <span aria-live="polite" aria-atomic="true" className="min-w-14 text-center text-xs font-mono tabular-nums text-slate-200">{pageIndex + 1}/{previewPages.length}</span>
              <button type="button" title={t.nextPage} aria-label={t.nextPage} disabled={busy || pageIndex === previewPages.length - 1} onClick={() => onPageChange(previewPages[pageIndex + 1].id)} className="flex h-8 w-8 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-blue-400 cursor-pointer disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-transparent"><ChevronRight className="h-4 w-4" /></button>
            </div>}

            {leftView === 'preview' && hasPreviewPage && !isPpt && <div className="flex items-center justify-between pt-1">
              <span className="text-xs font-medium text-slate-400">
                {t.exportEstimatedSize}
              </span>
              <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                <span className="text-slate-500 uppercase">{settings.format}</span>
                <span className="text-slate-700" aria-hidden="true">·</span>
                <span className="text-sm font-semibold text-slate-100">
                  {busy && progress ? `${progress.done} / ${progress.total}` : estimating ? t.exportEstimating : (estimatedSize ? formatBytes(estimatedSize) : '--')}
                </span>
              </div>
            </div>}
          </div>

          {/* Right Column: Export Controls */}
          <div className="md:col-span-6 p-6 flex flex-col justify-center space-y-5">
            {(project.pages?.length ?? 1) > 1 && <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-400">{t.exportRange}</div>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-slate-950 border border-slate-800">
                {(['current', 'multiple', 'all'] as const).map(value => <button key={value} type="button" disabled={busy} aria-pressed={range === value} onClick={() => onRangeChange(value)} className={`py-2 text-xs font-semibold rounded cursor-pointer disabled:cursor-not-allowed ${range === value ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'}`}>{value === 'current' ? t.currentPage : value === 'multiple' ? t.multiplePages : t.allPages}</button>)}
              </div>
            </div>}
            {/* Format Selector */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-400">
                {t.exportFormat}
              </div>
              <div className="grid grid-cols-5 gap-1 p-1 rounded-lg bg-slate-950/90 border border-slate-800/80">
                {(['png', 'jpeg', 'webp', 'svg', 'pptx'] as const).map((format) => {
                  const isSelected = settings.format === format;
                  return (
                    <button
                      key={format}
                      type="button"
                      disabled={busy}
                      onClick={() => onChange({ format })}
                      className={`py-2 px-1 rounded text-[11px] font-bold uppercase transition-all whitespace-nowrap min-w-0 ${
                        isSelected
                          ? 'bg-blue-600 text-white shadow-sm shadow-blue-950/60'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                      }`}
                    >
                      {format === 'pptx' ? 'PPT' : format}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Pixel Ratio Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold transition-colors ${isSvg ? 'text-slate-600' : 'text-slate-400'}`}>
                  {t.exportPixelRatio}
                </span>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  {isSvg ? '--' : `${settings.pixelRatio}x`}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-slate-950/90 border border-slate-800/80">
                {([0.5, 1, 1.5, 2] as const).map((ratio) => {
                  const isSelected = !isSvg && settings.pixelRatio === ratio;
                  return (
                    <button
                      key={ratio}
                      type="button"
                      disabled={isSvg || busy}
                      onClick={() => !isSvg && onChange({ pixelRatio: ratio })}
                      className={`py-2 px-3 rounded-lg text-xs font-mono font-bold tabular-nums transition-all whitespace-nowrap shrink-0 ${
                        isSelected
                          ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
                      } ${isSvg ? 'opacity-35 cursor-not-allowed hover:bg-transparent hover:text-slate-400' : ''}`}
                    >
                      {ratio}x
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Compression Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold transition-colors ${isSvg ? 'text-slate-600' : 'text-slate-400'}`}>
                  {t.exportCompression}
                </span>
                {isPng && (
                  <span className="text-[11px] text-slate-500">
                    {t.exportCompressionHint}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-950/90 border border-slate-800/80">
                {(['lossless', 'balanced', 'small'] as const).map((level) => {
                  const isDisabled = busy || isSvg || isPpt || (isPng && level !== 'lossless');
                  const isSelected = !isSvg && settings.compression === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => !isDisabled && onChange({ compression: level })}
                      className={`py-2 px-3 rounded-lg text-xs font-bold transition-all whitespace-nowrap shrink-0 ${
                        isSelected
                          ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
                      } ${isDisabled ? 'opacity-35 cursor-not-allowed hover:bg-transparent hover:text-slate-400' : ''}`}
                    >
                      {t.exportCompressionLevels[level]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-950/60 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          {range === 'current' && <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCopyImage}
              disabled={busy}
              className="px-3.5 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 hover:border-slate-600 text-slate-200 text-xs font-semibold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <ClipboardCopy className="w-3.5 h-3.5 text-blue-400" />
              <span>{t.copyImage}</span>
            </button>
            <button
              type="button"
              onClick={onCopyBase64}
              disabled={busy}
              className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Copy className="w-3.5 h-3.5 text-slate-400" />
              <span>{t.copyBase64}</span>
            </button>
          </div>}

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              {t.cancel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy || (range === 'multiple' && !selectedPageIds.some(id => project.pages?.some(page => page.id === id)))}
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-950/50 transition-all active:scale-95 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{busy && progress ? `${progress.done} / ${progress.total}` : isPpt ? t.exportPpt : t.export}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExportModal;

