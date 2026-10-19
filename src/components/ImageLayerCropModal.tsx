import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FlipHorizontal2, FlipVertical2, RotateCcw, Crop as CropIcon, X, Check } from 'lucide-react';
import { ImageCrop, Layer } from '../types.ts';
import { translations, Language } from '../translations.ts';
import {
  DEFAULT_IMAGE_CROP,
  buildFlipTransform,
  buildImageFilterCss,
  hasActiveImageCrop,
  normalizeImageCrop,
} from '../utils/imageLayer.ts';

interface ImageLayerCropModalProps {
  isOpen: boolean;
  layer: Layer | null;
  lang: Language;
  onCancel: () => void;
  onConfirm: (crop: ImageCrop, flipX: boolean, flipY: boolean) => void;
}

type AspectPresetId = 'free' | 'original' | '1:1' | '16:9' | '4:3' | '3:4' | '9:16';

const ASPECT_PRESETS: Array<{ id: AspectPresetId; label?: string; ratio?: number }> = [
  { id: 'free' },
  { id: 'original' },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
];

const STAGE_MAX_W = 520;
const STAGE_MAX_H = 380;
const MIN_CROP_PCT = 5;

const ImageLayerCropModal: React.FC<ImageLayerCropModalProps> = ({
  isOpen,
  layer,
  lang,
  onCancel,
  onConfirm,
}) => {
  const t = translations[lang];
  const [crop, setCrop] = useState<ImageCrop>(() => normalizeImageCrop(layer?.imageCrop));
  const [flipX, setFlipX] = useState<boolean>(Boolean(layer?.flipX));
  const [flipY, setFlipY] = useState<boolean>(Boolean(layer?.flipY));
  const [aspectPreset, setAspectPreset] = useState<AspectPresetId>('free');
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>({
    width: layer?.width || 400,
    height: layer?.height || 300,
  });

  const stageRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<{
    mode: 'move' | 'resize';
    handle?: string;
    startClientX: number;
    startClientY: number;
    initialCrop: ImageCrop;
  } | null>(null);

  useEffect(() => {
    if (!isOpen || !layer) return;
    setCrop(normalizeImageCrop(layer.imageCrop));
    setFlipX(Boolean(layer.flipX));
    setFlipY(Boolean(layer.flipY));
    setAspectPreset('free');

    let active = true;
    const img = new Image();
    img.onload = () => {
      if (!active) return;
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
      }
    };
    img.src = layer.content;
    return () => {
      active = false;
    };
  }, [isOpen, layer?.id, layer?.content]);

  const imageAspect = Math.max(0.05, naturalSize.width / Math.max(1, naturalSize.height));

  const stageSize = (() => {
    let width = STAGE_MAX_W;
    let height = width / imageAspect;
    if (height > STAGE_MAX_H) {
      height = STAGE_MAX_H;
      width = height * imageAspect;
    }
    return {
      width: Math.max(120, Math.round(width)),
      height: Math.max(120, Math.round(height)),
    };
  })();

  const applyAspectPreset = useCallback(
    (presetId: AspectPresetId, currentCrop: ImageCrop) => {
      setAspectPreset(presetId);
      if (presetId === 'free') return;

      const targetVisualRatio =
        presetId === 'original'
          ? imageAspect
          : ASPECT_PRESETS.find((p) => p.id === presetId)?.ratio || imageAspect;

      // In percentage space (0..100 of naturalWidth and naturalHeight):
      // (widthPct * naturalWidth) / (heightPct * naturalHeight) = targetVisualRatio
      // => widthPct / heightPct = targetVisualRatio / imageAspect
      const pctRatio = targetVisualRatio / imageAspect;

      const centerX = currentCrop.x + currentCrop.width / 2;
      const centerY = currentCrop.y + currentCrop.height / 2;

      let nextW = currentCrop.width;
      let nextH = nextW / pctRatio;

      if (nextH > 100) {
        nextH = 100;
        nextW = nextH * pctRatio;
      }
      if (nextW > 100) {
        nextW = 100;
        nextH = nextW / pctRatio;
      }
      if (nextW < MIN_CROP_PCT) {
        nextW = MIN_CROP_PCT;
        nextH = Math.min(100, nextW / pctRatio);
      }
      if (nextH < MIN_CROP_PCT) {
        nextH = MIN_CROP_PCT;
        nextW = Math.min(100, nextH * pctRatio);
      }

      setCrop(
        normalizeImageCrop({
          x: centerX - nextW / 2,
          y: centerY - nextH / 2,
          width: nextW,
          height: nextH,
        })
      );
    },
    [imageAspect]
  );

  const handleToggleFlip = (axis: 'horizontal' | 'vertical') => {
    if (axis === 'horizontal') {
      setFlipX((prev) => !prev);
      if (hasActiveImageCrop(crop)) {
        setCrop((prev) =>
          normalizeImageCrop({
            ...prev,
            x: 100 - prev.x - prev.width,
          })
        );
      }
    } else {
      setFlipY((prev) => !prev);
      if (hasActiveImageCrop(crop)) {
        setCrop((prev) =>
          normalizeImageCrop({
            ...prev,
            y: 100 - prev.y - prev.height,
          })
        );
      }
    }
  };

  const handleResetCrop = () => {
    setAspectPreset('free');
    setCrop(DEFAULT_IMAGE_CROP);
  };

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const stageEl = stageRef.current;
      if (!stageEl) return;
      const rect = stageEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const dxPct = ((e.clientX - dragState.startClientX) / rect.width) * 100;
      const dyPct = ((e.clientY - dragState.startClientY) / rect.height) * 100;
      const init = dragState.initialCrop;

      if (dragState.mode === 'move') {
        const nextX = Math.min(100 - init.width, Math.max(0, init.x + dxPct));
        const nextY = Math.min(100 - init.height, Math.max(0, init.y + dyPct));
        setCrop(normalizeImageCrop({ ...init, x: nextX, y: nextY }));
        return;
      }

      const handle = dragState.handle || 'se';
      let left = init.x;
      let top = init.y;
      let right = init.x + init.width;
      let bottom = init.y + init.height;

      if (handle.includes('w')) left = Math.min(right - MIN_CROP_PCT, Math.max(0, init.x + dxPct));
      if (handle.includes('e')) right = Math.max(left + MIN_CROP_PCT, Math.min(100, init.x + init.width + dxPct));
      if (handle.includes('n')) top = Math.min(bottom - MIN_CROP_PCT, Math.max(0, init.y + dyPct));
      if (handle.includes('s')) bottom = Math.max(top + MIN_CROP_PCT, Math.min(100, init.y + init.height + dyPct));

      let nextW = right - left;
      let nextH = bottom - top;

      if (aspectPreset !== 'free') {
        const targetVisualRatio =
          aspectPreset === 'original'
            ? imageAspect
            : ASPECT_PRESETS.find((p) => p.id === aspectPreset)?.ratio || imageAspect;
        const pctRatio = targetVisualRatio / imageAspect;

        if (handle === 'n' || handle === 's') {
          nextW = Math.min(100, Math.max(MIN_CROP_PCT, nextH * pctRatio));
          const cx = (left + right) / 2;
          left = Math.max(0, Math.min(100 - nextW, cx - nextW / 2));
          right = left + nextW;
        } else {
          nextH = Math.min(100, Math.max(MIN_CROP_PCT, nextW / pctRatio));
          if (handle.includes('n')) {
            top = Math.max(0, bottom - nextH);
            nextH = bottom - top;
            nextW = nextH * pctRatio;
            if (handle.includes('w')) left = right - nextW;
            else right = left + nextW;
          } else if (handle.includes('s')) {
            bottom = Math.min(100, top + nextH);
            nextH = bottom - top;
            nextW = nextH * pctRatio;
            if (handle.includes('w')) left = right - nextW;
            else right = left + nextW;
          } else {
            const cy = (top + bottom) / 2;
            top = Math.max(0, Math.min(100 - nextH, cy - nextH / 2));
            bottom = top + nextH;
          }
        }
      }

      setCrop(
        normalizeImageCrop({
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
        })
      );
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, aspectPreset, imageAspect]);

  if (!isOpen || !layer) return null;

  const filterCss = buildImageFilterCss(layer.imageFilters);
  const flipTransform = buildFlipTransform(flipX, flipY);
  const isCropped = hasActiveImageCrop(crop);

  return (
    <div
      className="fixed inset-0 z-[165] flex items-center justify-center p-4 md:p-6 bg-slate-950/75 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <CropIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">{t.layerCropModalTitle}</h3>
              <p className="text-[11px] text-slate-400">{t.layerCropModalHint}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            title={t.cancel}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col lg:flex-row gap-6 items-center lg:items-stretch">
          {/* Interactive Crop Stage */}
          <div className="flex-1 flex items-center justify-center bg-slate-950 rounded-xl border border-slate-800/80 p-6 canvas-checkerboard min-h-[340px]">
            <div
              ref={stageRef}
              className="relative select-none overflow-hidden shadow-2xl rounded-sm"
              style={{ width: stageSize.width, height: stageSize.height }}
            >
              <img
                src={layer.content}
                alt={layer.name}
                draggable={false}
                className="w-full h-full object-fill pointer-events-none select-none"
                style={{
                  transform: flipTransform,
                  filter: filterCss,
                }}
              />

              {/* Crop Box Overlay */}
              <div
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setDragState({
                    mode: 'move',
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    initialCrop: crop,
                  });
                }}
                className="absolute border-2 border-blue-400 cursor-move"
                style={{
                  left: `${crop.x}%`,
                  top: `${crop.y}%`,
                  width: `${crop.width}%`,
                  height: `${crop.height}%`,
                  boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.65)',
                }}
              >
                {/* 3x3 Rule of Thirds Grid */}
                <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3">
                  {Array.from({ length: 9 }).map((_, idx) => (
                    <div key={idx} className="border border-white/20" />
                  ))}
                </div>

                {/* 8 Resize Handles */}
                {(['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] as const).map((h) => {
                  const isN = h.includes('n');
                  const isS = h.includes('s');
                  const isW = h.includes('w');
                  const isE = h.includes('e');
                  return (
                    <div
                      key={h}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setDragState({
                          mode: 'resize',
                          handle: h,
                          startClientX: e.clientX,
                          startClientY: e.clientY,
                          initialCrop: crop,
                        });
                      }}
                      className="absolute w-3 h-3 bg-white border-2 border-blue-600 rounded-full z-20 shadow-md hover:scale-125 transition-transform"
                      style={{
                        top: isN ? 0 : isS ? '100%' : '50%',
                        left: isW ? 0 : isE ? '100%' : '50%',
                        transform: 'translate(-50%, -50%)',
                        cursor: `${h}-resize`,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Controls */}
          <div className="w-full lg:w-64 flex flex-col justify-between space-y-5">
            <div className="space-y-5">
              {/* Aspect Ratio Presets */}
              <div className="space-y-2">
                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  {t.cropAspectRatio}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {ASPECT_PRESETS.map((preset) => {
                    const label =
                      preset.id === 'free'
                        ? t.cropAspectFree
                        : preset.id === 'original'
                        ? t.cropAspectOriginal
                        : preset.label;
                    const active = aspectPreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyAspectPreset(preset.id, crop)}
                        className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition-all border ${
                          active
                            ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                            : 'bg-slate-800/80 text-slate-300 border-slate-700/70 hover:bg-slate-800 hover:border-slate-600'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Flip H / Flip V */}
              <div className="space-y-2">
                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  {t.cropMirror}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleFlip('horizontal')}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                      flipX
                        ? 'bg-blue-600 text-white border-blue-500'
                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    <FlipHorizontal2 className="w-3.5 h-3.5" />
                    <span>{t.flipHorizontal}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleFlip('vertical')}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                      flipY
                        ? 'bg-blue-600 text-white border-blue-500'
                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    <FlipVertical2 className="w-3.5 h-3.5" />
                    <span>{t.flipVertical}</span>
                  </button>
                </div>
              </div>

              {/* Numeric Crop Region (%) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    {t.cropRegionInfo}
                  </span>
                  {isCropped && (
                    <button
                      type="button"
                      onClick={handleResetCrop}
                      className="flex items-center gap-1 text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>{t.resetCrop}</span>
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-1.5 bg-slate-800/60 border border-slate-700/60 rounded-lg px-2 py-1">
                    <span className="text-[10px] font-bold text-slate-500 w-4">X</span>
                    <input
                      type="number"
                      min={0}
                      max={95}
                      value={Math.round(crop.x)}
                      onChange={(e) =>
                        setCrop((prev) =>
                          normalizeImageCrop({ ...prev, x: Number(e.target.value) || 0 })
                        )
                      }
                      className="w-full bg-transparent text-[11px] font-mono text-slate-200 outline-none text-right"
                    />
                    <span className="text-[10px] text-slate-500">%</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-slate-800/60 border border-slate-700/60 rounded-lg px-2 py-1">
                    <span className="text-[10px] font-bold text-slate-500 w-4">Y</span>
                    <input
                      type="number"
                      min={0}
                      max={95}
                      value={Math.round(crop.y)}
                      onChange={(e) =>
                        setCrop((prev) =>
                          normalizeImageCrop({ ...prev, y: Number(e.target.value) || 0 })
                        )
                      }
                      className="w-full bg-transparent text-[11px] font-mono text-slate-200 outline-none text-right"
                    />
                    <span className="text-[10px] text-slate-500">%</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-slate-800/60 border border-slate-700/60 rounded-lg px-2 py-1">
                    <span className="text-[10px] font-bold text-slate-500 w-4">W</span>
                    <input
                      type="number"
                      min={5}
                      max={100}
                      value={Math.round(crop.width)}
                      onChange={(e) =>
                        setCrop((prev) =>
                          normalizeImageCrop({ ...prev, width: Number(e.target.value) || 100 })
                        )
                      }
                      className="w-full bg-transparent text-[11px] font-mono text-slate-200 outline-none text-right"
                    />
                    <span className="text-[10px] text-slate-500">%</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-slate-800/60 border border-slate-700/60 rounded-lg px-2 py-1">
                    <span className="text-[10px] font-bold text-slate-500 w-4">H</span>
                    <input
                      type="number"
                      min={5}
                      max={100}
                      value={Math.round(crop.height)}
                      onChange={(e) =>
                        setCrop((prev) =>
                          normalizeImageCrop({ ...prev, height: Number(e.target.value) || 100 })
                        )
                      }
                      className="w-full bg-transparent text-[11px] font-mono text-slate-200 outline-none text-right"
                    />
                    <span className="text-[10px] text-slate-500">%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={() => onConfirm(crop, flipX, flipY)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-900/30 transition-all"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{t.cropConfirm}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageLayerCropModal;
