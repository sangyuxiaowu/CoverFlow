import React, { useEffect, useState } from 'react';
import { Layout, X } from 'lucide-react';
import { PresetRatio } from '../types.ts';
import { translations, Language } from '../translations.ts';

interface PresetModalProps {
  isOpen: boolean;
  lang: Language;
  presets: PresetRatio[];
  selectedPreset: PresetRatio;
  size: { width: number; height: number };
  onSelectPreset: (preset: PresetRatio) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  onClose: () => void;
  onCreate: () => void;
}

const clampSize = (value: number) => Math.max(10, Math.round(value));

const ProjectPresetModal: React.FC<PresetModalProps> = ({
  isOpen,
  lang,
  presets,
  selectedPreset,
  size,
  onSelectPreset,
  onSizeChange,
  onClose,
  onCreate
}) => {
  const [widthInput, setWidthInput] = useState(() => String(size.width));
  const [heightInput, setHeightInput] = useState(() => String(size.height));

  useEffect(() => {
    if (!isOpen) return;
    setWidthInput(String(size.width));
    setHeightInput(String(size.height));
  }, [isOpen, size.width, size.height]);

  const commitWidth = () => {
    const parsed = Number(widthInput);
    const next = Number.isFinite(parsed) ? clampSize(parsed) : size.width;
    setWidthInput(String(next));
    if (next !== size.width) {
      onSizeChange({ width: next, height: size.height });
    }
  };

  const commitHeight = () => {
    const parsed = Number(heightInput);
    const next = Number.isFinite(parsed) ? clampSize(parsed) : size.height;
    setHeightInput(String(next));
    if (next !== size.height) {
      onSizeChange({ width: size.width, height: next });
    }
  };

  if (!isOpen) return null;
  const t = translations[lang];

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
      <div
        className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-xs font-black uppercase tracking-widest text-slate-500">{t.createNew}</div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {presets.map(preset => {
              const isActive = preset.name === selectedPreset.name;
              return (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => onSelectPreset(preset)}
                  className={`group p-4 rounded-2xl border text-left transition-all ${isActive
                    ? 'border-blue-500 bg-slate-800/60'
                    : 'border-slate-800 bg-slate-900 hover:border-blue-500 hover:bg-slate-800/50'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${isActive
                      ? 'border-blue-400 bg-blue-900/20 text-blue-300'
                      : 'border-slate-700 bg-slate-800 text-slate-500'}`}
                    >
                      <Layout className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-100">
                        {lang === 'zh' ? preset.nameZh : preset.name}
                      </div>
                      <div className="text-[10px] font-bold uppercase tracking-tight text-slate-500">
                        {preset.width} x {preset.height} px
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t.selectRatio}</div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <label className="flex flex-col gap-2.5 text-xs text-slate-400 font-bold">
                <span className="leading-none">{t.width}</span>
                <input
                  type="number"
                  min={10}
                  step={1}
                  value={widthInput}
                  onChange={(e) => setWidthInput(e.target.value)}
                  onBlur={commitWidth}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 outline-none focus:border-blue-500"
                />
              </label>
              <label className="flex flex-col gap-2.5 text-xs text-slate-400 font-bold">
                <span className="leading-none">{t.height}</span>
                <input
                  type="number"
                  min={10}
                  step={1}
                  value={heightInput}
                  onChange={(e) => setHeightInput(e.target.value)}
                  onBlur={commitHeight}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 outline-none focus:border-blue-500"
                />
              </label>
            </div>
            <div className="text-[10px] text-slate-500 mt-2">{size.width} x {size.height} px</div>
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
            onClick={onCreate}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-900/20 transition-all active:scale-95"
          >
            {t.createNew}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectPresetModal;
