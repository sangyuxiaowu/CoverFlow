import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, ExternalLink, LoaderCircle, Scissors, Trash2, Upload, X } from 'lucide-react';
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

  return <section className="cf-removal-settings" aria-label={text('抠图设置', 'Background removal settings')}>
    <div className="cf-removal-heading"><Scissors size={18} /><h3>{text('本地抠图', 'Local Background Removal')}</h3></div>
    <div className="cf-removal-controls">
      <label htmlFor="removal-active-model">{text('当前模型', 'Active model')}</label>
      <select id="removal-active-model" disabled={busy || state.loading} value={state.settings.modelId}
        onChange={event => void update({ modelId: event.target.value as ModelId })}>
        <option value="u2netp">U2NetP · {text('轻量', 'Lightweight')}</option>
        <option value="birefnet" disabled={!state.models.birefnet}>BiRefNet FP16 · {text('高质量', 'High quality')}</option>
      </select>
      <label htmlFor="removal-device">{text('计算设备', 'Compute device')}</label>
      <select id="removal-device" disabled={busy || state.loading} value={state.settings.device}
        onChange={event => void update({ device: event.target.value as DeviceMode })}>
        <option value="auto">{text('自动（GPU 优先）', 'Auto (GPU preferred)')}</option>
        <option value="webgpu">WebGPU</option><option value="wasm">CPU / WASM</option>
      </select>
    </div>

    <div className="cf-removal-runtime">
      <div><strong>ONNX Runtime {RUNTIME_VERSION}</strong><span className={state.runtime ? 'cf-removal-ready' : ''}>
        {state.runtime ? text('已缓存 · 可离线', 'Cached · Offline ready') : text('未安装 · 约 24 MB', 'Not installed · ~24 MB')}
      </span></div>
      <div className="cf-removal-actions">
        {!state.runtime && <button type="button" disabled={busy} onClick={() => void perform((signal, report) => installRuntime(signal, report))}>
          <Download size={14} />{text('下载运行时', 'Download runtime')}</button>}
        <button type="button" disabled={busy} onClick={() => runtimeInput.current?.click()}
          title={text('仅导入可信来源的同版本运行时文件', 'Only import trusted runtime files of the same version')}>
          <Upload size={14} />{text('导入运行时', 'Import runtime')}</button>
        {state.runtime && <button type="button" disabled={busy} title={text('清除运行时缓存', 'Clear runtime cache')}
          aria-label={text('清除运行时缓存', 'Clear runtime cache')} onClick={() => void perform(() => deleteRuntime())}><Trash2 size={14} /></button>}
      </div>
      <details><summary>{text('离线运行时文件', 'Offline runtime files')}</summary>
        {Object.values(RUNTIME_ASSETS).map(name => <a key={name} href={RUNTIME_BASE + name} target="_blank" rel="noreferrer">{name}<ExternalLink size={12} /></a>)}
      </details>
    </div>

    <div className="cf-removal-models">
      {MODELS.map(model => {
        const stored = state.models[model.id];
        const available = model.id === 'u2netp' || !!stored;
        return <article key={model.id} className="cf-removal-model">
          <div className="cf-removal-model-title"><strong>{model.name}</strong>
            <span>{model.id === 'u2netp' ? text('轻量', 'Lightweight') : text('高质量', 'High quality')}</span></div>
          <div className="cf-removal-meta">
            <span>{((stored?.blob.size || model.size) / 1_000_000).toFixed(2)} MB</span>
            <span>{stored ? text('已验证', 'Verified') : model.id === 'u2netp' ? text('随包内置', 'Bundled') : text('未安装', 'Not installed')}</span>
            {stored && <span>{stored.provider === 'webgpu' ? 'GPU' : 'CPU'}</span>}
          </div>
          {stored && <div className="cf-removal-filename" title={stored.name}>{stored.name}</div>}
          <div className="cf-removal-actions">
            {model.id === 'birefnet' && <button type="button" disabled={busy || !state.runtime}
              onClick={() => void perform(async (signal, report) => {
                const blob = await downloadModel(model.id, signal, report);
                await acceptModel(model.id, blob, 'model_fp16.onnx', signal, report);
              })}><Download size={14} />{stored ? text('重新下载', 'Download again') : text('下载', 'Download')}</button>}
            <button type="button" disabled={busy || !state.runtime} onClick={() => {
              importing.current = model.id;
              modelInput.current?.click();
            }}><Upload size={14} />{text('导入 ONNX', 'Import ONNX')}</button>
            {available && <button type="button" disabled={busy || !state.runtime} onClick={() => void perform(async (signal, report) => {
              const resources = await loadResources(model.id, signal);
              const provider = await verifyModel(model.id, resources.model, state.settings.device, { signal, onProgress: report });
              report({ stage: provider });
            })}><CheckCircle2 size={14} />{text('验证', 'Verify')}</button>}
            {stored && <button type="button" disabled={busy} aria-label={text(`删除 ${model.name} 导入文件`, `Delete imported ${model.name}`)}
              title={text('删除导入文件', 'Delete imported file')} onClick={() => void perform(async () => {
                if (state.settings.modelId === model.id) await saveSettings({ ...state.settings, modelId: 'u2netp' });
                await deleteModel(model.id);
              })}><Trash2 size={14} /></button>}
            <a href={model.url} target="_blank" rel="noreferrer" title={text('打开下载链接', 'Open download link')}><ExternalLink size={14} /></a>
          </div>
        </article>;
      })}
    </div>
    <input ref={modelInput} type="file" accept=".onnx" hidden onChange={event => {
      const file = event.target.files?.[0];
      const id = importing.current;
      event.target.value = '';
      if (file) void perform((signal, report) => acceptModel(id, file, file.name, signal, report));
    }} />
    <input ref={runtimeInput} type="file" accept=".mjs,.wasm" multiple hidden onChange={event => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      if (files.length) void perform(() => importRuntime(files));
    }} />
    {busy && <div role="status" className="cf-removal-status"><LoaderCircle size={14} className="animate-spin" />
      <span>{progressText(progress, english) || text('处理中', 'Processing')}</span>
      <button type="button" onClick={() => controller.current?.abort()} title={text('取消', 'Cancel')} aria-label={text('取消', 'Cancel')}><X size={14} /></button>
    </div>}
    {(error || state.error) && <p role="alert" className="cf-removal-error">{error || state.error}</p>}
    {!busy && success && <p role="status" className="cf-removal-ready">{success}</p>}
  </section>;
}