import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { 
  Check, 
  CheckCircle2, 
  Cpu, 
  Info, 
  LoaderCircle, 
  Scissors, 
  Sparkles, 
  X, 
  Zap, 
  AlertCircle 
} from 'lucide-react';
import type { Layer } from '../../types.ts';
import { blobDataUrl, removeBackground } from './index.ts';
import { download } from './resources.ts';
import { errorText, progressText } from './status.ts';
import { useResources } from './useResources.ts';
import type { Progress, RemovalResult } from './types.ts';
import './background-removal.css';

export default function RemoveBackgroundButton({ layer, english, onApply }: {
  layer: Layer;
  english: boolean;
  onApply: (result: RemovalResult) => void;
}) {
  const resources = useResources();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState('');
  const [keepOriginal, setKeepOriginal] = useState(true);
  const hintId = useId();
  const latest = useRef({ layer, onApply });
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useLayoutEffect(() => { latest.current = { layer, onApply }; }, [layer, onApply]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  const text = (zh: string, en: string) => english ? en : zh;

  const disabledReason = layer.backgroundRemoved
    ? text('此图片已完成抠图，不可重复处理。', 'Background already removed. This image cannot be processed again.')
    : layer.locked ? text('请先解锁图片图层。', 'Unlock the image layer first.')
    : resources.loading ? text('正在读取抠图设置…', 'Loading background-removal settings...')
    : !resources.runtime ? text('请前往 AI 助手 > 配置中心 > 抠图，下载或导入运行时。', 'Go to AI Assistant > Settings > Background Removal to download or import the runtime.')
    : resources.settings.modelId === 'birefnet' && !resources.models.birefnet
      ? text('所选模型未安装，请前往 AI 助手 > 配置中心 > 抠图导入模型。', 'Install the selected model in AI Assistant > Settings > Background Removal.')
    : '';

  const remove = async () => {
    if (controller.current || disabledReason) return;
    const abort = new AbortController();
    controller.current = abort;
    const original = layer.content;
    const id = layer.id;
    setBusy(true);
    setError('');
    try {
      const url = new URL(original, window.location.href);
      if (!['data:', 'blob:', 'https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported image URL');
      const image = await download(url.href, 50 * 1024 * 1024, abort.signal);
      const result = await removeBackground(image, { signal: abort.signal, onProgress: value => {
        if (mounted.current) setProgress(value);
      } });
      const content = await blobDataUrl(result.blob);
      abort.signal.throwIfAborted();
      const current = latest.current;
      if (!mounted.current || current.layer.id !== id || current.layer.content !== original || current.layer.locked || current.layer.backgroundRemoved) {
        throw new Error(text('原图已更改，未替换抠图结果。', 'The original image changed; result was not applied.'));
      }
      current.onApply({ layerId: id, originalContent: original, content, keepOriginal });
    } catch (reason) {
      if (mounted.current && !abort.signal.aborted) setError(errorText(reason, english));
    } finally {
      controller.current = null;
      if (mounted.current) { setBusy(false); setProgress(undefined); }
    }
  };

  const modelBadgeName = resources.settings.modelId === 'birefnet' ? 'BiRefNet' : 'U2NetP';
  const deviceBadge = resources.settings.device === 'auto'
    ? 'GPU / Auto'
    : resources.settings.device === 'webgpu'
    ? 'WebGPU'
    : 'WASM';

  const progressPercent = progress?.total && progress?.loaded
    ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
    : undefined;

  return (
    <div className="cf-removal-layer bg-slate-900/60 border border-slate-800 rounded-xl p-2.5 space-y-2.5 transition-all hover:border-slate-700/80 shadow-sm">
      {/* 头部：标题与状态标签 */}
      <div className="flex items-center justify-between gap-1.5 pb-1 border-b border-slate-800/60">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-200">
          <div className="p-1 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Scissors className="w-3 h-3" />
          </div>
          <span>{text('AI 智能抠图', 'AI Background Removal')}</span>
        </div>

        <div className="flex items-center gap-1">
          {layer.backgroundRemoved ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <Check className="w-2.5 h-2.5" />
              {text('已抠图', 'Removed')}
            </span>
          ) : resources.loading ? (
            <span className="text-[9px] text-slate-500">{text('检测中...', 'Checking...')}</span>
          ) : resources.runtime ? (
            <span 
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20"
              title={`${modelBadgeName} · ${deviceBadge}`}
            >
              <Zap className="w-2.5 h-2.5 text-blue-400" />
              {modelBadgeName}
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
              {text('未就绪', 'Unready')}
            </span>
          )}
        </div>
      </div>

      {/* 操作栏：主按钮、保留原图开关与取消按钮 */}
      <div className="cf-removal-actions flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !!disabledReason}
          aria-describedby={disabledReason ? hintId : undefined}
          title={disabledReason || text('一键移除图片背景', 'Remove image background')}
          onClick={() => void remove()}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            busy
              ? 'bg-blue-600/20 border border-blue-500/30 text-blue-300 shadow-sm'
              : disabledReason
              ? 'bg-slate-800/80 border border-slate-700/40 text-slate-500 cursor-not-allowed opacity-60'
              : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md shadow-blue-900/20 active:scale-[0.98]'
          }`}
        >
          {busy ? (
            <LoaderCircle size={13} className="animate-spin text-blue-300" />
          ) : (
            <Scissors size={13} className={disabledReason ? 'text-slate-500' : 'text-blue-100'} />
          )}
          <span>{busy ? text('抠图中...', 'Processing...') : text('一键抠图', 'Remove BG')}</span>
        </button>

        <label 
          className="cf-removal-keep-original flex items-center gap-1.5 text-[11px] font-medium text-slate-300 hover:text-white cursor-pointer select-none shrink-0 px-2 py-1.5 rounded-lg bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 transition-colors"
          title={text('抠图后在保留原图的基础上新建透明图层', 'Keep the original image layer intact and create a new layer')}
        >
          <input
            type="checkbox"
            checked={keepOriginal}
            disabled={busy || !!layer.backgroundRemoved}
            onChange={event => setKeepOriginal(event.target.checked)}
            className="w-3.5 h-3.5 accent-blue-500 rounded cursor-pointer"
          />
          <span>{text('保留原图', 'Keep orig')}</span>
        </label>

        {busy && (
          <button
            type="button"
            onClick={() => controller.current?.abort()}
            title={text('取消抠图', 'Cancel background removal')}
            aria-label={text('取消抠图', 'Cancel background removal')}
            className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/30 transition-colors cursor-pointer shrink-0"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* 忙碌状态：进度条与状态文字 */}
      {busy && (
        <div className="space-y-1.5 pt-1">
          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div 
              className={`h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-300 ${progressPercent === undefined ? 'w-full animate-pulse' : ''}`}
              style={{ width: progressPercent !== undefined ? `${progressPercent}%` : '100%' }}
            />
          </div>
          <p role="status" className="text-[10px] text-blue-300 font-medium flex items-center gap-1.5 truncate">
            <LoaderCircle size={10} className="animate-spin text-blue-400 shrink-0" />
            <span className="truncate">{progressText(progress, english) || text('准备中...', 'Preparing...')}</span>
            {progressPercent !== undefined && (
              <span className="font-mono text-[9px] text-blue-400 ml-auto">{progressPercent}%</span>
            )}
          </p>
        </div>
      )}

      {/* 禁用原因或操作提示 */}
      {!busy && disabledReason && (
        <div 
          id={hintId} 
          className={`cf-removal-hint text-[10px] leading-relaxed rounded-lg p-2 border flex items-start gap-1.5 ${
            layer.backgroundRemoved
              ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300/90'
              : !resources.runtime
              ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
              : 'bg-slate-800/40 border-slate-700/50 text-slate-400'
          }`}
        >
          {layer.backgroundRemoved ? (
            <CheckCircle2 size={12} className="text-emerald-400 shrink-0 mt-0.5" />
          ) : !resources.runtime ? (
            <Info size={12} className="text-amber-400 shrink-0 mt-0.5" />
          ) : (
            <Info size={12} className="text-slate-400 shrink-0 mt-0.5" />
          )}
          <span>{disabledReason}</span>
        </div>
      )}

      {/* 错误提示 */}
      {(error || resources.error) && (
        <div role="alert" className="cf-removal-error text-[10px] leading-relaxed rounded-lg p-2 bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-start gap-1.5">
          <AlertCircle size={12} className="text-rose-400 shrink-0 mt-0.5" />
          <span className="break-all">{error || resources.error}</span>
        </div>
      )}
    </div>
  );
}