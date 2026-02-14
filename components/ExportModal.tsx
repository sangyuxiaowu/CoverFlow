import React from 'react';
import { X } from 'lucide-react';
import { translations, Language } from '../translations.ts';

interface ExportSettings {
  pixelRatio: 1 | 1.5 | 2;
  format: 'png' | 'jpeg' | 'webp';
  compression: 'lossless' | 'balanced' | 'small';
}

interface ExportModalProps {
  isOpen: boolean;
  lang: Language;
  settings: ExportSettings;
  estimatedSize: number | null;
  estimating: boolean;
  onChange: (updates: Partial<ExportSettings>) => void;
  onClose: () => void;
  onConfirm: () => void;
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
};

const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  lang,
  settings,
  estimatedSize,
  estimating,
  onChange,
  onClose,
  onConfirm
}) => {
  if (!isOpen) return null;
  const t = translations[lang];
  const compressionLocked = settings.format === 'png';

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-xs font-black uppercase tracking-widest text-slate-500">{t.exportSettingsTitle}</div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t.exportPixelRatio}</div>
            <div className="flex items-center gap-2">
              {[1, 1.5, 2].map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => onChange({ pixelRatio: ratio as ExportSettings['pixelRatio'] })}
                  className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${settings.pixelRatio === ratio
                    ? 'bg-blue-600 text-white border-blue-400 shadow-lg'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-600'}`}
                >
                  {ratio}x
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t.exportFormat}</div>
            <div className="flex items-center gap-2">
              {(['png', 'jpeg', 'webp'] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  onClick={() => onChange({ format })}
                  className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all uppercase ${settings.format === format
                    ? 'bg-blue-600 text-white border-blue-400 shadow-lg'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-600'}`}
                >
                  {format}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t.exportCompression}</div>
            <div className="flex items-center gap-2">
              {(['lossless', 'balanced', 'small'] as const).map((level) => {
                const isActive = settings.compression === level;
                const isDisabled = compressionLocked && level !== 'lossless';
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => !isDisabled && onChange({ compression: level })}
                    className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${isActive
                      ? 'bg-blue-600 text-white border-blue-400 shadow-lg'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-600'} ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {t.exportCompressionLevels[level]}
                  </button>
                );
              })}
            </div>
            {compressionLocked && (
              <div className="text-[10px] text-slate-500">{t.exportCompressionHint}</div>
            )}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2 text-[10px] text-slate-400 flex items-center justify-between">
            <span>{t.exportEstimatedSize}</span>
            <span className="font-bold text-slate-200">
              {estimating ? t.exportEstimating : (estimatedSize ? formatBytes(estimatedSize) : '--')}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors"
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-900/20 transition-all active:scale-95"
          >
            {t.export}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportModal;
