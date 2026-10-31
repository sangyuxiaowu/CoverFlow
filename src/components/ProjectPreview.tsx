import { useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Maximize, X } from 'lucide-react';
import type { ProjectState } from '../types.ts';
import { translations, type Language } from '../translations.ts';
import { syncProjectPages } from '../storage/projectCompatibility.ts';
import { pageNumber, pageProject } from '../utils/projectPages.ts';
import LivePreview from './LivePreview.tsx';
import { usePagePreviewCache } from '../hooks/usePagePreviewCache.ts';

interface ProjectPreviewProps {
  project: ProjectState;
  lang: Language;
  onClose: () => void;
}

export default function ProjectPreview({ project, lang, onClose }: ProjectPreviewProps) {
  const [snapshot] = useState(() => syncProjectPages(project));
  const pages = snapshot.pages!;
  const [index, setIndex] = useState(() => Math.max(0, pages.findIndex(page => page.id === snapshot.activePageId)));
  const [isFullscreen, setIsFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const close = useEffectEvent(onClose);
  const t = translations[lang];
  const page = pages[index];
  const [pageViews] = useState(() => pages.map(item => pageProject(snapshot, item)));
  const cachedPreview = usePagePreviewCache(snapshot, index);
  const navigate = (delta: number) => setIndex(current => Math.min(pages.length - 1, Math.max(0, current + delta)));

  const enterFullscreen = () => {
    try {
      void rootRef.current?.requestFullscreen?.().catch(() => {});
    } catch {}
  };

  useLayoutEffect(() => {
    const root = rootRef.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    let enteredFullscreen = false;
    document.body.style.overflow = 'hidden';
    root.focus();

    const fullscreenChanged = () => {
      if (document.fullscreenElement === root) {
        enteredFullscreen = true;
        setIsFullscreen(true);
      }
      else if (enteredFullscreen) close();
    };
    const keydown = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if (event.key === 'Tab') {
        const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root)) {
          event.preventDefault();
          first?.focus();
        }
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) {
        event.preventDefault();
        setIndex(current => Math.max(0, Math.min(pages.length - 1, current + (event.shiftKey && event.key === ' ' ? -1 : 1))));
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        setIndex(current => Math.max(0, current - 1));
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        setIndex(event.key === 'Home' ? 0 : pages.length - 1);
      }
    };
    const blockPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener('fullscreenchange', fullscreenChanged);
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('paste', blockPaste, true);
    if (!document.fullscreenElement) enterFullscreen();

    return () => {
      document.removeEventListener('fullscreenchange', fullscreenChanged);
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('paste', blockPaste, true);
      if (document.fullscreenElement === root) {
        try { void document.exitFullscreen?.().catch(() => {}); } catch {}
      }
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [pages.length]);

  const iconButton = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 disabled:pointer-events-none disabled:opacity-30';

  return createPortal(
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label={t.previewProject} tabIndex={-1}
      className="fixed inset-0 z-[250] grid grid-rows-[48px_minmax(0,1fr)_56px] bg-[#0c0c0e] text-slate-200 outline-none">
      <header className="flex min-w-0 items-center gap-3 px-3 sm:px-6">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={snapshot.title}>{snapshot.title}</span>
        {!isFullscreen && typeof document.documentElement.requestFullscreen === 'function' && (
          <button type="button" onClick={enterFullscreen} className={iconButton} title={t.enterFullscreen} aria-label={t.enterFullscreen}>
            <Maximize className="h-4 w-4" />
          </button>
        )}
        <button type="button" onClick={onClose} className={iconButton} title={t.exitPreview} aria-label={t.exitPreview}>
          <X className="h-5 w-5" />
        </button>
      </header>
      <div className="min-h-0 min-w-0 touch-none" onPointerDown={event => {
        if (event.pointerType === 'touch') touchRef.current = { x: event.clientX, y: event.clientY };
      }} onPointerUp={event => {
        const start = touchRef.current;
        touchRef.current = null;
        if (!start || event.pointerType !== 'touch') return;
        const deltaX = event.clientX - start.x;
        const deltaY = event.clientY - start.y;
        const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
        if (Math.abs(delta) >= 50) navigate(delta < 0 ? 1 : -1);
      }} onPointerCancel={() => { touchRef.current = null; }}>
        {cachedPreview ? (
          <img src={cachedPreview} alt={page.name || pageNumber(index)} draggable={false} decoding="async"
            className="h-full w-full object-contain p-5" />
        ) : <LivePreview project={pageViews[index]} />}
      </div>
      <footer className="flex min-w-0 items-center gap-3 px-3 sm:px-6">
        <span className="min-w-0 flex-1 truncate text-xs text-slate-400" title={page.name}>{pageNumber(index)}{page.name ? ` ${page.name}` : ''}</span>
        <nav className="flex shrink-0 items-center gap-1" aria-label={t.pages}>
          <button type="button" onClick={() => navigate(-1)} disabled={index === 0} className={iconButton} title={t.previousPage} aria-label={t.previousPage}>
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="w-16 text-center text-xs tabular-nums" aria-live="polite">{index + 1}/{pages.length}</span>
          <button type="button" onClick={() => navigate(1)} disabled={index === pages.length - 1} className={iconButton} title={t.nextPage} aria-label={t.nextPage}>
            <ChevronRight className="h-5 w-5" />
          </button>
        </nav>
      </footer>
    </div>, document.body
  );
}