import { useEffect, useRef, useState } from 'react';
import { 
  Check, 
  CheckCircle2, 
  Download, 
  ExternalLink, 
  Info, 
  LoaderCircle, 
  Scissors, 
  ShieldCheck, 
  Sparkles, 
  Trash2, 
  Upload, 
  X, 
  Zap, 
  Layers, 
  Cpu, 
  FileCode, 
  AlertCircle 
} from 'lucide-react';
import { MODELS, type ModelId } from './models.ts';
import { installModel, verifyModel } from './index.ts';
import { downloadModel, importRuntime, installRuntime, loadResources, RUNTIME_ASSETS, RUNTIME_BASE } from './resources.ts';
import { deleteModel, deleteRuntime, readSettings, RUNTIME_VERSION, saveSettings } from './storage.ts';
import { errorText, progressText } from './status.ts';
import { useResources } from './useResources.ts';
import type { DeviceMode, Progress } from './types.ts';
import './background-removal.css';

export default function BackgroundRemovalSettings({ english }: { english: boolean }) {
  const state = useResources();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const controller = useRef<AbortController | null>(null);
  const modelInput = useRef<HTMLInputElement>(null);
  const runtimeInput = useRef<HTMLInputElement>(null);
  const importing = useRef<ModelId>('birefnet');
  const mounted = useRef(true);
  const text = (zh: string, en: string) => english ? en : zh;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  const perform = async (operation: (signal: AbortSignal, report: (value: Progress) => void) => Promise<unknown>) => {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setSuccess('');
    setProgress(undefined);
    try {
      await operation(abort.signal, value => { if (mounted.current) setProgress(value); });
      if (mounted.current && !abort.signal.aborted) setSuccess(text('已完成', 'Completed'));
    } catch (reason) {
      if (mounted.current && !abort.signal.aborted) setError(errorText(reason, english));
    } finally {
      controller.current = null;
      if (mounted.current) { setBusy(false); setProgress(undefined); }
    }
  };

  const update = (patch: { modelId?: ModelId; device?: DeviceMode }) => perform(async signal => {
    const settings = await readSettings();
    signal.throwIfAborted();
    await saveSettings({ ...settings, ...patch });
  });

  const acceptModel = async (id: ModelId, blob: Blob, name: string, signal: AbortSignal, report: (value: Progress) => void) => {
    await installModel(id, blob, name, state.settings.device, { signal, onProgress: report });
    signal.throwIfAborted();
    await saveSettings({ ...await readSettings(), modelId: id });
  };

  const progressPercent = progress?.total && progress?.loaded
    ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
    : undefined;

  return (
    <section className="cf-removal-settings space-y-6 text-slate-200" aria-label={text('抠图设置', 'Background removal settings')}>
      {/* 顶部标题与说明卡片 */}
      <div className="p-5 rounded-2xl border border-blue-500/25 bg-gradient-to-r from-blue-950/30 via-slate-900/60 to-indigo-950/20 shadow-lg shadow-blue-950/10 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="cf-removal-heading flex items-center gap-3 !mb-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/10 border border-blue-500/30 text-blue-400 flex items-center justify-center shadow-inner">
              <Scissors size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <span>{text('本地离线智能抠图', 'Local AI Background Removal')}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 font-mono border border-blue-500/30">
                  ONNX Web
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {text(
                  '基于 ONNX Runtime Web 视觉神经网络，在浏览器本地执行主体抠图，零网络依赖，数据不上云',
                  'Client-side deep learning matting with ONNX Runtime Web. 100% private, zero cloud data transfer'
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <span className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-900/80 border border-slate-800 text-slate-300 flex items-center gap-1.5 shadow-sm">
              <ShieldCheck size={13} className="text-emerald-400" />
              <span>{text('本地隐私安全', 'Local Privacy')}</span>
            </span>
            <span className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-900/80 border border-slate-800 text-slate-300 flex items-center gap-1.5 shadow-sm">
              <Zap size={13} className="text-amber-400" />
              <span>{text('WebGPU / WASM 加速', 'Hardware Accelerated')}</span>
            </span>
          </div>
        </div>
      </div>

      {/* 推理与计算设备参数卡片 */}
      <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/80 space-y-4 shadow-sm">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-800/80">
          <Cpu size={16} className="text-blue-400" />
          <h4 className="text-xs font-bold text-white uppercase tracking-wider">
            {text('推理参数与执行设备', 'Inference & Compute Settings')}
          </h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="removal-active-model" className="block text-xs font-semibold text-slate-300">
              {text('当前生效模型', 'Active Model')}
            </label>
            <div className="relative">
              <select
                id="removal-active-model"
                disabled={busy || state.loading}
                value={state.settings.modelId}
                onChange={event => void update({ modelId: event.target.value as ModelId })}
                className="w-full bg-slate-950/80 border border-slate-800 focus:border-blue-500/80 focus:ring-1 focus:ring-blue-500/30 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 outline-none transition-all cursor-pointer"
              >
                {MODELS.map(model => <option key={model.id} value={model.id} disabled={model.id !== 'u2netp' && !state.models[model.id]}>
                  {model.name} · {((state.models[model.id]?.blob.size ?? model.size) / 1_000_000).toFixed(1)} MB
                  {model.id === 'u2netp' ? text(' [内置]', ' [Bundled]') : !state.models[model.id] ? text(' [未安装]', ' [Not installed]') : ''}
                </option>)}
              </select>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {state.settings.modelId === 'modnet'
                ? text('人像专用，默认 FP32，512×512 输入，固定 CPU/WASM 稳定模式。', 'Portrait matting, FP32 by default, 512×512 input, fixed CPU/WASM stable mode.')
                : state.settings.modelId === 'birefnet'
                ? text('BiRefNet 轻量 512 本地版；导入对应 Lite 512 模型，旧模型需重新导入。', 'Local BiRefNet Lite 512; import the matching 512 model. Older cached models must be re-imported.')
                : text('快速轻量，日常人像、商品电商与扁平图标首选。', 'Fast and compact, great for everyday portraits, merchandise, and icons.')}
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="removal-device" className="block text-xs font-semibold text-slate-300">
              {text('计算加速设备', 'Compute Device')}
            </label>
            <div className="relative">
              <select
                id="removal-device"
                disabled={busy || state.loading}
                value={state.settings.device}
                onChange={event => void update({ device: event.target.value as DeviceMode })}
                className="w-full bg-slate-950/80 border border-slate-800 focus:border-blue-500/80 focus:ring-1 focus:ring-blue-500/30 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 outline-none transition-all cursor-pointer"
              >
                <option value="auto">{text('自动（GPU 优先，不兼容时自动回退）', 'Auto (GPU preferred with CPU fallback)')}</option>
                <option value="webgpu">WebGPU ({text('显卡硬件加速，速度最快', 'Hardware GPU acceleration, fastest')})</option>
                <option value="wasm">CPU / WASM SIMD ({text('通用 CPU 多线程兼容模式', 'Universal CPU multi-threaded')})</option>
              </select>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {state.settings.modelId === 'modnet'
                ? text('MODNet 已固定使用 CPU/WASM，避免当前 WebGPU 输出异常；此设备选项仍保留给其他模型。', 'MODNet always uses CPU/WASM to avoid incorrect WebGPU output; this device preference still applies to other models.')
                : text('推荐 Chrome 113+ 或 Edge 启用 WebGPU 获得极速推理体验。', 'Chrome 113+ or Edge with WebGPU recommended for maximum performance.')}
            </p>
          </div>
        </div>
      </div>

      {/* 运行时核心引擎卡片 */}
      <div className="cf-removal-runtime !m-0 p-5 rounded-2xl bg-slate-900/40 border border-slate-800/80 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <strong className="text-sm font-bold text-white tracking-tight">
                ONNX Runtime Web {RUNTIME_VERSION}
              </strong>
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${
                state.runtime
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 cf-removal-ready'
                  : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
              }`}>
                {state.runtime
                  ? text('✓ 已就绪 · 已持久化缓存', '✓ Cached · Offline ready')
                  : text('未安装 · 约 24 MB 运行库', 'Not installed · ~24 MB')}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {text(
                '在浏览器运行神经网络的基础执行环境（包含 WASM、SIMD 多线程与 WebGPU 算子库）。',
                'Core runtime for executing deep learning models in browser (WASM, SIMD threads, WebGPU shaders).'
              )}
            </p>
          </div>

          <div className="cf-removal-actions flex items-center gap-2 flex-wrap shrink-0">
            {!state.runtime && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void perform((signal, report) => installRuntime(signal, report))}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md shadow-blue-900/20 flex items-center gap-1.5 transition-all active:scale-[0.98] cursor-pointer"
              >
                <Download size={14} />
                <span>{text('一键下载运行时', 'Download runtime')}</span>
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => runtimeInput.current?.click()}
              title={text('导入同版本运行时文件（.mjs / .wasm）', 'Import trusted runtime files of the same version')}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Upload size={14} />
              <span>{text('导入运行时', 'Import runtime')}</span>
            </button>
            {state.runtime && (
              <button
                type="button"
                disabled={busy}
                title={text('清除运行时缓存', 'Clear runtime cache')}
                aria-label={text('清除运行时缓存', 'Clear runtime cache')}
                onClick={() => void perform(() => deleteRuntime())}
                className="px-3 py-2 rounded-xl text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Trash2 size={14} />
                <span>{text('清除缓存', 'Clear')}</span>
              </button>
            )}
          </div>
        </div>

        {/* 离线运行时文件清单 */}
        <details className="group rounded-xl border border-slate-800/80 bg-slate-950/40 p-3 transition-all">
          <summary className="cursor-pointer text-xs font-semibold text-slate-400 group-open:text-slate-200 flex items-center gap-2 select-none">
            <FileCode size={13} className="text-blue-400" />
            <span>{text('离线部署核心文件清单 (CDN / 局域网离线包)', 'Offline runtime asset files (CDN / Intranet pack)')}</span>
          </summary>
          <div className="mt-3 pt-3 border-t border-slate-800/60 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {Object.values(RUNTIME_ASSETS).map(name => (
              <a
                key={name}
                href={RUNTIME_BASE + name}
                target="_blank"
                rel="noreferrer"
                className="p-2 rounded-lg bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 text-[11px] text-blue-300 hover:text-blue-200 flex items-center justify-between gap-1 transition-colors group/link"
              >
                <span className="truncate font-mono">{name}</span>
                <ExternalLink size={12} className="opacity-60 group-hover/link:opacity-100 shrink-0" />
              </a>
            ))}
          </div>
        </details>
      </div>

      {/* 抠图模型库 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-blue-400" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              {text('视觉抠图模型库', 'Vision Matting Models')}
            </h4>
          </div>
          <span className="text-[11px] text-slate-400">
            {text('支持 ONNX 格式模型本地导入与推理验证', 'Supports ONNX format model import & verification')}
          </span>
        </div>

        <div className="cf-removal-models grid grid-cols-1 sm:grid-cols-2 gap-4">
          {MODELS.map(model => {
            const stored = state.models[model.id];
            const available = model.id === 'u2netp' || !!stored;
            const isActive = state.settings.modelId === model.id;

            return (
              <article
                key={model.id}
                className={`cf-removal-model !m-0 p-5 rounded-2xl border transition-all relative flex flex-col justify-between ${
                  isActive
                    ? 'bg-gradient-to-b from-blue-950/25 to-slate-900/70 border-blue-500/50 shadow-lg shadow-blue-950/20'
                    : 'bg-slate-900/40 border-slate-800/80 hover:border-slate-700/80'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="cf-removal-model-title flex items-center gap-2">
                      <strong className="text-sm font-bold text-white">{model.name}</strong>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-slate-800 text-slate-300 border border-slate-700/60">
                        {model.id === 'modnet' ? text('人像专用', 'Portraits') : model.id === 'u2netp' ? text('轻量通用', 'Lightweight') : text('本地 512', 'Local 512')}
                      </span>
                    </div>

                    {isActive && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/40 flex items-center gap-1 shadow-sm">
                        <Check size={11} />
                        {text('当前生效', 'Active')}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed mb-3">
                    {model.id === 'modnet'
                      ? text('MODNet 人像抠图，512 方形输入，直接输出 alpha。固定 CPU/WASM 稳定模式。', 'MODNet portrait matting with 512 square input and direct alpha. CPU/WASM stable mode.')
                      : model.id === 'u2netp'
                      ? text('轻巧极速，适合常规商品展架、人物轮廓与扁平图标，无需额外下载。', 'Fast and compact, ideal for products, portraits, and flat graphics.')
                      : text('BiRefNet Lite，轻量版的可实现高效抠图，适合普通主体和复杂边缘处理。', 'BiRefNet Lite. Lightweight version for efficient matting, suitable for ordinary subjects and complex edges.')}
                  </p>

                  <div className="cf-removal-meta flex flex-wrap gap-2 text-[11px] text-slate-400 mb-3">
                    <span className="px-2 py-0.5 rounded bg-slate-950/60 border border-slate-800 font-mono">
                      {((stored?.blob.size || model.size) / 1_000_000).toFixed(2)} MB
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-950/60 border border-slate-800 font-mono">
                      {model.inputSize} × {model.inputSize} px
                    </span>
                    <span className={`px-2 py-0.5 rounded font-medium border ${
                      stored
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : model.id === 'u2netp'
                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                        : 'bg-slate-800 text-slate-400 border-slate-700/50'
                    }`}>
                      {stored
                        ? text('已验证', 'Verified')
                        : model.id === 'u2netp'
                        ? text('随包内置', 'Bundled')
                        : text('未安装', 'Not installed')}
                    </span>
                    {stored && (
                      <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 font-medium">
                        {!model.forceCpu && stored.provider === 'webgpu' ? 'GPU 加速' : 'CPU WASM'}
                      </span>
                    )}
                  </div>

                  {stored && (
                    <div className="cf-removal-filename text-[11px] text-slate-400 bg-slate-950/60 border border-slate-800/80 rounded-lg p-2 font-mono truncate mb-3" title={stored.name}>
                      <span className="text-slate-500 mr-1.5">{text('文件:', 'File:')}</span>
                      {stored.name}
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-800/80">
                  <div className="cf-removal-actions flex items-center gap-2 flex-wrap">
                    {model.variants?.map(variant => (
                      <button
                        key={variant.precision}
                        type="button"
                        disabled={busy || !state.runtime}
                        onClick={() => void perform(async (signal, report) => {
                          const blob = await downloadModel(model.id, signal, report, variant.precision);
                          const name = new URL(variant.url).pathname.split('/').at(-1) || `${model.id}_${variant.precision}.onnx`;
                          await acceptModel(model.id, blob, name, signal, report);
                        })}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                      >
                        <Download size={13} />
                        <span>{text('下载', 'Download')} {variant.precision.toUpperCase()} · {(variant.size / 1_000_000).toFixed(1)} MB</span>
                      </button>
                    ))}

                    <button
                      type="button"
                      disabled={busy || !state.runtime}
                      onClick={() => {
                        importing.current = model.id;
                        modelInput.current?.click();
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Upload size={13} />
                      <span>{text('导入 ONNX', 'Import ONNX')}</span>
                    </button>

                    {available && (
                      <button
                        type="button"
                        disabled={busy || !state.runtime}
                        onClick={() => void perform(async (signal, report) => {
                          const resources = await loadResources(model.id, signal);
                          const provider = await verifyModel(model.id, resources.model, state.settings.device, { signal, onProgress: report });
                          report({ stage: provider });
                        })}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <CheckCircle2 size={13} />
                        <span>{text('验证推理', 'Verify')}</span>
                      </button>
                    )}

                    {stored && (
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={text(`删除 ${model.name} 导入文件`, `Delete imported ${model.name}`)}
                        title={text('删除导入文件', 'Delete imported file')}
                        onClick={() => void perform(async () => {
                          if (state.settings.modelId === model.id) await saveSettings({ ...state.settings, modelId: 'u2netp' });
                          await deleteModel(model.id);
                        })}
                        className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-colors cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}

                    <a
                      href={model.sourceUrl ?? model.url}
                      target="_blank"
                      rel="noreferrer"
                      title={text('查看源权重', 'Open source model page')}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700/80 transition-colors"
                    >
                      <ExternalLink size={13} />
                    </a>

                    {!isActive && available && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void update({ modelId: model.id })}
                        className="ml-auto text-xs text-blue-400 hover:text-blue-300 font-semibold cursor-pointer underline-offset-4 hover:underline"
                      >
                        {text('设为默认', 'Set as Active')}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {/* 隐藏的本地文件输入 */}
      <input
        ref={modelInput}
        type="file"
        accept=".onnx"
        hidden
        onChange={event => {
          const file = event.target.files?.[0];
          const id = importing.current;
          event.target.value = '';
          if (file) void perform((signal, report) => acceptModel(id, file, file.name, signal, report));
        }}
      />
      <input
        ref={runtimeInput}
        type="file"
        accept=".mjs,.wasm"
        multiple
        hidden
        onChange={event => {
          const files = Array.from(event.target.files || []);
          event.target.value = '';
          if (files.length) void perform(() => importRuntime(files));
        }}
      />

      {/* 忙碌状态浮层 / 进度卡片 */}
      {busy && (
        <div role="status" className="cf-removal-status p-4 rounded-xl bg-blue-950/40 border border-blue-500/30 shadow-lg flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3 w-full">
            <div className="flex items-center gap-2 min-w-0">
              <LoaderCircle size={15} className="animate-spin text-blue-400 shrink-0" />
              <span className="text-xs font-semibold text-blue-200 truncate">
                {progressText(progress, english) || text('正在处理中...', 'Processing...')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => controller.current?.abort()}
              title={text('取消', 'Cancel')}
              aria-label={text('取消', 'Cancel')}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0"
            >
              <X size={14} />
            </button>
          </div>

          <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-300 ${progressPercent === undefined ? 'w-full animate-pulse' : ''}`}
              style={{ width: progressPercent !== undefined ? `${progressPercent}%` : '100%' }}
            />
          </div>
        </div>
      )}

      {/* 错误提示框 */}
      {(error || state.error) && (
        <div role="alert" className="cf-removal-error p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium flex items-center gap-2 animate-in fade-in">
          <AlertCircle size={16} className="text-rose-400 shrink-0" />
          <span className="break-all">{error || state.error}</span>
        </div>
      )}

      {/* 成功状态提示 */}
      {!busy && success && (
        <div role="status" className="cf-removal-ready p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          <span>{success}</span>
        </div>
      )}
    </section>
  );
}