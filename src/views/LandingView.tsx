import React from 'react';
import { Bot, FolderOpen, Plus, Settings, Upload } from 'lucide-react';
import { PWAInstallButton } from '../components/pwa/PWAInstallButton.tsx';
import { translations, type Language } from '../translations.ts';
import logoSvg from '../assets/logo.svg?raw';
import packageInfo from '../../package.json';
import ProjectBrowser, { type ProjectBrowserProps } from './ProjectBrowser.tsx';

const APP_VERSION = packageInfo.version;
const GITHUB_REPO_URL = 'https://github.com/sangyuxiaowu/CoverFlow';

type LandingViewProps = ProjectBrowserProps & {
  aiBusy: boolean;
  isAiOpen: boolean;
  isTauri: boolean;
  openPresetModal: () => void;
  openLocalProjectDialog: () => void;
  handleImportJson: React.ChangeEventHandler<HTMLInputElement>;
  onToggleAi: () => void;
  onOpenStorageSettings: () => void;
  onLanguageChange: (lang: Language) => void;
  children?: React.ReactNode;
};

export default function LandingView({ lang, aiBusy, isAiOpen, isTauri, openPresetModal, openLocalProjectDialog,
  handleImportJson, onToggleAi, onOpenStorageSettings, onLanguageChange, children, ...browserProps }: LandingViewProps) {
  const t = translations[lang];
  const { isCloudMode } = browserProps;
  return (
    <div inert={aiBusy} className="min-h-screen bg-slate-950 text-slate-200 p-8 flex flex-col gap-12 max-w-8xl mx-auto h-screen overflow-hidden" style={{ maxWidth: '95%' }}>
      {children}
        <div className="flex justify-between items-center flex-shrink-0">
          <div className="flex items-center gap-4"><div className="bg-blue-600 p-2.5 rounded-2xl shadow-xl shadow-blue-900/20 text-white"><span className="w-8 h-8 block" dangerouslySetInnerHTML={{ __html: logoSvg }} /></div><div className="relative"><h1 className="text-3xl font-black tracking-tight text-white">{t.title}</h1><p className="text-slate-500 text-sm font-medium">{t.landingHeader}</p>
          <a href={GITHUB_REPO_URL}
                target="_blank"
                rel="noreferrer"
                title={`GitHub Repository v${APP_VERSION}`}>
                  <span className="absolute top-0 left-full ml-2 px-1.5 py-0.5 rounded-full bg-slate-900 text-[9px] font-black tracking-tight text-white border border-slate-700">v{APP_VERSION}</span>
          </a></div></div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={openPresetModal}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-900/20 transition-all"
            >
              <Plus className="w-4 h-4" />
              {t.createNew}
            </button>
            {/* 本地打开需要文件系统权限，仅在 Tauri 版本支持 */}
            {isTauri && (
              <button
                type="button"
                onClick={openLocalProjectDialog}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl hover:border-blue-500 transition-all"
              >
                <FolderOpen className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-bold">{t.openLocalProject}</span>
              </button>
            )}
            <label className="flex items-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl hover:border-blue-500 cursor-pointer transition-all">
              <Upload className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-bold">{t.import}</span>
              <input type="file" accept=".cfj" onChange={handleImportJson} className="hidden" />
            </label>
            <PWAInstallButton lang={lang} />
            <button
              type="button"
              onClick={onToggleAi}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all border shadow-sm ${
                isAiOpen
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300 shadow-emerald-950/30'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white hover:border-emerald-500/40 hover:bg-slate-800/80'
              }`}
              title={lang === 'en' ? 'AI Assistant' : 'AI 助手'}
              aria-label={lang === 'en' ? 'AI Assistant' : 'AI 助手'}
              aria-expanded={isAiOpen}
            >
              <Bot className={`w-4 h-4 ${isAiOpen ? 'text-emerald-400' : 'text-emerald-500'}`} />
              <span>{lang === 'en' ? 'AI Assistant' : 'AI 助手'}</span>
              {aiBusy && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />}
            </button>
            {!isCloudMode && (
              <button
                type="button"
                onClick={onOpenStorageSettings}
                className="flex items-center gap-2 px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl hover:border-blue-500 transition-all"
              >
                <Settings className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-bold">{t.storageSettings}</span>
              </button>
            )}
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800"><button onClick={() => onLanguageChange('zh')} className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${lang === 'zh' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-200'}`}>中</button><button onClick={() => onLanguageChange('en')} className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${lang === 'en' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-200'}`}>EN</button></div>
          </div>
        </div>
      <ProjectBrowser {...browserProps} lang={lang} />
    </div>
  );
}
