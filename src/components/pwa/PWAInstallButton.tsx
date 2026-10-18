import React, { useState } from 'react';
import { Download, Share, PlusSquare, CheckCircle, Info, X } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { usePWAInstall } from '../../hooks/usePWAInstall.ts';
import { translations, Language } from '../../translations.ts';

interface PWAInstallButtonProps {
  lang: Language;
}

export const PWAInstallButton = ({ lang }: PWAInstallButtonProps) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const t = translations[lang];
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [showDesktopHelp, setShowDesktopHelp] = useState(false);
  const isTauriRuntime = import.meta.env.VITE_APP_MODE === 'tauri' || isTauri();

  if (import.meta.env.DEV || isTauriRuntime || isInstalled) {
    return null;
  }

  // 1. Browser provides native beforeinstallprompt (Chromium / Edge / Android)
  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-900/20 transition-all shrink-0 animate-pulse hover:animate-none"
        title={t.pwa.installAppTitle}
      >
        <Download className="w-4 h-4 text-blue-100" />
        <span className="whitespace-nowrap">{t.pwa.installApp}</span>
      </button>
    );
  }

  // 2. iOS Safari (WebKit does not support beforeinstallprompt)
  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-2 px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl hover:border-blue-500 transition-all shrink-0"
        >
          <Share className="w-4 h-4 text-blue-500" />
          <span className="text-xs font-bold whitespace-nowrap hidden sm:inline">{t.pwa.installMobile}</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 animate-in fade-in" onClick={() => setShowIOSGuide(false)}>
            <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-slate-950 border border-blue-700/50 flex items-center justify-center p-1">
                    <img src="./icons/icon.svg" alt="App Icon" className="w-full h-full rounded-lg" />
                  </div>
                  <h3 className="text-sm font-bold text-white">{t.pwa.iosInstallTitle}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs text-slate-300">
                <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 flex items-start gap-2.5">
                  <Share className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-bold text-white">{t.pwa.iosStep1.split(/[:：]/)[0]}：</span>
                    {t.pwa.iosStep1.split(/[:：]/)[1] || t.pwa.iosStep1}
                  </div>
                </div>

                <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 flex items-start gap-2.5">
                  <PlusSquare className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-bold text-white">{t.pwa.iosStep2.split(/[:：]/)[0]}：</span>
                    {t.pwa.iosStep2.split(/[:：]/)[1] || t.pwa.iosStep2}
                  </div>
                </div>

                <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 flex items-start gap-2.5">
                  <CheckCircle className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-bold text-white">{t.pwa.iosStep3.split(/[:：]/)[0]}：</span>
                    {t.pwa.iosStep3.split(/[:：]/)[1] || t.pwa.iosStep3}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 py-2.5 text-xs font-bold text-white transition-colors"
              >
                {t.pwa.gotIt}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // 3. Fallback button for desktop when browser hasn't fired beforeinstallprompt
  return (
    <>
      <button
        type="button"
        onClick={() => setShowDesktopHelp(true)}
        className="flex items-center gap-2 px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl hover:border-blue-500 transition-all shrink-0"
        title={t.pwa.pwaSupport}
      >
        <Download className="w-4 h-4 text-blue-500" />
        <span className="text-xs font-bold whitespace-nowrap hidden sm:inline">{t.pwa.pwaSupport}</span>
      </button>

      {showDesktopHelp && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 animate-in fade-in" onClick={() => setShowDesktopHelp(false)}>
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-slate-950 border border-blue-700/50 flex items-center justify-center p-1">
                  <img src="./icons/icon.svg" alt="App Icon" className="w-full h-full rounded-lg" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{t.pwa.desktopGuideTitle}</h3>
                  <p className="text-[11px] text-slate-400">{t.pwa.desktopGuideDesc}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDesktopHelp(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-300">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <div className="flex items-center gap-1.5 text-white font-bold">
                  <Info className="w-3.5 h-3.5 text-blue-400" />
                  <span>{t.pwa.howToInstall}</span>
                </div>
                <p className="text-slate-400 leading-relaxed text-[11px]">
                  {t.pwa.howToInstallDesc}
                </p>
              </div>

              <div className="p-3 bg-blue-950/30 rounded-xl border border-blue-800/40 text-slate-300 space-y-1 text-[11px]">
                <div className="text-blue-300 font-bold flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{t.pwa.pwaFeatures}</span>
                </div>
                <p>• {t.pwa.pwaFeature1}</p>
                <p>• {t.pwa.pwaFeature2}</p>
                <p>• {t.pwa.pwaFeature3}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowDesktopHelp(false)}
              className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 py-2.5 text-xs font-bold text-white transition-colors"
            >
              {t.pwa.close}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
