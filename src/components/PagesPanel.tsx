import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, Copy, GripVertical, ImageIcon, Trash2 } from 'lucide-react';
import type { ProjectPage } from '../types.ts';
import { translations, type Language } from '../translations.ts';
import { formatCanvasRatio } from '../utils/helpers.ts';
import { pageNumber } from '../utils/projectPages.ts';

interface PagesPanelProps {
  lang: Language;
  pages: ProjectPage[];
  activePageId?: string;
  thumbnails: Record<string, string>;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onSelect?: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onDuplicate?: (id: string) => void;
  onDelete?: (id: string) => void;
  onMove?: (id: string, targetId: string) => void;
}

export default function PagesPanel({ lang, pages, activePageId, thumbnails, selectedIds, onSelectionChange, onSelect, onRename, onDuplicate, onDelete, onMove }: PagesPanelProps) {
  const t = translations[lang];
  const [dropId, setDropId] = useState<string | null>(null);
  const toggle = (id: string) => onSelectionChange?.(selectedIds?.includes(id) ? selectedIds.filter(item => item !== id) : [...selectedIds ?? [], id]);
  return (
    <div className="flex flex-col h-full min-h-0" aria-label={t.pages}>
      {onSelectionChange && <div className="flex items-center justify-between gap-2 p-3 border-b border-slate-800 text-xs">
        <span className="text-slate-400 tabular-nums">{selectedIds?.length ?? 0} / {pages.length}</span>
        <div className="flex gap-3">
          <button type="button" className="text-blue-400 hover:text-blue-300 cursor-pointer" onClick={() => onSelectionChange(pages.map(page => page.id))}>{t.selectAllPages}</button>
          <button type="button" className="text-slate-400 hover:text-white cursor-pointer" onClick={() => onSelectionChange(pages.filter(page => !selectedIds?.includes(page.id)).map(page => page.id))}>{t.invertPages}</button>
        </div>
      </div>}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2 space-y-2">
        {pages.map((page, index) => {
          const active = onSelectionChange ? selectedIds?.includes(page.id) : page.id === activePageId;
          const label = `${pageNumber(index)}${page.name ? ` ${page.name}` : ''}`;
          const Item = onSelectionChange ? 'label' : 'div';
          const thumbnail = thumbnails[page.id] ? <img src={thumbnails[page.id]} alt="" draggable={false} className="max-w-full max-h-full object-contain" /> : <ImageIcon className="w-5 h-5 text-slate-700" />;
          return <Item key={page.id} data-page-id={page.id}
            onDragOver={event => { if (onMove) { event.preventDefault(); setDropId(page.id); } }}
            onDragLeave={() => setDropId(null)}
            onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData('text/coverflow-page'); if (id && pages.some(item => item.id === id)) onMove?.(id, page.id); setDropId(null); }}
            className={`block rounded-lg border overflow-hidden transition-colors ${onSelectionChange ? 'group cursor-pointer hover:border-blue-400/60 focus-within:ring-2 focus-within:ring-blue-400/60 focus-within:ring-inset' : ''} ${dropId === page.id ? 'border-emerald-400' : active ? 'border-blue-500 bg-blue-500/5' : 'border-slate-800 bg-slate-950/30'}`}>
            <div className="flex items-center gap-2 p-2">
              {onMove && <span draggable onDragStart={event => event.dataTransfer.setData('text/coverflow-page', page.id)} onDragEnd={() => setDropId(null)} className="cursor-grab text-slate-600 shrink-0" title={t.reorderPage}><GripVertical className="w-3 h-4" /></span>}
              {onSelectionChange && <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
                <input type="checkbox" aria-label={label} checked={selectedIds?.includes(page.id) ?? false} onChange={() => toggle(page.id)} className="peer sr-only" />
                <span aria-hidden="true" className="absolute inset-0 rounded border border-slate-600 bg-slate-900 transition-colors group-hover:border-blue-400 peer-checked:border-blue-500 peer-checked:bg-blue-500 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-slate-950" />
                <Check aria-hidden="true" className="relative h-3.5 w-3.5 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" strokeWidth={3} />
              </span>}
              {onSelectionChange ? <div className="flex-1 min-w-0 flex items-center justify-center bg-slate-950 h-[76px] overflow-hidden rounded">{thumbnail}</div> : <button type="button" aria-label={label} aria-current={active ? 'page' : undefined} onClick={() => onSelect?.(page.id)} className="flex-1 min-w-0 flex items-center justify-center bg-slate-950 h-[76px] overflow-hidden rounded cursor-pointer">{thumbnail}</button>}
            </div>
            <div className="px-2 pb-2 space-y-1">
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[10px] font-mono text-slate-500 shrink-0">{pageNumber(index)}</span>
                {onRename ? <input key={`${page.id}-${page.name}`} defaultValue={page.name} placeholder={pageNumber(index)} aria-label={`${t.pageName} ${pageNumber(index)}`} maxLength={100} onBlur={event => { if (event.target.value.trim() !== page.name) onRename(page.id, event.target.value); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} className="min-w-0 w-full bg-transparent px-1 text-xs text-slate-200 outline-none focus:bg-slate-800 rounded" /> : <span className="text-xs text-slate-200 truncate">{page.name}</span>}
              </div>
              <div className="text-[10px] text-slate-500 font-mono truncate">{page.canvasConfig.width} x {page.canvasConfig.height} · {formatCanvasRatio(page.canvasConfig.width, page.canvasConfig.height, page.canvasConfig.ratio)}</div>
              {onDuplicate && <div className="flex items-center justify-end gap-1 pt-1">
                {onMove && <>
                  <button type="button" title={t.movePageUp} aria-label={`${t.movePageUp} ${pageNumber(index)}`} disabled={index === 0} onClick={() => onMove(page.id, pages[index - 1].id)} className="p-1 text-slate-500 hover:text-white disabled:opacity-20"><ArrowUp className="w-3.5 h-3.5" /></button>
                  <button type="button" title={t.movePageDown} aria-label={`${t.movePageDown} ${pageNumber(index)}`} disabled={index === pages.length - 1} onClick={() => onMove(page.id, pages[index + 1].id)} className="p-1 text-slate-500 hover:text-white disabled:opacity-20"><ArrowDown className="w-3.5 h-3.5" /></button>
                </>}
                <button type="button" title={t.duplicatePage} aria-label={`${t.duplicatePage} ${pageNumber(index)}`} disabled={pages.length >= 99} onClick={() => onDuplicate(page.id)} className="p-1 text-slate-500 hover:text-blue-400 disabled:opacity-20"><Copy className="w-3.5 h-3.5" /></button>
                <button type="button" title={t.deletePage} aria-label={`${t.deletePage} ${pageNumber(index)}`} disabled={pages.length <= 1} onClick={() => onDelete?.(page.id)} className="p-1 text-slate-500 hover:text-red-400 disabled:opacity-20"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>}
            </div>
          </Item>;
        })}
      </div>
    </div>
  );
}