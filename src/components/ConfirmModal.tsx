import React from 'react';
import { AlertCircle } from 'lucide-react';
import { translations, Language } from '../translations.ts';

// 危险操作确认弹窗。
const ConfirmModal = ({
  isOpen,
  message,
  onConfirm,
  onCancel,
  lang
}: {
  isOpen: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  lang: Language;
}) => {
  if (!isOpen) return null;
  const t = translations[lang];

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-6 scale-100 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 text-amber-500">
          <AlertCircle className="w-6 h-6" />
          <h3 className="text-lg font-bold text-slate-100">{t.confirmTitle}</h3>
        </div>
        <p className="text-slate-300 text-sm leading-relaxed font-medium">{message}</p>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors"
          >
            {t.cancel}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow-lg shadow-red-900/20 transition-all active:scale-95"
          >
            {t.confirmDeleteAction}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
