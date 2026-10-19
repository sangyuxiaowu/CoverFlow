import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Check,
  Image as ImageIcon,
  ImagePlus,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  X,
  Search,
  Clock,
  Sparkles,
  AlertCircle,
  ArrowLeft,
  Download,
  Eye,
  Layers,
  ChevronRight,
  ExternalLink,
  HardDrive,
  Paperclip,
  ListChecks,
  CheckCheck,
  ArrowLeftRight
} from 'lucide-react';
import type { ChatSession } from '../types.ts';

export interface InsertGalleryImageInput {
  sessionId: string;
  imageId: string;
  name: string;
  category: 'generated' | 'attachment';
  prompt?: string;
}

interface Props {
  sessions: ChatSession[];
  activeId: string | null;
  disabled: boolean;
  english: boolean;
  canInsertImage?: boolean;
  onNew: () => Promise<void>;
  onSelect: (id: string) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onLoadImage?: (sessionId: string, imageId: string) => Promise<Blob | null>;
  onDeleteImages?: (images: { sessionId: string; imageId: string }[]) => Promise<boolean>;
  onInsertImage?: (item: InsertGalleryImageInput) => Promise<unknown>;
}

export type ImageCategory = 'all' | 'generated' | 'preview' | 'attachment';

interface GalleryItem {
  id: string; // unique key `${sessionId}:${imageId}`
  imageId: string;
  sessionId: string;
  sessionTitle: string;
  name: string;
  type: string;
  size: number;
  category: 'generated' | 'preview' | 'attachment';
  timestamp: number;
  prompt?: string;
}

function extractToolPrompt(argumentsText?: string): string | undefined {
  if (!argumentsText) return undefined;
  try {
    const parsed = JSON.parse(argumentsText) as Record<string, unknown>;
    return typeof parsed.prompt === 'string' && parsed.prompt.trim() ? parsed.prompt.trim() : undefined;
  } catch {
    return undefined;
  }
}

export default function SessionList({
  sessions,
  activeId,
  disabled,
  english,
  canInsertImage = false,
  onNew,
  onSelect,
  onRename,
  onDelete,
  onLoadImage,
  onDeleteImages,
  onInsertImage
}: Props) {
  const [view, setView] = useState<'sessions' | 'gallery'>('sessions');
  const [galleryCategory, setGalleryCategory] = useState<ImageCategory>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmingImages, setConfirmingImages] = useState(false);
  const [deletingImages, setDeletingImages] = useState(false);
  const [imageDeleteError, setImageDeleteError] = useState('');
  const [insertingId, setInsertingId] = useState<string | null>(null);
  const [insertedId, setInsertedId] = useState<string | null>(null);
  const [imageInsertError, setImageInsertError] = useState('');

  // 放大查看大图模态框
  const [previewingImage, setPreviewingImage] = useState<{
    item: GalleryItem;
    name: string;
    url: string;
    size: number;
    category: string;
    sessionTitle: string;
  } | null>(null);

  // 缓存图片 URL
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loadingImages, setLoadingImages] = useState<Record<string, boolean>>({});
  const cachedUrls = useRef<Record<string, string>>({});
  const attemptedImages = useRef(new Set<string>());
  const mounted = useRef(true);

  const label = (zh: string, en: string) => (english ? en : zh);

  // 格式化字节数
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toLocaleString(english ? 'en-US' : 'zh-CN', {
      maximumFractionDigits: unit ? 1 : 0
    })} ${units[unit]}`;
  };

  // 统计所有对话消息总数
  const totalMessages = useMemo(() => {
    return sessions.reduce((acc, s) => acc + s.entries.length, 0);
  }, [sessions]);

  // 收集并聚合所有会话中的图片资产
  const allGalleryItems = useMemo(() => {
    const itemsMap = new Map<string, GalleryItem>();

    sessions.forEach(session => {
      session.entries.forEach(entry => {
        // 1. entry.images
        entry.images?.forEach(img => {
          const key = `${session.id}:${img.id}`;
          if (!itemsMap.has(key)) {
            const genTool =
              entry.tools?.find(t => t.name === 'generate_image' && t.image?.id === img.id) ||
              (img.name.startsWith('generated-') ? entry.tools?.find(t => t.name === 'generate_image') : undefined);
            const isGen = Boolean(img.name.startsWith('generated-') || genTool);
            const isPrev =
              img.name.includes('preview') ||
              img.name.startsWith('layer-') ||
              entry.tools?.some(
                t => (t.name === 'get_canvas_preview' || t.name === 'get_selected_layers') && t.image?.id === img.id
              );

            itemsMap.set(key, {
              id: key,
              imageId: img.id,
              sessionId: session.id,
              sessionTitle: session.title,
              name: img.name,
              type: img.type,
              size: img.size,
              category: isGen ? 'generated' : isPrev ? 'preview' : 'attachment',
              timestamp: session.updatedAt,
              prompt: isGen ? extractToolPrompt(genTool?.arguments) : undefined
            });
          }
        });

        // 2. entry.tools
        entry.tools?.forEach(tool => {
          if (tool.image) {
            const img = tool.image;
            const key = `${session.id}:${img.id}`;
            if (!itemsMap.has(key)) {
              const isGen = tool.name === 'generate_image' || img.name.startsWith('generated-');
              const isPrev =
                tool.name === 'get_canvas_preview' ||
                tool.name === 'get_selected_layers' ||
                img.name.includes('preview') ||
                img.name.startsWith('layer-');

              itemsMap.set(key, {
                id: key,
                imageId: img.id,
                sessionId: session.id,
                sessionTitle: session.title,
                name: img.name,
                type: img.type,
                size: img.size,
                category: isGen ? 'generated' : isPrev ? 'preview' : 'attachment',
                timestamp: session.updatedAt,
                prompt: isGen ? extractToolPrompt(tool.arguments) : undefined
              });
            }
          }
        });
      });
    });

    return Array.from(itemsMap.values());
  }, [sessions]);

  // 图片总存储占用字节
  const totalImageStorageBytes = useMemo(() => {
    return allGalleryItems.reduce((acc, item) => acc + item.size, 0);
  }, [allGalleryItems]);

  // 各类别图片统计
  const generatedCount = useMemo(
    () => allGalleryItems.filter(i => i.category === 'generated').length,
    [allGalleryItems]
  );
  const previewCount = useMemo(
    () => allGalleryItems.filter(i => i.category === 'preview').length,
    [allGalleryItems]
  );
  const attachmentCount = useMemo(
    () => allGalleryItems.filter(i => i.category === 'attachment').length,
    [allGalleryItems]
  );

  // 根据当前选中 Tab 过滤的画廊图片
  const filteredGalleryItems = useMemo(() => {
    if (galleryCategory === 'generated') {
      return allGalleryItems.filter(i => i.category === 'generated');
    }
    if (galleryCategory === 'preview') {
      return allGalleryItems.filter(i => i.category === 'preview');
    }
    if (galleryCategory === 'attachment') {
      return allGalleryItems.filter(i => i.category === 'attachment');
    }
    return allGalleryItems;
  }, [allGalleryItems, galleryCategory]);

  const validImageIds = useRef(new Set<string>());
  validImageIds.current = new Set(allGalleryItems.map(item => item.id));
  const selectedItems = filteredGalleryItems.filter(item => selectedIds.has(item.id));
  const imageControlsDisabled = disabled || deletingImages;
  const changeCategory = (category: ImageCategory) => {
    setGalleryCategory(category);
    setSelectedIds(new Set());
    setConfirmingImages(false);
  };
  const toggleImage = (id: string) => setSelectedIds(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const deleteSelectedImages = async () => {
    if (!onDeleteImages || imageControlsDisabled || !selectedItems.length) return;
    setDeletingImages(true);
    setImageDeleteError('');
    try {
      const deleted = await onDeleteImages(selectedItems.map(({ sessionId, imageId }) => ({ sessionId, imageId })));
      if (deleted) {
        setSelectedIds(new Set());
        setConfirmingImages(false);
        setPreviewingImage(null);
      } else setImageDeleteError(label('删除未完成，请检查存储错误后重试。', 'Deletion incomplete. Check storage errors and retry.'));
    } catch (error) {
      setImageDeleteError(error instanceof Error ? error.message : label('图片删除失败。', 'Unable to delete images.'));
    } finally { setDeletingImages(false); }
  };

  // 会话搜索与过滤
  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter(session => {
      if (session.title.toLowerCase().includes(query)) return true;
      return session.entries.some(entry => entry.content.toLowerCase().includes(query));
    });
  }, [sessions, searchQuery]);

  // 画廊图片按需加载
  useEffect(() => {
    if (view !== 'gallery' || !onLoadImage) return;

    filteredGalleryItems.forEach(item => {
      if (!imageUrls[item.id] && !attemptedImages.current.has(item.id)) {
        attemptedImages.current.add(item.id);
        setLoadingImages(prev => ({ ...prev, [item.id]: true }));
        onLoadImage(item.sessionId, item.imageId)
          .then(blob => {
            if (blob && mounted.current && validImageIds.current.has(item.id)) {
              const url = URL.createObjectURL(blob);
              cachedUrls.current[item.id] = url;
              setImageUrls(prev => ({ ...prev, [item.id]: url }));
            }
          })
          .catch(() => {})
          .finally(() => {
            if (mounted.current) setLoadingImages(prev => ({ ...prev, [item.id]: false }));
          });
      }
    });
  }, [view, filteredGalleryItems, onLoadImage, imageUrls, loadingImages]);

  // 组件卸载时释放所有 object URLs
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      Object.values(cachedUrls.current).forEach(url => URL.revokeObjectURL(url));
      cachedUrls.current = {};
      attemptedImages.current.clear();
    };
  }, []);

  useEffect(() => {
    const removed = Object.keys(cachedUrls.current).filter(id => !validImageIds.current.has(id));
    if (!removed.length) return;
    removed.forEach(id => {
      URL.revokeObjectURL(cachedUrls.current[id]);
      delete cachedUrls.current[id];
      attemptedImages.current.delete(id);
    });
    setImageUrls({ ...cachedUrls.current });
  }, [allGalleryItems]);

  // 下载保存图片
  const handleSaveImage = (item: GalleryItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const existingUrl = imageUrls[item.id];
    if (existingUrl) {
      const a = document.createElement('a');
      a.href = existingUrl;
      a.download = item.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    if (onLoadImage) {
      onLoadImage(item.sessionId, item.imageId).then(blob => {
        if (!blob) return;
        const tempUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = tempUrl;
        a.download = item.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(tempUrl), 1000);
      });
    }
  };

  // 将生图或附件插入到当前画布
  const handleInsertImage = async (item: GalleryItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!onInsertImage || !canInsertImage || imageControlsDisabled || insertingId === item.id) return;
    if (item.category !== 'generated' && item.category !== 'attachment') return;

    setInsertingId(item.id);
    setImageInsertError('');
    try {
      await onInsertImage({
        sessionId: item.sessionId,
        imageId: item.imageId,
        name: item.name,
        category: item.category,
        prompt: item.prompt
      });
      setInsertedId(item.id);
      window.setTimeout(() => {
        setInsertedId(prev => (prev === item.id ? null : prev));
      }, 1800);
    } catch (error) {
      setImageInsertError(
        error instanceof Error ? error.message : label('插入到画布失败。', 'Failed to insert image into canvas.')
      );
    } finally {
      setInsertingId(null);
    }
  };

  /* ========================================================================= */
  /*                               画廊视图                                    */
  /* ========================================================================= */
  if (view === 'gallery') {
    return (
      <section className="w-full space-y-3.5 text-xs select-none" aria-label={label('图片资产画廊', 'Image Gallery')}>
        {/* 画廊头部导航 */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-slate-800/80">
          <button
            type="button"
            disabled={imageControlsDisabled}
            onClick={() => { setView('sessions'); setSelecting(false); setSelectedIds(new Set()); setConfirmingImages(false); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            <ArrowLeft size={13} />
            <span>{label('返回会话列表', 'Back to Chats')}</span>
          </button>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 text-slate-400 text-[11px]">
            {onDeleteImages && (
              <>
                {selecting && (
                  <>
                    <span className="font-mono" role="status">{selectedItems.length}/{filteredGalleryItems.length}</span>
                    <button type="button" disabled={imageControlsDisabled || !filteredGalleryItems.length} onClick={() => { setSelectedIds(new Set(filteredGalleryItems.map(item => item.id))); setConfirmingImages(false); }} title={label('全选当前分类', 'Select all in category')} aria-label={label('全选当前分类', 'Select all in category')} className="cf-ai-icon disabled:opacity-30"><CheckCheck size={14} /></button>
                    <button type="button" disabled={imageControlsDisabled || !filteredGalleryItems.length} onClick={() => { setSelectedIds(new Set(filteredGalleryItems.filter(item => !selectedIds.has(item.id)).map(item => item.id))); setConfirmingImages(false); }} title={label('反选当前分类', 'Invert category selection')} aria-label={label('反选当前分类', 'Invert category selection')} className="cf-ai-icon disabled:opacity-30"><ArrowLeftRight size={14} /></button>
                    <button type="button" disabled={imageControlsDisabled || !selectedItems.length} onClick={() => { setConfirmingImages(true); setImageDeleteError(''); }} title={label('删除选中图片', 'Delete selected images')} aria-label={label('删除选中图片', 'Delete selected images')} className="cf-ai-icon text-rose-400 disabled:opacity-30"><Trash2 size={14} /></button>
                  </>
                )}
                <button type="button" disabled={imageControlsDisabled} aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setSelectedIds(new Set()); setConfirmingImages(false); }} title={selecting ? label('退出批量选择', 'Exit selection') : label('批量选择', 'Batch select')} aria-label={selecting ? label('退出批量选择', 'Exit selection') : label('批量选择', 'Batch select')} className="cf-ai-icon disabled:opacity-30">{selecting ? <X size={14} /> : <ListChecks size={14} />}</button>
              </>
            )}
            <HardDrive size={12} className="text-blue-400" />
            <span className="font-mono whitespace-nowrap">{formatBytes(totalImageStorageBytes)}</span>
          </div>
        </div>

        {confirmingImages && (
          <div role="alertdialog" aria-label={label('确认删除图片', 'Confirm image deletion')} className="space-y-2 rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200">
            <p>{label(`永久删除选中的 ${selectedItems.length} 张图片（${formatBytes(selectedItems.reduce((total, item) => total + item.size, 0))}）？`, `Permanently delete ${selectedItems.length} selected images (${formatBytes(selectedItems.reduce((total, item) => total + item.size, 0))})?`)}</p>
            <p className="text-[11px] text-slate-400">{label('聊天中的图片及其引用将被清理，不影响画布中已添加的图片，无法撤销。', 'Removes chat images and references, not images already on the canvas. Cannot be undone.')}</p>
            {imageDeleteError && <p role="alert">{imageDeleteError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={deletingImages} onClick={() => setConfirmingImages(false)} className="rounded-md bg-slate-800 px-3 py-1.5 text-slate-300">{label('取消', 'Cancel')}</button>
              <button type="button" disabled={imageControlsDisabled || !selectedItems.length} onClick={() => void deleteSelectedImages()} className="rounded-md bg-rose-600 px-3 py-1.5 text-white disabled:opacity-40">{deletingImages ? label('删除中...', 'Deleting...') : label('确认删除', 'Delete')}</button>
            </div>
          </div>
        )}

        {imageInsertError && (
          <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
            <span className="truncate">{imageInsertError}</span>
            <button
              type="button"
              onClick={() => setImageInsertError('')}
              className="p-0.5 text-rose-300 hover:text-white cursor-pointer"
              aria-label={label('关闭错误提示', 'Dismiss error')}
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* 分类过滤器切换 (全部 / 生图 / 预览 / 附件) */}
        <div className="grid grid-cols-4 gap-1 p-1 bg-slate-900/80 border border-slate-800/90 rounded-xl shadow-inner">
          <button
            type="button"
            disabled={deletingImages}
            onClick={() => changeCategory('all')}
            className={`py-1.5 px-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer flex items-center justify-center gap-1 min-w-0 ${
              galleryCategory === 'all'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/30 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
            title={label('显示所有图片素材', 'Show all images')}
          >
            <Layers size={11} className="shrink-0" />
            <span className="truncate">{label('全部', 'All')}</span>
            <span
              className={`text-[10px] px-1 py-0.5 rounded-full font-mono shrink-0 ${
                galleryCategory === 'all' ? 'bg-blue-700/80 text-blue-100' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {allGalleryItems.length}
            </span>
          </button>

          <button
            type="button"
            disabled={deletingImages}
            onClick={() => changeCategory('generated')}
            className={`py-1.5 px-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer flex items-center justify-center gap-1 min-w-0 ${
              galleryCategory === 'generated'
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-900/30 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
            title={label('AI 生图工具生成的插图', 'AI Generated images')}
          >
            <Sparkles size={11} className="shrink-0" />
            <span className="truncate">{label('生图', 'Gen')}</span>
            <span
              className={`text-[10px] px-1 py-0.5 rounded-full font-mono shrink-0 ${
                galleryCategory === 'generated' ? 'bg-indigo-700/80 text-indigo-100' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {generatedCount}
            </span>
          </button>

          <button
            type="button"
            disabled={deletingImages}
            onClick={() => changeCategory('preview')}
            className={`py-1.5 px-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer flex items-center justify-center gap-1 min-w-0 ${
              galleryCategory === 'preview'
                ? 'bg-amber-600 text-white shadow-sm shadow-amber-900/30 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
            title={label('画布与图层实时预览快照', 'Canvas and layer preview snapshots')}
          >
            <Eye size={11} className="shrink-0" />
            <span className="truncate">{label('预览', 'Prev')}</span>
            <span
              className={`text-[10px] px-1 py-0.5 rounded-full font-mono shrink-0 ${
                galleryCategory === 'preview' ? 'bg-amber-700/80 text-amber-100' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {previewCount}
            </span>
          </button>

          <button
            type="button"
            disabled={deletingImages}
            onClick={() => changeCategory('attachment')}
            className={`py-1.5 px-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer flex items-center justify-center gap-1 min-w-0 ${
              galleryCategory === 'attachment'
                ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-900/30 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
            title={label('对话上传的图片附件', 'Uploaded image attachments')}
          >
            <Paperclip size={11} className="shrink-0" />
            <span className="truncate">{label('附件', 'Files')}</span>
            <span
              className={`text-[10px] px-1 py-0.5 rounded-full font-mono shrink-0 ${
                galleryCategory === 'attachment' ? 'bg-emerald-700/80 text-emerald-100' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {attachmentCount}
            </span>
          </button>
        </div>

        {/* 画廊网格 */}
        {filteredGalleryItems.length === 0 ? (
          <div className="text-center py-12 px-4 rounded-2xl border border-dashed border-slate-800 bg-slate-950/30 space-y-2">
            <div className="w-10 h-10 rounded-2xl bg-slate-800 text-slate-500 border border-slate-700/60 flex items-center justify-center mx-auto">
              <ImageIcon size={18} />
            </div>
            <p className="text-xs font-semibold text-slate-300">
              {label('暂无此类图片资产', 'No image assets in this category')}
            </p>
            <p className="text-[11px] text-slate-500">
              {galleryCategory === 'generated'
                ? label('使用 AI 生图工具生成封面插图后将在此处归档', 'AI generated images will appear here')
                : galleryCategory === 'preview'
                ? label('AI 检查画布排版时生成的实时预览图在此处归档', 'Canvas layout previews will appear here')
                : galleryCategory === 'attachment'
                ? label('用户在对话中上传或引用的图片附件在此处归档', 'Uploaded image attachments will appear here')
                : label('所有对话中产生的图片素材均在此集中管理', 'All session images are stored here')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {filteredGalleryItems.map(item => {
              const url = imageUrls[item.id];
              const isLoading = loadingImages[item.id];

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (selecting) {
                      if (!imageControlsDisabled) { toggleImage(item.id); setConfirmingImages(false); }
                      return;
                    }
                    if (url) {
                      setPreviewingImage({
                        item,
                        name: item.name,
                        url,
                        size: item.size,
                        category: item.category,
                        sessionTitle: item.sessionTitle
                      });
                    }
                  }}
                  className={`group relative rounded-xl border ${selecting && selectedIds.has(item.id) ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-800'} hover:border-blue-500/50 bg-slate-900/60 overflow-hidden flex flex-col transition-all cursor-pointer shadow-sm hover:shadow-blue-950/20`}
                >
                  {/* 图片缩略图容器 */}
                  <div className="relative aspect-video sm:aspect-square bg-[#070a0f] flex items-center justify-center overflow-hidden">
                    {url ? (
                      <img
                        src={url}
                        alt={item.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : isLoading ? (
                      <div className="w-5 h-5 rounded-full border border-slate-700 border-t-blue-400 animate-spin" />
                    ) : (
                      <div className="text-slate-600 flex flex-col items-center gap-1">
                        <ImageIcon size={20} />
                        <span className="text-[9px]">{label('加载中...', 'Loading...')}</span>
                      </div>
                    )}

                    {/* 左上角分类徽章 */}
                    {selecting && (
                      <input type="checkbox" checked={selectedIds.has(item.id)} disabled={imageControlsDisabled} aria-label={`${label('选择', 'Select')}: ${item.name} (${item.sessionTitle})`} onClick={event => event.stopPropagation()} onChange={() => { toggleImage(item.id); setConfirmingImages(false); }} className="absolute top-2 left-2 z-20 h-4 w-4 cursor-pointer accent-blue-600" />
                    )}
                    <div className={`absolute ${selecting ? 'top-8' : 'top-2'} left-2 z-10`}>
                      {item.category === 'generated' ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-indigo-600/90 text-white font-semibold backdrop-blur-sm shadow-sm flex items-center gap-1">
                          <Sparkles size={9} />
                          {label('生图', 'Gen')}
                        </span>
                      ) : item.category === 'preview' ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-600/90 text-white font-semibold backdrop-blur-sm shadow-sm flex items-center gap-1">
                          <Eye size={9} />
                          {label('预览', 'Prev')}
                        </span>
                      ) : (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-emerald-600/90 text-white font-semibold backdrop-blur-sm shadow-sm flex items-center gap-1">
                          <Paperclip size={9} />
                          {label('附件', 'File')}
                        </span>
                      )}
                    </div>

                    {/* 右上角快捷操作按钮（插入画布 + 下载） */}
                    <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                      {onInsertImage && (item.category === 'generated' || item.category === 'attachment') && (
                        <button
                          type="button"
                          disabled={imageControlsDisabled || !canInsertImage || insertingId === item.id}
                          onClick={e => void handleInsertImage(item, e)}
                          className={`p-1.5 rounded-lg transition-all shadow-md opacity-90 group-hover:opacity-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                            insertedId === item.id
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-900/90 hover:bg-emerald-600 text-slate-300 hover:text-white'
                          }`}
                          title={
                            !canInsertImage
                              ? label('请先打开一个项目画布', 'Open a project canvas first')
                              : insertedId === item.id
                              ? label('已插入到当前画布', 'Inserted into current canvas')
                              : label('插入到当前画布', 'Insert into current canvas')
                          }
                          aria-label={`${label('插入到当前画布', 'Insert into current canvas')}: ${item.name}`}
                        >
                          {insertedId === item.id ? <Check size={13} /> : <ImagePlus size={13} />}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={e => handleSaveImage(item, e)}
                        className="p-1.5 rounded-lg bg-slate-900/90 hover:bg-blue-600 text-slate-300 hover:text-white transition-all shadow-md opacity-90 group-hover:opacity-100 cursor-pointer"
                        title={label('点击保存到本地', 'Save to disk')}
                        aria-label={`${label('保存', 'Save')}: ${item.name}`}
                      >
                        <Download size={13} />
                      </button>
                    </div>
                  </div>

                  {/* 底部信息栏 */}
                  <div className="p-2.5 flex flex-col gap-1 border-t border-slate-800/80 bg-slate-900/90">
                    <div className="text-[11px] font-semibold text-slate-200 truncate group-hover:text-blue-300 transition-colors">
                      {item.name}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span className="font-mono">{formatBytes(item.size)}</span>
                      <span className="text-slate-500 truncate max-w-[80px]" title={item.sessionTitle}>
                        {item.sessionTitle}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 大图预览与详细保存浮窗 */}
        {previewingImage && (
          <div
            className="fixed inset-0 z-[250] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150"
            onClick={() => setPreviewingImage(null)}
          >
            <div
              className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <div className="min-w-0 pr-3">
                  <h4 className="text-xs font-bold text-slate-100 truncate">{previewingImage.name}</h4>
                  <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                    <span>{formatBytes(previewingImage.size)}</span>
                    <span>·</span>
                    <span className="truncate">{previewingImage.sessionTitle}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewingImage(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-4 bg-[#05070a] flex items-center justify-center max-h-[60vh] overflow-hidden">
                <img
                  src={previewingImage.url}
                  alt={previewingImage.name}
                  className="max-h-[55vh] max-w-full object-contain rounded-lg shadow-md"
                />
              </div>

              <div className="px-4 py-3 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-400 truncate">
                  {previewingImage.category === 'generated'
                    ? label('AI 生成图片', 'AI Generated')
                    : previewingImage.category === 'preview'
                    ? label('画布排版预览图', 'Canvas Preview')
                    : label('图片附件', 'Image Attachment')}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {onInsertImage && (previewingImage.category === 'generated' || previewingImage.category === 'attachment') && (
                    <button
                      type="button"
                      disabled={imageControlsDisabled || !canInsertImage || insertingId === previewingImage.item.id}
                      onClick={() => void handleInsertImage(previewingImage.item)}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-900/30 transition-all cursor-pointer"
                      title={
                        !canInsertImage
                          ? label('请先打开一个项目画布', 'Open a project canvas first')
                          : label('插入到当前画布', 'Insert into current canvas')
                      }
                    >
                      {insertedId === previewingImage.item.id ? <Check size={13} /> : <ImagePlus size={13} />}
                      <span>
                        {insertedId === previewingImage.item.id
                          ? label('已插入画布', 'Inserted')
                          : label('插入到当前画布', 'Insert to Canvas')}
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const a = document.createElement('a');
                      a.href = previewingImage.url;
                      a.download = previewingImage.name;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }}
                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-blue-900/30 transition-all cursor-pointer"
                  >
                    <Download size={13} />
                    <span>{label('保存此图片', 'Save Image')}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    );
  }

  /* ========================================================================= */
  /*                              历史会话视图                                 */
  /* ========================================================================= */
  return (
    <section className="w-full space-y-3.5 text-xs select-none" aria-label={label('历史聊天会话', 'Chat Sessions')}>
      {/* 关键指标卡片 (2列布局：历史会话指标卡片 + 可点击的图片资产画廊卡片) */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* 指标卡片 1: 历史会话 (点击卡片新建会话，交互与图片卡片一致) */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            if (!disabled) void onNew();
          }}
          onKeyDown={e => {
            if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
              e.preventDefault();
              void onNew();
            }
          }}
          className={`group p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-emerald-500/50 hover:bg-slate-850/60 active:scale-[0.98] flex flex-col justify-between gap-1 shadow-sm transition-all cursor-pointer ${
            disabled ? 'opacity-50 cursor-not-allowed' : ''
          }`}
          title={label('点击新建会话', 'Click to start new chat')}
        >
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span className="group-hover:text-emerald-300 transition-colors font-medium">
              {label('历史会话', 'Chat History')}
            </span>
            <div className="flex items-center gap-1">
              <span className="p-1 rounded-md bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20 transition-colors">
                <Plus size={12} />
              </span>
            </div>
          </div>
          <div>
            <div className="text-base font-bold text-slate-100 font-mono group-hover:text-emerald-200 transition-colors flex items-center justify-between">
              <span>
                {sessions.length}{' '}
                <span className="text-xs font-normal text-slate-400">{label('个', 'sessions')}</span>
              </span>
              <ChevronRight
                size={13}
                className="text-slate-500 group-hover:text-emerald-400 transition-transform group-hover:translate-x-0.5"
              />
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 flex items-center justify-between">
              <span>{label(`累计 ${totalMessages} 条`, `${totalMessages} msgs`)}</span>
              <span className="text-emerald-400 group-hover:underline text-[9px] font-semibold">
                {label('新建会话 ↗', 'New Chat ↗')}
              </span>
            </div>
          </div>
        </div>

        {/* 指标卡片 2: 图片资产与缓存 (支持点击展开全图预览画廊与保存) */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setView('gallery')}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setView('gallery');
            }
          }}
          className="group p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-blue-500/50 hover:bg-slate-850/60 active:scale-[0.98] flex flex-col justify-between gap-1 shadow-sm transition-all cursor-pointer"
          title={label('点击打开图片画廊并预览保存', 'Click to open gallery and save images')}
        >
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span className="group-hover:text-blue-300 transition-colors font-medium">
              {label('图片资产', 'Image Assets')}
            </span>
            <div className="flex items-center gap-1">
              <span className="p-1 rounded-md bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20 transition-colors">
                <ImageIcon size={12} />
              </span>
            </div>
          </div>
          <div>
            <div className="text-base font-bold text-slate-100 font-mono group-hover:text-blue-200 transition-colors flex items-center justify-between">
              <span>
                {allGalleryItems.length}{' '}
                <span className="text-xs font-normal text-slate-400">{label('张', 'imgs')}</span>
              </span>
              <ChevronRight size={13} className="text-slate-500 group-hover:text-blue-400 transition-transform group-hover:translate-x-0.5" />
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 flex items-center justify-between">
              <span>{formatBytes(totalImageStorageBytes)}</span>
              <span className="text-blue-400 group-hover:underline text-[9px] font-semibold">
                {label('点击预览 ↗', 'Gallery ↗')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 搜索过滤框（超过 2 个会话时展示） */}
      {sessions.length >= 2 && (
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={label('搜索会话标题或内容...', 'Search conversations...')}
            className="w-full bg-slate-900/60 border border-slate-800 focus:border-emerald-500/80 focus:ring-1 focus:ring-emerald-500/20 rounded-xl pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 outline-none transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-200"
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* 空状态：暂无会话 */}
      {sessions.length === 0 && (
        <div className="text-center py-10 px-4 rounded-2xl border border-dashed border-slate-800/90 bg-slate-950/30 space-y-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center mx-auto">
            <MessageSquare size={18} />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-200">
              {label('暂无历史会话', 'No history sessions')}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {label('与 AI 助手的每次交流都会保存在这里，方便随时回顾。', 'Conversations with AI will be saved here.')}
            </p>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void onNew()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
          >
            <Plus size={13} />
            <span>{label('开始第一次对话', 'Start Conversation')}</span>
          </button>
        </div>
      )}

      {/* 搜索无结果状态 */}
      {sessions.length > 0 && filteredSessions.length === 0 && (
        <div className="text-center py-8 text-slate-500 space-y-2">
          <p className="text-xs">{label('未找到匹配的会话', 'No matching sessions found')}</p>
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="text-xs text-emerald-400 hover:underline cursor-pointer font-medium"
          >
            {label('清空搜索过滤', 'Clear search')}
          </button>
        </div>
      )}

      {/* 会话列表卡片 */}
      <div className="space-y-2">
        {filteredSessions.map(session => {
          const isActive = session.id === activeId;
          const isEditing = editingId === session.id;
          const isDeleting = deletingId === session.id;

          // 计算单会话内图片占用
          const sessionImageSizes = new Map<string, number>();
          session.entries.forEach(entry =>
            entry.images?.forEach(image => sessionImageSizes.set(image.id, image.size))
          );
          const imageCount = sessionImageSizes.size;
          const sessionImageBytes = [...sessionImageSizes.values()].reduce(
            (total, size) => total + size,
            0
          );

          // 获取最后一条消息摘要
          const lastEntry = session.entries[session.entries.length - 1];
          const lastMessagePreview = lastEntry?.content
            ?.replace(/\s+/g, ' ')
            ?.trim()
            ?.slice(0, 48);

          return (
            <div
              key={session.id}
              className={`group relative rounded-xl border transition-all duration-150 overflow-hidden ${
                isActive
                  ? 'bg-emerald-950/25 border-emerald-500/40 shadow-sm shadow-emerald-950/30'
                  : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700/80 hover:bg-slate-850/50'
              }`}
            >
              {isEditing ? (
                /* 重命名表单 */
                <form
                  className="p-2.5 flex items-center gap-1.5 bg-slate-900"
                  onSubmit={event => {
                    event.preventDefault();
                    if (!title.trim()) return;
                    void onRename(session.id, title.trim()).then(() => setEditingId(null));
                  }}
                >
                  <input
                    autoFocus
                    value={title}
                    maxLength={120}
                    required
                    aria-label={label('会话名称', 'Session Title')}
                    onChange={event => setTitle(event.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-2.5 py-1 text-xs text-slate-100 outline-none transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={disabled || !title.trim()}
                    title={label('保存会话名称', 'Save Session Title')}
                    aria-label={label('保存会话名称', 'Save Session Title')}
                    className="p-1.5 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors cursor-pointer shrink-0 disabled:opacity-40"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    title={label('取消', 'Cancel')}
                    aria-label={label('取消', 'Cancel')}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                  >
                    <X size={14} />
                  </button>
                </form>
              ) : isDeleting ? (
                /* 删除确认警告条 */
                <div className="p-3 bg-rose-950/30 border-rose-500/20 flex items-center justify-between gap-2 animate-in fade-in duration-150">
                  <div className="flex items-center gap-1.5 text-rose-300 font-medium truncate">
                    <AlertCircle size={14} className="shrink-0 text-rose-400" />
                    <span className="truncate">{label('确认删除此会话与消息？', 'Delete this session?')}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        void onDelete(session.id).then(() => setDeletingId(null));
                      }}
                      className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
                      title={label('确认删除会话', 'Confirm Delete Session')}
                    >
                      {label('删除', 'Delete')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingId(null)}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
                      title={label('取消', 'Cancel')}
                    >
                      {label('取消', 'Cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                /* 正常会话展示 */
                <div className="p-3 flex items-start gap-2.5">
                  {/* 左侧选择区域 */}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      void onSelect(session.id);
                    }}
                    className="flex-1 min-w-0 text-left flex items-start gap-2.5 cursor-pointer bg-transparent border-0 p-0"
                  >
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 border transition-colors ${
                        isActive
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : 'bg-slate-800/80 text-slate-400 border-slate-700/60 group-hover:text-slate-300'
                      }`}
                    >
                      <MessageSquare size={13} />
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <strong
                          className={`text-xs font-semibold truncate block ${
                            isActive ? 'text-emerald-300' : 'text-slate-200 group-hover:text-white'
                          }`}
                        >
                          {session.title}
                        </strong>
                        {isActive && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium shrink-0">
                            {label('当前', 'Active')}
                          </span>
                        )}
                      </div>

                      {/* 摘要与最后消息预览 */}
                      {lastMessagePreview ? (
                        <p className="text-[11px] text-slate-400 truncate leading-snug">
                          {lastMessagePreview}
                        </p>
                      ) : (
                        <p className="text-[11px] text-slate-500 italic">
                          {label('暂无消息内容', 'Empty conversation')}
                        </p>
                      )}

                      {/* 元信息条：更新时间 · 消息数 · 图片数 */}
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 pt-0.5">
                        <span className="flex items-center gap-1 font-mono">
                          <Clock size={10} />
                          {new Date(session.updatedAt).toLocaleDateString(english ? 'en' : 'zh-CN', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                        <span>·</span>
                        <span>
                          {session.entries.length} {label('条消息', 'msgs')}
                        </span>
                        {imageCount > 0 && (
                          <>
                            <span>·</span>
                            <span className="inline-flex items-center gap-1 text-slate-400">
                              <ImageIcon size={10} className="text-blue-400" />
                              {imageCount} ({formatBytes(sessionImageBytes)})
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* 右侧操作按钮组 (悬停或触控显示) */}
                  <div className="flex items-center gap-1 shrink-0 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={e => {
                        e.stopPropagation();
                        setEditingId(session.id);
                        setTitle(session.title);
                        setDeletingId(null);
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
                      title={label('重命名会话', 'Rename Session')}
                      aria-label={`${label('重命名会话', 'Rename Session')}: ${session.title}`}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={e => {
                        e.stopPropagation();
                        setDeletingId(session.id);
                        setEditingId(null);
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                      title={label('删除会话', 'Delete Session')}
                      aria-label={`${label('删除会话', 'Delete Session')}: ${session.title}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}