import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { LoaderCircle, Scissors, X } from 'lucide-react';
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

  return <div className="cf-removal-layer">
    <div className="cf-removal-actions">
      <button type="button" disabled={busy || !!disabledReason} aria-describedby={disabledReason ? hintId : undefined}
        title={disabledReason || text('移除图片背景', 'Remove image background')}
        onClick={() => void remove()}>
        {busy ? <LoaderCircle size={13} className="animate-spin" /> : <Scissors size={13} />}
        {text('抠图', 'Remove background')}
      </button>
      <label className="cf-removal-keep-original">
        <input type="checkbox" checked={keepOriginal} disabled={busy || !!layer.backgroundRemoved}
          onChange={event => setKeepOriginal(event.target.checked)} />
        {text('保留原图', 'Keep original')}
      </label>
      {busy && <button type="button" onClick={() => controller.current?.abort()}
        title={text('取消抠图', 'Cancel background removal')} aria-label={text('取消抠图', 'Cancel background removal')}><X size={13} /></button>}
    </div>
    {!busy && disabledReason && <p id={hintId} className="cf-removal-hint">{disabledReason}</p>}
    {busy && <p role="status">{progressText(progress, english) || text('准备中', 'Preparing')}</p>}
    {(error || resources.error) && <p role="alert" className="cf-removal-error">{error || resources.error}</p>}
  </div>;
}