import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { capturePageColorSnapshot, samplePageColor, type PageColorSnapshot } from '../utils/pageColorSampler.ts';
import { formatColor } from '../utils/colors.ts';
import type { Language } from '../translations.ts';
import { translations } from '../translations.ts';

interface Props {
  lang: Language;
  onPick: (color: string) => void;
  onCancel: (failed?: boolean) => void;
}

export default function PageEyedropper({ lang, onPick, onCancel }: Props) {
  const callbacks = useRef({ onPick, onCancel });
  callbacks.current = { onPick, onCancel };
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const [preview, setPreview] = useState<{ x: number; y: number; color: string } | null>(null);
  const [ready, setReady] = useState(false);
  const t = translations[lang];

  useEffect(() => {
    let active = true;
    let page: PageColorSnapshot | null = null;
    let artwork: PageColorSnapshot | null = null;
    let scrolled: { element: Element; snapshot: PageColorSnapshot }[] = [];
    let lastPoint: { x: number; y: number } | null = null;
    document.body.classList.add('cf-eyedropper-active');

    const snapshotAt = (x: number, y: number) => {
      const element = document.elementFromPoint(x, y);
      if (element?.closest('#export-target') && artwork) return artwork;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const match = scrolled.find(item => item.element === ancestor);
        if (match) return match.snapshot;
      }
      return page;
    };
    const update = (x: number, y: number) => {
      lastPoint = { x, y };
      const snapshot = snapshotAt(x, y);
      if (!snapshot) return null;
      const pixel = samplePageColor(snapshot, x, y);
      if (!pixel || pixel[3] === 0) return null;
      const color = formatColor({ r: pixel[0], g: pixel[1], b: pixel[2], a: 1 }, 'hex');
      setPreview({ x, y, color });
      const canvas = loupeRef.current;
      const context = canvas?.getContext('2d');
      if (canvas && context) {
        const sourceX = Math.floor((x - snapshot.rect.left) * snapshot.canvas.width / snapshot.rect.width);
        const sourceY = Math.floor((y - snapshot.rect.top) * snapshot.canvas.height / snapshot.rect.height);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingEnabled = false;
        context.drawImage(snapshot.canvas, sourceX - 5, sourceY - 5, 11, 11, 0, 0, canvas.width, canvas.height);
        const cell = canvas.width / 11;
        context.strokeStyle = 'rgba(255,255,255,.25)';
        context.lineWidth = 1;
        for (let index = 1; index < 11; index++) {
          context.beginPath();
          context.moveTo(index * cell, 0); context.lineTo(index * cell, canvas.height);
          context.moveTo(0, index * cell); context.lineTo(canvas.width, index * cell);
          context.stroke();
        }
        context.strokeStyle = '#000';
        context.lineWidth = 3;
        context.strokeRect(5 * cell, 5 * cell, cell, cell);
        context.strokeStyle = '#fff';
        context.lineWidth = 1;
        context.strokeRect(5 * cell + 1, 5 * cell + 1, cell - 2, cell - 2);
      }
      return color;
    };
    const move = (event: PointerEvent) => { if (active) update(event.clientX, event.clientY); };
    const block = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const click = (event: MouseEvent) => {
      block(event);
      const color = update(event.clientX, event.clientY);
      if (color) callbacks.current.onPick(color);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { block(event); callbacks.current.onCancel(); }
    };
    const cancel = () => callbacks.current.onCancel();
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerdown', block, true);
    window.addEventListener('pointerup', block, true);
    window.addEventListener('mousedown', block, true);
    window.addEventListener('mouseup', block, true);
    window.addEventListener('click', click, true);
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('resize', cancel);
    window.addEventListener('scroll', cancel, true);
    const target = document.getElementById('export-target');
    const scrollContents = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter(element => (element.scrollTop !== 0 || element.scrollLeft !== 0) && element.children.length === 1 && element.firstElementChild instanceof HTMLElement)
      .map(element => element.firstElementChild as HTMLElement);
    Promise.allSettled([
      capturePageColorSnapshot(document.body),
      target ? capturePageColorSnapshot(target) : Promise.reject(new Error('No artwork')),
      ...scrollContents.map(element => capturePageColorSnapshot(element))
    ]).then(([pageResult, artworkResult, ...scrollResults]) => {
      if (!active) return;
      page = pageResult.status === 'fulfilled' ? pageResult.value : null;
      artwork = artworkResult.status === 'fulfilled' ? artworkResult.value : null;
      scrolled = scrollResults.flatMap((result, index) => result.status === 'fulfilled' ? [{ element: scrollContents[index], snapshot: result.value }] : []);
      if (!page && !artwork) { callbacks.current.onCancel(true); return; }
      setReady(true);
      if (lastPoint) update(lastPoint.x, lastPoint.y);
    });
    return () => {
      active = false;
      document.body.classList.remove('cf-eyedropper-active');
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerdown', block, true);
      window.removeEventListener('pointerup', block, true);
      window.removeEventListener('mousedown', block, true);
      window.removeEventListener('mouseup', block, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('resize', cancel);
      window.removeEventListener('scroll', cancel, true);
    };
  }, []);

  return createPortal(<>
    <div className="cf-eyedropper-status" role="status">{ready ? t.colorPickerPageHint : t.colorPickerPageLoading}</div>
    <div className="cf-eyedropper-loupe" style={{ visibility: preview ? 'visible' : 'hidden', left: Math.max(70, Math.min(window.innerWidth - 70, (preview?.x ?? 0) + ((preview?.x ?? 0) > window.innerWidth - 150 ? -80 : 80))), top: Math.max(70, Math.min(window.innerHeight - 100, (preview?.y ?? 0) + ((preview?.y ?? 0) > window.innerHeight - 160 ? -85 : 80))) }}>
      <canvas ref={loupeRef} width={132} height={132} />
      <div className="cf-eyedropper-label"><span style={{ backgroundColor: preview?.color }} />{preview?.color}</div>
    </div>
  </>, document.body);
}