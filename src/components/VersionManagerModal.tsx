import React, { useEffect, useState } from 'react';
import { Eye, GitBranch, History, LoaderCircle, RotateCcw, Trash2, X } from 'lucide-react';
import type { ProjectVersionSummary } from '../types.ts';
import { translations, type Language } from '../translations.ts';

interface VersionManagerModalProps {
  isOpen: boolean;
  lang: Language;
  projectTitle: string;
  hasUnsavedChanges: boolean;
  versions: ProjectVersionSummary[];
  loading: boolean;
  busy: boolean;
  onClose: () => void;
  onSaveVersion: (info: string) => Promise<void>;
  onPreviewVersion: (versionId: string) => Promise<void>;
  onSwitchVersion: (versionId: string, saveCurrentVersionInfo?: string) => Promise<void>;
  onDeleteVersion: (versionId: string) => Promise<void>;
}

const formatTimestamp = (timestamp: number, lang: Language) => {
  try {
    return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
};

const VersionManagerModal: React.FC<VersionManagerModalProps> = ({
  isOpen,
  lang,
  projectTitle,
  hasUnsavedChanges,
  versions,
  loading,
  busy,
  onClose,
  onSaveVersion,
  onPreviewVersion,
  onSwitchVersion,
  onDeleteVersion
}) => {
  const t = translations[lang];
  const [versionInfo, setVersionInfo] = useState('');
  const [infoError, setInfoError] = useState<string | null>(null);
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);
  const [preSwitchInfo, setPreSwitchInfo] = useState('');
  const [preSwitchError, setPreSwitchError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setVersionInfo('');
      setInfoError(null);
      setPendingSwitchId(null);
      setPreSwitchInfo('');
      setPreSwitchError(null);
      setPendingDeleteId(null);
      setActiveActionId(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, busy, onClose]);

  if (!isOpen) return null;

  const handleCreateVersion = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = versionInfo.trim();
    if (!trimmed) {
      setInfoError(t.versionInfoRequired);
      return;
    }
    setInfoError(null);
    try {
      await onSaveVersion(trimmed);
      setVersionInfo('');
    } catch {
      // Error toast is handled by caller
    }
  };

  const handleSaveAndSwitch = async (versionId: string) => {
    const trimmed = preSwitchInfo.trim();
    if (!trimmed) {
      setPreSwitchError(t.versionInfoRequired);
      return;
    }
    setPreSwitchError(null);
    setActiveActionId(versionId);
    try {
      await onSwitchVersion(versionId, trimmed);
      setPendingSwitchId(null);
      setPreSwitchInfo('');
    } finally {
      setActiveActionId(null);
    }
  };

  const handleDirectSwitch = async (versionId: string) => {
    setActiveActionId(versionId);
    try {
      await onSwitchVersion(versionId);
      setPendingSwitchId(null);
      setPreSwitchInfo('');
    } finally {
      setActiveActionId(null);
    }
  };

  const handlePreview = async (versionId: string) => {
    setActiveActionId(versionId);
    try {
      await onPreviewVersion(versionId);
    } finally {
      setActiveActionId(null);
    }
  };

  const handleDelete = async (versionId: string) => {
    setActiveActionId(versionId);
    try {
      await onDeleteVersion(versionId);
      setPendingDeleteId(null);
    } finally {
      setActiveActionId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.versionHistory}
        className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <History className="w-4 h-4 text-slate-400 shrink-0" />
            <h2 className="text-sm font-bold text-slate-100 whitespace-nowrap">{t.versionHistory}</h2>
            <span className="text-xs text-slate-500 truncate">· {projectTitle}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-40"
            aria-label={t.pwa.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleCreateVersion} className="px-6 py-4 border-b border-slate-800 bg-slate-950/30 space-y-2.5">
          <label htmlFor="cf-version-info-input" className="block text-xs font-semibold text-slate-300">
            {t.saveNewVersion}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="cf-version-info-input"
              type="text"
              maxLength={200}
              value={versionInfo}
              onChange={(e) => {
                setVersionInfo(e.target.value);
                if (infoError) setInfoError(null);
              }}
              placeholder={t.versionInfoPlaceholder}
              disabled={busy}
              className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {busy && !activeActionId ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
              <span>{t.saveVersionAction}</span>
            </button>
          </div>
          {infoError && (
            <p className="text-xs text-red-400">{infoError}</p>
          )}
        </form>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold text-slate-300">{t.versionListTitle}</span>
            <span className="tabular-nums text-slate-500">{versions.length}</span>
          </div>

          {loading ? (
            <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-400">
              <LoaderCircle className="w-4 h-4 animate-spin" />
              <span>{t.loading}</span>
            </div>
          ) : versions.length === 0 ? (
            <div className="py-12 text-center border border-dashed border-slate-800 rounded-xl text-xs text-slate-500">
              {t.versionEmpty}
            </div>
          ) : (
            <div className="border border-slate-800 rounded-xl divide-y divide-slate-800 bg-slate-950/30">
              {versions.map((version) => {
                const isRowBusy = busy && activeActionId === version.id;
                const isConfirmingSwitch = pendingSwitchId === version.id;
                const isConfirmingDelete = pendingDeleteId === version.id;
                return (
                  <div key={version.id} className="p-3.5 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-1">
                        <div className="text-sm font-semibold text-slate-100 break-words">
                          {version.info}
                        </div>
                        <div className="text-xs text-slate-400 tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span>{formatTimestamp(version.createdAt, lang)}</span>
                          <span>·</span>
                          <span>{version.pageCount} {t.pages}</span>
                          <span>·</span>
                          <span>{version.width}×{version.height}</span>
                          <span>·</span>
                          <span className="truncate max-w-[180px]" title={version.title}>{version.title}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => { void handlePreview(version.id); }}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors whitespace-nowrap shrink-0 disabled:opacity-40"
                        >
                          {isRowBusy ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                          <span>{t.versionPreview}</span>
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setPendingDeleteId(null);
                            setPreSwitchError(null);
                            setPendingSwitchId(isConfirmingSwitch ? null : version.id);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors whitespace-nowrap shrink-0 disabled:opacity-40"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>{t.versionSwitch}</span>
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setPendingSwitchId(null);
                            setPendingDeleteId(isConfirmingDelete ? null : version.id);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-red-950/70 hover:text-red-300 text-xs font-semibold text-slate-400 transition-colors whitespace-nowrap shrink-0 disabled:opacity-40"
                          aria-label={t.versionDelete}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{t.versionDelete}</span>
                        </button>
                      </div>
                    </div>

                    {isConfirmingSwitch && (
                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-700 space-y-2.5">
                        <p className="text-xs text-slate-300">
                          {hasUnsavedChanges ? t.confirmSwitchVersionUnsaved : t.confirmSwitchVersion}
                        </p>
                        {hasUnsavedChanges && (
                          <div className="space-y-1.5">
                            <input
                              type="text"
                              maxLength={200}
                              value={preSwitchInfo}
                              onChange={(e) => {
                                setPreSwitchInfo(e.target.value);
                                if (preSwitchError) setPreSwitchError(null);
                              }}
                              placeholder={t.versionInfoPlaceholder}
                              disabled={busy}
                              className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-blue-500"
                            />
                            {preSwitchError && <p className="text-xs text-red-400">{preSwitchError}</p>}
                          </div>
                        )}
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setPendingSwitchId(null);
                              setPreSwitchError(null);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 whitespace-nowrap"
                          >
                            {t.cancel}
                          </button>
                          {hasUnsavedChanges && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => { void handleSaveAndSwitch(version.id); }}
                              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white whitespace-nowrap disabled:opacity-50"
                            >
                              {t.saveVersionAndSwitch}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => { void handleDirectSwitch(version.id); }}
                            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white whitespace-nowrap disabled:opacity-50"
                          >
                            {hasUnsavedChanges ? t.switchDirectly : t.versionSwitch}
                          </button>
                        </div>
                      </div>
                    )}

                    {isConfirmingDelete && (
                      <div className="p-3 rounded-lg bg-slate-900 border border-red-900/60 flex items-center justify-between gap-3">
                        <span className="text-xs text-slate-300">{t.confirmDeleteVersion}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setPendingDeleteId(null)}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 whitespace-nowrap"
                          >
                            {t.cancel}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => { void handleDelete(version.id); }}
                            className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white whitespace-nowrap disabled:opacity-50"
                          >
                            {t.confirmDeleteAction}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VersionManagerModal;
