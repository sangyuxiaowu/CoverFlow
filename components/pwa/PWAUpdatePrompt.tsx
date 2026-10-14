import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { translations, Language } from '../../translations.ts';

const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

interface PWAUpdatePromptProps {
  lang: Language;
  onShowToast?: (msg: string, type?: 'success' | 'error') => void;
}

export const PWAUpdatePrompt = ({ lang, onShowToast }: PWAUpdatePromptProps) => {
  const t = translations[lang];
  const [isDismissed, setIsDismissed] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const cleanupRef = useRef<(() => void) | null>(null);
  const isTauriRuntime = import.meta.env.VITE_APP_MODE === 'tauri' || isTauri();

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(swUrl, registration) {
      if (!registration) return;
      registrationRef.current = registration;

      if (registration.waiting) {
        setIsDismissed(false);
        setNeedRefresh(true);
      }

      const handleUpdateFound = () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;
        installingWorker.addEventListener('statechange', () => {
          if (
            installingWorker.state === 'installed' &&
            navigator.serviceWorker.controller
          ) {
            setIsDismissed(false);
            setNeedRefresh(true);
          }
        });
      };

      registration.addEventListener('updatefound', handleUpdateFound);

      const checkForUpdate = async () => {
        if (registration.installing || !navigator.onLine) return;
        try {
          const resp = await fetch(swUrl, {
            cache: 'no-store',
            headers: {
              cache: 'no-store',
              'cache-control': 'no-cache',
            },
          });
          if (resp?.status === 200) {
            await registration.update();
            if (registration.waiting) {
              setIsDismissed(false);
              setNeedRefresh(true);
            }
          }
        } catch {
          // Ignore network errors while offline
        }
      };

      void checkForUpdate();

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          void checkForUpdate();
        }
      };

      const handleFocus = () => {
        void checkForUpdate();
      };

      const intervalId = window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('focus', handleFocus);
      window.addEventListener('online', handleFocus);

      cleanupRef.current?.();
      cleanupRef.current = () => {
        window.clearInterval(intervalId);
        registration.removeEventListener('updatefound', handleUpdateFound);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('focus', handleFocus);
        window.removeEventListener('online', handleFocus);
      };
    },
  });

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (offlineReady) {
      onShowToast?.(t.pwa.offlineReadyNotice, 'success');
      setOfflineReady(false);
    }
  }, [offlineReady, setOfflineReady, onShowToast, t.pwa.offlineReadyNotice]);

  if (import.meta.env.DEV || isTauriRuntime || !needRefresh) {
    return null;
  }

  const handleUpdateNow = async () => {
    setIsUpdating(true);
    let reloaded = false;
    const reloadOnce = () => {
      if (!reloaded) {
        reloaded = true;
        window.location.reload();
      }
    };

    try {
      navigator.serviceWorker?.addEventListener('controllerchange', reloadOnce, {
        once: true,
      });

      if (registrationRef.current?.waiting) {
        registrationRef.current.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      await updateServiceWorker(true);
      window.setTimeout(reloadOnce, 1000);
    } catch {
      reloadOnce();
    }
  };

  if (isDismissed) {
    return (
      <button
        type="button"
        onClick={() => setIsDismissed(false)}
        className="fixed bottom-4 right-4 z-[120] flex items-center gap-2 rounded-full bg-blue-600/95 hover:bg-blue-500 text-white px-3.5 py-2 text-xs font-bold shadow-xl shadow-blue-950/50 border border-blue-400/40 backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-2"
        title={t.pwa.updateAvailableTitle}
      >
        <span className="h-2 w-2 rounded-full bg-emerald-300 animate-ping" />
        <RefreshCw className="w-3.5 h-3.5" />
        <span>{t.pwa.updateReadyBadge}</span>
      </button>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-labelledby="pwa-update-title"
      aria-describedby="pwa-update-desc"
      className="fixed bottom-5 right-5 z-[120] w-[calc(100vw-2.5rem)] max-w-sm rounded-2xl bg-slate-900/95 backdrop-blur-md border border-blue-500/40 p-4 shadow-2xl shadow-blue-950/40 text-slate-100 animate-in fade-in slide-in-from-bottom-3"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-blue-950/80 border border-blue-700/50 flex items-center justify-center text-blue-400 shrink-0 mt-0.5">
          <Sparkles className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <h4 id="pwa-update-title" className="text-xs sm:text-sm font-bold text-white">
              {t.pwa.updateAvailableTitle}
            </h4>
            <button
              type="button"
              onClick={() => setIsDismissed(true)}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              aria-label={t.pwa.updateLater}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <p id="pwa-update-desc" className="text-xs text-slate-300 leading-relaxed">
            {t.pwa.updateAvailableDesc}
          </p>

          <div className="flex items-center justify-end gap-2 pt-2.5">
            <button
              type="button"
              onClick={() => setIsDismissed(true)}
              disabled={isUpdating}
              className="px-3 py-1.5 text-xs font-bold text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700 rounded-xl transition-colors disabled:opacity-50"
            >
              {t.pwa.updateLater}
            </button>
            <button
              type="button"
              onClick={handleUpdateNow}
              disabled={isUpdating}
              className="px-3.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isUpdating ? 'animate-spin' : ''}`} />
              <span>{isUpdating ? t.pwa.updating : t.pwa.updateNow}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
