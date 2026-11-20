import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import DOMPurify from 'dompurify';
import {
  AlertTriangle,
  Clipboard,
  ClipboardPaste,
  ClipboardPlus,
  Folder,
  Image as ImageIcon,
  Layers,
  Sparkles,
  Trash2,
  Type as TypeIcon,
  X,
} from 'lucide-react';
import type { Layer, LayerType, ProjectState } from '../types.ts';
import type { Language } from '../translations.ts';
import type { LayerClipboard, ClipboardDetails, ClipboardEntry } from '../utils/layerClipboard.ts';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { resolveImageSource } from '../storage/imageAssets.ts';
import type { WorkspaceBridge } from '../features/ai/types.ts';
import { executeClipboardTool } from '../features/ai/tools/clipboard.ts';
import { normalizeSVG } from '../utils/helpers.ts';
import DecorationContent from './DecorationContent.tsx';

const entryKey = (entry: ClipboardEntry) => JSON.stringify([entry.projectId, entry.pageId, entry.layerId]);

function getLayerTypeLabel(type: LayerType | undefined, english: boolean): string {
  switch (type) {
    case 'text':
      return english ? 'Text' : '文字';
    case 'image':
      return english ? 'Image' : '图片';
    case 'svg':
      return 'SVG';
    case 'decoration':
      return english ? 'Decoration' : '装饰';
    case 'group':
      return english ? 'Group' : '分组';
    default:
      return english ? 'Layer' : '图层';
  }
}

function LayerPreviewThumb({
  item,
  layer,
  brokenImage,
  onImageError,
}: {
  item: ClipboardDetails;
  layer?: Layer;
  brokenImage: boolean;
  onImageError: () => void;
}) {
  if (!item.available) {
    return (
      <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
        <AlertTriangle className="w-4 h-4" />
      </div>
    );
  }

  if (layer?.type === 'image' && layer.content && !brokenImage) {
    return (
      <div className="w-10 h-10 rounded-lg bg-slate-950 border border-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
        <img
          src={resolveImageSource(layer.content)}
          alt={item.name || ''}
          referrerPolicy="no-referrer"
          onError={onImageError}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  if (layer?.type === 'svg' && layer.content) {
    const cleanSvg = DOMPurify.sanitize(normalizeSVG(layer.content), { USE_PROFILES: { svg: true } });
    return (
      <div
        className="w-10 h-10 rounded-lg bg-slate-950 border border-slate-800 p-1.5 shrink-0 flex items-center justify-center overflow-hidden"
        style={{ color: layer.color || '#60a5fa' }}
      >
        <div
          className="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
          dangerouslySetInnerHTML={{ __html: cleanSvg }}
        />
      </div>
    );
  }

  if (layer?.type === 'decoration' && layer.content) {
    return (
      <div className="w-10 h-10 rounded-lg bg-slate-950 border border-slate-800 p-1 shrink-0 overflow-hidden flex items-center justify-center">
        <div className="w-full h-full rounded overflow-hidden">
          <DecorationContent content={layer.content} />
        </div>
      </div>
    );
  }

  if (item.type === 'text') {
    return (
      <div className="w-10 h-10 rounded-lg bg-slate-950 border border-slate-800 shrink-0 flex items-center justify-center">
        <span
          className="text-sm font-bold tracking-tight select-none"
          style={{ color: layer?.color || '#e2e8f0' }}
        >
          Aa
        </span>
      </div>
    );
  }

  if (item.type === 'group') {
    return (
      <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 shrink-0 flex items-center justify-center text-blue-400">
        <Folder className="w-4 h-4" />
      </div>
    );
  }

  if (item.type === 'image') {
    return (
      <div className="w-10 h-10 rounded-lg bg-slate-950 border border-slate-800 shrink-0 flex items-center justify-center text-slate-400">
        <ImageIcon className="w-4 h-4" />
      </div>
    );
  }

  if (item.type === 'decoration') {
    return (
      <div className="w-10 h-10 rounded-lg bg-slate-950 border border-slate-800 shrink-0 flex items-center justify-center text-slate-400">
        <Sparkles className="w-4 h-4" />
      </div>
    );
  }

  return (
    <div className="w-10 h-10 rounded-lg bg-slate-950 border border-slate-800 shrink-0 flex items-center justify-center text-slate-400">
      <TypeIcon className="w-4 h-4" />
    </div>
  );
}

export default function LayerClipboardPanel({
  clipboard,
  bridge,
  project,
  lang,
}: {
  clipboard: LayerClipboard;
  bridge: WorkspaceBridge;
  project: ProjectState;
  lang: Language;
}) {
  const entries = useSyncExternalStore(clipboard.subscribe, clipboard.getSnapshot, clipboard.getSnapshot);
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<ClipboardDetails[]>([]);
  const [layerMap, setLayerMap] = useState<Record<string, Layer>>({});
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [staging, setStaging] = useState(false);
  const [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const english = lang === 'en';
  const selectedIds = bridge.getSelection();

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setBrokenImages({});

    const pendingProjects = new Map<string, Promise<ProjectState>>();
    const resolveProject = (id: string) => {
      const existing = pendingProjects.get(id);
      if (existing) return existing;
      const promise = (async () => {
        const current = bridge.getProject();
        if (current?.id === id) return current;
        if (!bridge.getProjectById) throw new Error('Project lookup unavailable.');
        return bridge.getProjectById(id);
      })();
      pendingProjects.set(id, promise);
      return promise;
    };

    void (async () => {
      const items = await clipboard.check(resolveProject);
      const resolvedLayers: Record<string, Layer> = {};
      await Promise.all(
        items.map(async (item) => {
          if (!item.available) return;
          try {
            const sourceProject = await resolveProject(item.projectId);
            const page = syncProjectPages(sourceProject).pages?.find((p) => p.id === item.pageId);
            const found = page?.layers.find((l) => l.id === item.layerId);
            if (found) resolvedLayers[entryKey(item)] = found;
          } catch {
            // Unavailable preview falls back to type icon
          }
        })
      );
      if (active) {
        setDetails(items);
        setLayerMap(resolvedLayers);
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [open, entries, project, clipboard, bridge]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const unavailableCount = useMemo(
    () => (loading ? 0 : details.filter((item) => !item.available).length),
    [details, loading]
  );

  const stageSelection = async () => {
    if (!project.activePageId || !selectedIds.length) return;
    setStaging(true);
    setError('');
    try {
      const layers = selectedIds.map((layerId) => ({
        projectId: project.id,
        pageId: project.activePageId!,
        layerId,
      }));
      await executeClipboardTool({ action: 'copy', layers }, bridge, new AbortController().signal);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setStaging(false);
    }
  };

  const paste = async () => {
    if (!project.activePageId) return;
    setPasting(true);
    setError('');
    try {
      await executeClipboardTool(
        { action: 'paste', projectId: project.id, pageId: project.activePageId },
        bridge,
        new AbortController().signal
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPasting(false);
    }
  };

  const hasEntries = entries.length > 0;
  const pasteDisabled = !hasEntries || pasting || loading || unavailableCount > 0;

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        title={english ? 'Layer clipboard' : '图层剪贴板'}
        aria-label={english ? 'Layer clipboard' : '图层剪贴板'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`h-8 inline-flex items-center gap-2 px-2.5 rounded-lg text-xs font-semibold border transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
          open
            ? 'bg-blue-500/15 border-blue-500/50 text-blue-300 shadow-sm shadow-blue-950/30'
            : hasEntries
              ? 'bg-slate-800/90 hover:bg-slate-700/90 border-slate-700 hover:border-slate-600 text-slate-200'
              : 'bg-slate-800/60 hover:bg-slate-800 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200'
        }`}
      >
        <Clipboard className={`w-3.5 h-3.5 shrink-0 ${hasEntries && !open ? 'text-emerald-400' : ''}`} />
        <span className="hidden lg:inline">{english ? 'Clipboard' : '剪贴板'}</span>
        {hasEntries && (
          <>
            <span aria-hidden="true" className="w-px h-3 bg-slate-700" />
            <span className="font-mono text-[11px] tabular-nums text-emerald-400">{entries.length}</span>
          </>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={english ? 'Layer clipboard' : '图层剪贴板'}
          className="absolute right-0 top-full mt-2.5 w-[388px] max-w-[calc(100vw-24px)] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/75 overflow-hidden z-[100] text-sm animate-in fade-in slide-in-from-top-1 duration-150"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-slate-800 bg-slate-900">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                <Layers className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-xs font-bold tracking-wide text-slate-100 truncate">
                  {english ? 'Layer clipboard' : '图层剪贴板'}
                </h3>
                <div className="text-[11px] text-slate-400 tabular-nums mt-0.5 flex items-center gap-1.5 truncate">
                  {hasEntries ? (
                    <>
                      <span>
                        {entries.length}{' '}
                        {english ? (entries.length === 1 ? 'layer staged' : 'layers staged') : '个图层已暂存'}
                      </span>
                      {unavailableCount > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-400">
                            {unavailableCount} {english ? 'unavailable' : '项不可用'}
                          </span>
                        </>
                      )}
                    </>
                  ) : (
                    <span>{english ? 'Cross-page & cross-project layers' : '支持跨页面与跨项目粘贴'}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {selectedIds.length > 0 && project.activePageId && (
                <button
                  type="button"
                  disabled={staging}
                  onClick={() => void stageSelection()}
                  title={english ? 'Add selected layers to clipboard' : '将当前选中图层加入剪贴板'}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <ClipboardPlus className="w-3.5 h-3.5 text-blue-400" />
                  <span className="tabular-nums">
                    {english ? `Stage (${selectedIds.length})` : `暂存选中 (${selectedIds.length})`}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                title={english ? 'Close' : '关闭'}
                aria-label={english ? 'Close' : '关闭'}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="max-h-[340px] overflow-y-auto">
            {loading ? (
              <div className="divide-y divide-slate-800/80" aria-busy="true">
                <div className="sr-only">{english ? 'Loading...' : '正在读取...'}</div>
                {[0, 1].map((idx) => (
                  <div key={idx} className="flex items-center gap-3 px-4 py-3 animate-pulse">
                    <div className="w-10 h-10 rounded-lg bg-slate-800 shrink-0" />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="h-3.5 w-2/3 rounded bg-slate-800" />
                      <div className="h-2.5 w-1/2 rounded bg-slate-800/70" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !hasEntries ? (
              <div className="px-6 py-8 flex flex-col items-center text-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-slate-500">
                  <Clipboard className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-200">
                    {english ? 'Clipboard is empty' : '剪贴板为空'}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed max-w-[260px]">
                    {english
                      ? 'Stage layers from the Layers panel or context menu to reuse them across pages and projects.'
                      : '在右侧图层面板或右键菜单中将图层加入剪贴板，即可随时粘贴到任意页面或项目。'}
                  </p>
                </div>
                {selectedIds.length > 0 && project.activePageId && (
                  <button
                    type="button"
                    disabled={staging}
                    onClick={() => void stageSelection()}
                    className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    <ClipboardPlus className="w-3.5 h-3.5" />
                    <span className="tabular-nums">
                      {english
                        ? `Add selected (${selectedIds.length})`
                        : `暂存当前选中图层 (${selectedIds.length})`}
                    </span>
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80">
                {details.map((item) => {
                  const key = entryKey(item);
                  const layer = layerMap[key];
                  const isCurrentProject = item.projectId === project.id;
                  const isCurrentPage = isCurrentProject && item.pageId === project.activePageId;
                  const displayName = item.name || item.layerId;
                  const sourcePath = `${item.projectName || item.projectId} / ${item.pageName || item.pageId}`;
                  const textSnippet =
                    layer?.type === 'text' && layer.content.trim() && layer.content.trim() !== displayName.trim()
                      ? layer.content.trim()
                      : '';

                  return (
                    <div
                      key={key}
                      className="group flex items-start gap-3 px-4 py-3 hover:bg-slate-800/45 transition-colors"
                    >
                      <LayerPreviewThumb
                        item={item}
                        layer={layer}
                        brokenImage={Boolean(brokenImages[key])}
                        onImageError={() => setBrokenImages((prev) => ({ ...prev, [key]: true }))}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-slate-100 truncate leading-snug" title={displayName}>
                          {displayName}
                        </div>

                        <div className="mt-0.5 flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-[11px] leading-tight">
                          {item.available ? (
                            <>
                              <span className="text-emerald-400 font-medium">
                                {getLayerTypeLabel(item.type, english)}
                              </span>
                              {item.isGroup && (
                                <>
                                  <span aria-hidden="true" className="text-slate-600">·</span>
                                  <span className="text-slate-400 tabular-nums">
                                    {item.childCount ?? 0} {english ? 'children' : '个子图层'}
                                  </span>
                                </>
                              )}
                              {layer && (
                                <>
                                  <span aria-hidden="true" className="text-slate-600">·</span>
                                  <span className="font-mono text-slate-400 tabular-nums">
                                    {Math.round(layer.width)}×{Math.round(layer.height)}
                                  </span>
                                </>
                              )}
                            </>
                          ) : (
                            <span className="text-amber-400 font-medium">
                              {english ? 'Source unavailable' : '来源不可用'}
                            </span>
                          )}
                        </div>

                        {textSnippet && (
                          <div className="text-[11px] text-slate-400 truncate mt-1" title={textSnippet}>
                            “{textSnippet}”
                          </div>
                        )}

                        <div className="text-[11px] text-slate-500 truncate mt-1 flex items-center gap-1" title={sourcePath}>
                          <span className="truncate">{sourcePath}</span>
                          {isCurrentPage ? (
                            <span className="text-slate-400 shrink-0">· {english ? 'Current page' : '当前页'}</span>
                          ) : isCurrentProject ? (
                            <span className="text-slate-400 shrink-0">· {english ? 'Current project' : '当前项目'}</span>
                          ) : null}
                        </div>

                        {item.info && (
                          <div className="text-[11px] text-slate-300 bg-slate-950/70 border border-slate-800 rounded-md px-2 py-1 mt-1.5 break-words">
                            {item.info}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => clipboard.remove(item)}
                        title={english ? 'Remove' : '移除'}
                        aria-label={english ? `Remove ${displayName}` : `移除 ${displayName}`}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {!error && !loading && unavailableCount > 0 && (
            <div className="px-4 py-2 bg-amber-500/5 border-t border-amber-500/20 text-[11px] text-amber-300/90 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              <span>
                {english
                  ? 'Remove unavailable items before pasting.'
                  : '部分图层来源已失效，请先移除不可用项后再粘贴。'}
              </span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mx-4 my-2.5 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300 break-words flex items-start gap-2"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-400 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-800 bg-slate-950/60">
            <button
              type="button"
              disabled={!hasEntries || pasting}
              onClick={() => {
                clipboard.clear();
                setError('');
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-35 disabled:pointer-events-none transition-colors whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{english ? 'Clear' : '清空'}</span>
            </button>

            <button
              type="button"
              disabled={pasteDisabled}
              onClick={() => void paste()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-sm shadow-blue-950/40 disabled:opacity-40 disabled:pointer-events-none transition-colors whitespace-nowrap shrink-0"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              <span>
                {pasting
                  ? english
                    ? 'Pasting...'
                    : '粘贴中...'
                  : english
                    ? 'Paste to current page'
                    : '粘贴到当前页'}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}