import React, { useEffect, useRef, useState } from 'react';
import { Plus, Save, X } from 'lucide-react';
import { translations, Language } from '../translations.ts';
import {
  buildDecorationLayerStyle,
  compactDecorationCssForStorage,
  formatDecorationCssForEditor
} from '../utils/decorationStyles.ts';

interface DecorationEditorModalProps {
  lang: Language;
  isOpen: boolean;
  mode: 'create' | 'edit';
  name: string;
  width: number;
  height: number;
  cssText: string;
  previewCssText: string;
  issueMessages: string[];
  disabled: boolean;
  onChangeName: (value: string) => void;
  onChangeWidth: (value: number) => void;
  onChangeHeight: (value: number) => void;
  onChangeCssText: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  onApply: () => void;
}

const DecorationEditorModal: React.FC<DecorationEditorModalProps> = ({
  lang,
  isOpen,
  mode,
  name,
  width,
  height,
  cssText,
  previewCssText,
  issueMessages,
  disabled,
  onChangeName,
  onChangeWidth,
  onChangeHeight,
  onChangeCssText,
  onClose,
  onSave,
  onApply
}) => {
  const t = translations[lang];
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [editorCssText, setEditorCssText] = useState(() => formatDecorationCssForEditor(cssText));

  useEffect(() => {
    if (isOpen) {
      setEditorCssText(formatDecorationCssForEditor(cssText));
    }
  }, [cssText, isOpen]);

  if (!isOpen) return null;

  const previewScale = Math.min(1, 180 / Math.max(width, height, 1));

  const syncCssText = (nextEditorValue: string) => {
    setEditorCssText(nextEditorValue);
    onChangeCssText(compactDecorationCssForStorage(nextEditorValue));
  };

  const handleCssKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== ';' || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    event.preventDefault();
    const target = event.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const afterSelection = editorCssText.slice(end);
    const insertion = afterSelection.startsWith('\n') ? ';' : ';\n';
    const nextEditorValue = `${editorCssText.slice(0, start)}${insertion}${afterSelection}`;

    syncCssText(nextEditorValue);
    requestAnimationFrame(() => {
      const nextCaretPosition = start + insertion.length;
      textareaRef.current?.setSelectionRange(nextCaretPosition, nextCaretPosition);
    });
  };

  const handleCssBlur = () => {
    const formatted = formatDecorationCssForEditor(editorCssText);
    setEditorCssText(formatted);
    onChangeCssText(compactDecorationCssForStorage(formatted));
  };

  return (
    <div className="fixed inset-0 z-[150] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">{mode === 'edit' ? t.decorationEditorEditTitle : t.decorationEditorCreateTitle}</div>
            <div className="text-[11px] text-slate-500 mt-1">{t.decorationSingleCssHint}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title={t.decorationCloseEditor}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-0">
          <div className="p-5 border-r border-slate-800 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={name}
                placeholder={t.decorationName}
                onChange={(e) => onChangeName(e.target.value)}
                className="col-span-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="number"
                min={24}
                max={640}
                value={width}
                onChange={(e) => onChangeWidth(Number.parseInt(e.target.value, 10) || width)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="number"
                min={24}
                max={640}
                value={height}
                onChange={(e) => onChangeHeight(Number.parseInt(e.target.value, 10) || height)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <textarea
              ref={textareaRef}
              value={editorCssText}
              placeholder={t.decorationDraftPlaceholder}
              onChange={(e) => syncCssText(e.target.value)}
              onKeyDown={handleCssKeyDown}
              onBlur={handleCssBlur}
              className="w-full min-h-[320px] bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs leading-6 text-slate-200 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="p-5 space-y-4 bg-slate-950/30">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">{t.decorationPreview}</div>
              <div className="rounded-2xl border border-slate-800 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.08),_transparent_58%),linear-gradient(180deg,_rgba(15,23,42,0.88),_rgba(2,6,23,0.98))] min-h-[260px] flex items-center justify-center overflow-hidden">
                <div
                  style={{
                    width,
                    height,
                    transform: `scale(${previewScale})`,
                    transformOrigin: 'center center'
                  }}
                >
                  <div className="w-full h-full" style={buildDecorationLayerStyle(previewCssText, '#38bdf8')} />
                </div>
              </div>
              <div className="text-[10px] text-slate-600 leading-relaxed mt-2">{t.decorationPreviewSafeHint}</div>
            </div>

            <div className="space-y-1.5 min-h-[72px]">
              {issueMessages.length > 0 ? issueMessages.map((message) => (
                <div key={message} className="text-[10px] text-amber-400 leading-relaxed">{message}</div>
              )) : (
                <div className="text-[10px] text-slate-500 leading-relaxed">{t.decorationUseCurrentColorHint}</div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={onApply}
                disabled={disabled}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-500 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <Plus className="w-3.5 h-3.5" />
                {t.decorationAddToCanvas}
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={disabled}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <Save className="w-3.5 h-3.5" />
                {mode === 'edit' ? t.decorationUpdateElement : t.decorationSaveElement}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DecorationEditorModal;
