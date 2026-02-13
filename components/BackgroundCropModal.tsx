import React from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { ArrowLeftRight, ArrowUpDown, X } from 'lucide-react';
import { translations, Language } from '../translations.ts';

// 背景图片裁切弹窗。
const BackgroundCropModal = ({
  isOpen,
  imageSrc,
  aspect,
  cropSize,
  crop,
  zoom,
  rotation,
  flip,
  onCropChange,
  onZoomChange,
  onRotationChange,
  onCropAreaChange,
  onFlipChange,
  onCancel,
  onConfirm,
  isSaving,
  lang
}: {
  isOpen: boolean;
  imageSrc: string | null;
  aspect: number;
  cropSize: { width: number; height: number };
  crop: { x: number; y: number };
  zoom: number;
  rotation: number;
  flip: { horizontal: boolean; vertical: boolean };
  onCropChange: (next: { x: number; y: number }) => void;
  onZoomChange: (next: number) => void;
  onRotationChange: (next: number) => void;
  onCropAreaChange: (pixels: Area) => void;
  onFlipChange: (updates: Partial<{ horizontal: boolean; vertical: boolean }>) => void;
  onCancel: () => void;
  onConfirm: () => void;
  isSaving: boolean;
  lang: Language;
}) => {
  if (!isOpen || !imageSrc) return null;
  const t = translations[lang];
  const transform = `translate(${crop.x}px, ${crop.y}px) rotate(${rotation}deg) scale(${zoom}) scaleX(${flip.horizontal ? -1 : 1}) scaleY(${flip.vertical ? -1 : 1})`;

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-6 bg-slate-950/70 backdrop-blur-sm">
      <div
        className="w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100">{t.cropTitle}</h3>
          <button
            type="button"
            onClick={onCancel}
            title={t.cancel}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 flex items-center justify-center">
            <div
              className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950"
              style={{ width: cropSize.width, height: cropSize.height }}
            >
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                rotation={rotation}
                aspect={aspect}
                cropSize={cropSize}
                onCropChange={onCropChange}
                onZoomChange={onZoomChange}
                onRotationChange={onRotationChange}
                onCropAreaChange={(_, pixels) => onCropAreaChange(pixels)}
                showGrid={true}
                objectFit="cover"
                zoomWithScroll={false}
                transform={transform}
                style={{
                  containerStyle: { width: '100%', height: '100%' },
                  cropAreaStyle: {
                    border: '2px solid rgba(96,165,250,0.9)',
                    boxShadow: '0 0 0 9999px rgba(2,6,23,0.55)'
                  }
                }}
              />
            </div>
          </div>
          <div className="w-full lg:w-64 space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase">
                <span>{t.cropZoom}</span>
                <span>{zoom.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => onZoomChange(parseFloat(e.target.value))}
                title={t.cropZoom}
                className="w-full accent-blue-600"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase">
                <span>{t.cropRotate}</span>
                <span>{Math.round(rotation)}°</span>
              </div>
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={rotation}
                onChange={(e) => onRotationChange(parseFloat(e.target.value))}
                title={t.cropRotate}
                className="w-full accent-blue-600"
              />
            </div>
            <div className="space-y-2">
              <div className="text-[10px] font-bold text-slate-500 uppercase">{t.cropMirror}</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onFlipChange({ horizontal: !flip.horizontal })}
                  className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                    flip.horizontal ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <ArrowLeftRight className="w-4 h-4" />
                  {t.cropFlipHorizontal}
                </button>
                <button
                  type="button"
                  onClick={() => onFlipChange({ vertical: !flip.vertical })}
                  className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                    flip.vertical ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <ArrowUpDown className="w-4 h-4" />
                  {t.cropFlipVertical}
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors"
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSaving}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-900/20 transition-all disabled:opacity-50"
          >
            {isSaving ? t.cropProcessing : t.cropConfirm}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BackgroundCropModal;
