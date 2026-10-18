import React, { useEffect, useRef, useState } from 'react';
import { Clock, Copy, FileJson, ImageIcon as ImageIconLucide, Trash2 } from 'lucide-react';
import LivePreview from '../components/LivePreview.tsx';
import type { ProjectState } from '../types.ts';
import { translations, type Language } from '../translations.ts';

const formatProjectTime = (timestamp: number, lang: Language, showFullDate = false) => {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (!showFullDate && isToday) {
    return timeStr;
  }
  const isThisYear = d.getFullYear() === now.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const dateStr = isThisYear ? `${month}-${day}` : `${d.getFullYear()}-${month}-${day}`;
  return `${dateStr} ${timeStr}`;
};

// 项目卡片组件（网格视图）
export const ProjectCard = React.memo(({
  project,
  lang,
  onClick,
  onDelete,
  onDownloadJson,
  onDownloadImage,
  onDuplicate,
  sourceLabel,
  showFullDate = false
}: {
  project: ProjectState;
  lang: Language;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onDownloadJson: (e: React.MouseEvent) => void;
  onDownloadImage: (previewNode: HTMLDivElement | null, e: React.MouseEvent) => void;
  onDuplicate: (e: React.MouseEvent) => void;
  sourceLabel?: string;
  showFullDate?: boolean;
}) => {
  const t = translations[lang];
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const previewNodeRef = useRef<HTMLDivElement>(null);

  // 记录操作历史，供撤销/重做
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0.05 });

    if (cardRef.current) observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div 
      ref={cardRef}
      onClick={onClick} 
      className="group bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden hover:border-blue-500/50 transition-all cursor-pointer shadow-xl hover:shadow-blue-900/10 flex flex-col h-[260px]"
    >
      <div className="flex-1 bg-[#0c0c0e] relative overflow-hidden flex items-center justify-center">
        {isVisible ? (
          <LivePreview project={project} previewRef={previewNodeRef} />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-[#0c0c0e]">
            <div className="w-8 h-8 rounded-full border border-slate-800 border-t-slate-600 animate-spin opacity-20" />
          </div>
        )}
        
        {/* 右上角悬浮删除按钮 */}
        <button 
          onClick={onDelete} 
          className="absolute top-3 right-3 z-20 p-2 text-white bg-red-600/80 hover:bg-red-500 rounded-xl transition-all shadow-xl opacity-0 group-hover:opacity-100 hover:scale-110 active:scale-95"
          title={t.deleteProject}
        >
          <Trash2 className="w-4 h-4" />
        </button>

        {/* 标签 */}
        <div className="absolute bottom-2 right-3 flex gap-2 z-10 opacity-60 group-hover:opacity-100 transition-opacity">
          {/* Tauri 本地文件标签 */}
          {sourceLabel && (
            <span className="text-[9px] px-2 py-1 bg-emerald-600/20 text-emerald-300 font-black rounded-lg border border-emerald-500/40 uppercase tracking-tight">
              {sourceLabel}
            </span>
          )}
          {/* 比例标签 */}
           <span className="text-[9px] px-2 py-1 bg-slate-800 text-slate-400 font-black rounded-lg border border-slate-700 uppercase tracking-tight">
              {project.canvasConfig.ratio}
           </span>
        </div>

        
      </div>

      <div className="px-5 py-4 flex flex-col gap-2 border-t border-slate-800/50 bg-slate-900/60 backdrop-blur-sm">
        <h3 className="text-sm font-bold text-slate-100 group-hover:text-blue-400 transition-colors truncate">
          {project.title}
        </h3>
        
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] flex items-center gap-1.5 uppercase font-bold tracking-widest text-slate-600">
            <Clock className="w-3 h-3 text-slate-600" /> {formatProjectTime(project.updatedAt, lang, showFullDate)}
          </p>
          <div className="flex items-center gap-1">
            <button 
              onClick={(e) => onDuplicate(e)}
              className="p-2 text-slate-500 hover:text-white bg-slate-800/50 hover:bg-blue-600 rounded-xl transition-all shadow-sm active:scale-90"
              title={t.duplicateProject || t.importedCopySuffix}
            >
              <Copy className="w-3 h-3" />
            </button>
            <button 
              onClick={(e) => onDownloadJson(e)} 
              className="p-2 text-slate-500 hover:text-white bg-slate-800/50 hover:bg-blue-600 rounded-xl transition-all shadow-sm active:scale-90"
              title={t.exportJson}
            >
              <FileJson className="w-3 h-3" />
            </button>
            <button 
              onClick={(e) => onDownloadImage(previewNodeRef.current, e)} 
              className="p-2 text-slate-500 hover:text-white bg-slate-800/50 hover:bg-blue-600 rounded-xl transition-all shadow-sm active:scale-90"
              title={t.export}
            >
              <ImageIconLucide className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

// 项目列表项组件（列表视图）
export const ProjectListItem = React.memo(({
  project,
  lang,
  onClick,
  onDelete,
  onDownloadJson,
  onDownloadImage,
  onDuplicate,
  sourceLabel,
  showFullDate = false
}: {
  project: ProjectState;
  lang: Language;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onDownloadJson: (e: React.MouseEvent) => void;
  onDownloadImage: (previewNode: HTMLDivElement | null, e: React.MouseEvent) => void;
  onDuplicate: (e: React.MouseEvent) => void;
  sourceLabel?: string;
  showFullDate?: boolean;
}) => {
  const t = translations[lang];
  const [isVisible, setIsVisible] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const previewNodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0.05 });

    if (rowRef.current) observer.observe(rowRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div 
      ref={rowRef}
      onClick={onClick} 
      className="group bg-slate-900/40 border border-slate-800 rounded-2xl p-3 flex items-center justify-between gap-4 hover:border-blue-500/50 transition-all cursor-pointer shadow-lg hover:shadow-blue-900/10 hover:bg-slate-900/70"
    >
      <div className="flex items-center gap-4 min-w-0 flex-1">
        {/* 缩略图预览 */}
        <div className="w-24 h-16 bg-[#0c0c0e] rounded-xl overflow-hidden border border-slate-800/80 flex items-center justify-center flex-shrink-0 relative">
          {isVisible ? (
            <LivePreview project={project} previewRef={previewNodeRef} />
          ) : (
            <div className="w-5 h-5 rounded-full border border-slate-800 border-t-slate-600 animate-spin opacity-20" />
          )}
        </div>

        {/* 项目标题及信息 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <h3 className="text-sm font-bold text-slate-100 group-hover:text-blue-400 transition-colors truncate max-w-md">
              {project.title}
            </h3>
            {sourceLabel && (
              <span className="text-[9px] px-1.5 py-0.5 bg-emerald-600/20 text-emerald-300 font-black rounded-md border border-emerald-500/40 uppercase tracking-tight flex-shrink-0">
                {sourceLabel}
              </span>
            )}
            <span className="text-[9px] px-1.5 py-0.5 bg-slate-800 text-slate-400 font-black rounded-md border border-slate-700 uppercase tracking-tight flex-shrink-0">
              {project.canvasConfig.ratio}
            </span>
          </div>

          <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500">
            <span className="flex items-center gap-1.5 uppercase tracking-wider text-slate-500">
              <Clock className="w-3 h-3 text-slate-600" />
              {formatProjectTime(project.updatedAt, lang, showFullDate)}
            </span>
            <span className="text-slate-700">•</span>
            <span className="text-slate-500">
              {project.layers.length} {lang === 'zh' ? '个图层' : 'layers'}
            </span>
            <span className="text-slate-700">•</span>
            <span className="text-slate-500">
              {project.canvasConfig.width} × {project.canvasConfig.height} px
            </span>
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        <button 
          onClick={(e) => onDuplicate(e)}
          className="p-2 text-slate-500 hover:text-white bg-slate-800/50 hover:bg-blue-600 rounded-xl transition-all shadow-sm active:scale-90"
          title={t.duplicateProject || t.importedCopySuffix}
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button 
          onClick={(e) => onDownloadJson(e)} 
          className="p-2 text-slate-500 hover:text-white bg-slate-800/50 hover:bg-blue-600 rounded-xl transition-all shadow-sm active:scale-90"
          title={t.exportJson}
        >
          <FileJson className="w-3.5 h-3.5" />
        </button>
        <button 
          onClick={(e) => onDownloadImage(previewNodeRef.current, e)} 
          className="p-2 text-slate-500 hover:text-white bg-slate-800/50 hover:bg-blue-600 rounded-xl transition-all shadow-sm active:scale-90"
          title={t.export}
        >
          <ImageIconLucide className="w-3.5 h-3.5" />
        </button>
        <button 
          onClick={onDelete} 
          className="p-2 text-slate-500 hover:text-white bg-slate-800/50 hover:bg-red-600 rounded-xl transition-all shadow-sm active:scale-90"
          title={t.deleteProject}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
});

