import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Clipboard, ClipboardPaste, Trash2, X } from 'lucide-react';
import type { ProjectState } from '../types.ts';
import type { Language } from '../translations.ts';
import type { LayerClipboard, ClipboardDetails } from '../utils/layerClipboard.ts';
import type { WorkspaceBridge } from '../features/ai/types.ts';
import { executeClipboardTool } from '../features/ai/tools/clipboard.ts';

export default function LayerClipboardPanel({ clipboard, bridge, project, lang }: { clipboard: LayerClipboard; bridge: WorkspaceBridge; project: ProjectState; lang: Language }) {
  const entries = useSyncExternalStore(clipboard.subscribe, clipboard.getSnapshot, clipboard.getSnapshot);
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<ClipboardDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const english = lang === 'en';

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    void clipboard.check(async id => {
      const current = bridge.getProject();
      if (current?.id === id) return current;
      if (!bridge.getProjectById) throw new Error('Project lookup unavailable.');
      return bridge.getProjectById(id);
    }).then(items => { if (active) { setDetails(items); setLoading(false); } });
    return () => { active = false; };
  }, [open, entries, project, clipboard, bridge]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);

  const paste = async () => {
    if (!project.activePageId) return;
    setPasting(true);
    setError('');
    try { await executeClipboardTool({ action: 'paste', projectId: project.id, pageId: project.activePageId }, bridge, new AbortController().signal); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setPasting(false); }
  };

  return <div ref={container} className="relative">
    <button type="button" title={english ? 'Layer clipboard' : '图层剪贴板'} aria-label={english ? 'Layer clipboard' : '图层剪贴板'} aria-expanded={open} onClick={() => setOpen(value => !value)} className="relative p-2 rounded-lg text-slate-300 hover:bg-slate-800">
      <Clipboard className="w-4 h-4" />
      {entries.length > 0 && <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-emerald-500 text-[10px] leading-4 text-slate-950 text-center font-bold">{entries.length}</span>}
    </button>
    {open && <div role="dialog" aria-label={english ? 'Layer clipboard' : '图层剪贴板'} className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-24px)] bg-slate-900 border border-slate-700 rounded-md shadow-2xl z-[100] text-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <div className="font-semibold">{english ? 'Layer clipboard' : '图层剪贴板'} <span className="text-slate-500 font-normal">{entries.length}</span></div>
        <button type="button" onClick={() => setOpen(false)} title={english ? 'Close' : '关闭'} aria-label={english ? 'Close' : '关闭'} className="p-1 text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? <div className="p-4 text-xs text-slate-400">{english ? 'Loading...' : '正在读取...'}</div> : !entries.length ? <div className="p-4 text-xs text-slate-400">{english ? 'Clipboard is empty' : '剪贴板为空'}</div> : details.map(item => <div key={JSON.stringify([item.projectId, item.pageId, item.layerId])} className="flex items-start gap-2 px-4 py-3 border-b border-slate-800">
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate" title={item.name || item.layerId}>{item.name || item.layerId}</div>
            <div className="text-xs text-slate-400 truncate" title={`${item.projectName || item.projectId} / ${item.pageName || item.pageId}`}>{item.projectName || item.projectId} / {item.pageName || item.pageId}</div>
            <div className={`text-xs mt-1 ${item.available ? 'text-emerald-400' : 'text-amber-400'}`}>{item.available ? `${item.type}${item.isGroup ? ` · ${item.childCount} ${english ? 'children' : '个子图层'}` : ''}` : (english ? 'Source unavailable' : '来源不可用')}</div>
            {item.info && <div className="text-xs text-slate-500 break-words mt-1">{item.info}</div>}
          </div>
          <button type="button" onClick={() => clipboard.remove(item)} title={english ? 'Remove' : '移除'} aria-label={english ? `Remove ${item.name || item.layerId}` : `移除 ${item.name || item.layerId}`} className="p-1 text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
        </div>)}
      </div>
      {error && <div role="alert" className="px-4 py-2 text-xs text-red-400 break-words">{error}</div>}
      <div className="flex items-center justify-between gap-2 p-3 border-t border-slate-700">
        <button type="button" disabled={!entries.length || pasting} onClick={() => { clipboard.clear(); setError(''); }} className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs text-slate-400 hover:text-red-400 disabled:opacity-40"><Trash2 className="w-3.5 h-3.5" />{english ? 'Clear' : '清空'}</button>
        <button type="button" disabled={!entries.length || pasting || loading || details.some(item => !item.available)} onClick={() => void paste()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded disabled:opacity-40"><ClipboardPaste className="w-3.5 h-3.5" />{pasting ? (english ? 'Pasting...' : '粘贴中...') : (english ? 'Paste to current page' : '粘贴到当前页')}</button>
      </div>
    </div>}
  </div>;
}