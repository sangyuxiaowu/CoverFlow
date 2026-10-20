import type { Progress } from './types.ts';

export function progressText(progress: Progress | undefined, english: boolean): string {
  if (!progress) return '';
  const labels: Record<string, [string, string]> = {
    runtime: ['初始化运行时', 'Initializing runtime'], model: ['加载模型', 'Loading model'],
    runtime_download: ['下载运行时', 'Downloading runtime'],
    webgpu: ['GPU 推理中', 'Running on GPU'], wasm: ['CPU 推理中', 'Running on CPU'],
    fallback: ['GPU 不兼容，切换 CPU', 'GPU unavailable, switching to CPU'],
    download: ['下载模型', 'Downloading model'], verify: ['验证模型', 'Verifying model']
  };
  const label = labels[progress.stage]?.[english ? 1 : 0] || progress.stage;
  if (progress.loaded === undefined) return label;
  const size = `${(progress.loaded / 1_000_000).toFixed(1)} MB`;
  return `${label} · ${size}${progress.total ? ` / ${(progress.total / 1_000_000).toFixed(1)} MB` : ''}`;
}

export function errorText(error: unknown, english: boolean): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'RUNTIME_MISSING') return english ? 'Install the runtime in AI Settings > Background Removal first.' : '请先在 AI 设置 > 抠图中安装运行时。';
  if (message === 'MODEL_MISSING') return english ? 'The selected model is missing. Import it in AI Settings > Background Removal.' : '所选模型不存在，请在 AI 设置 > 抠图中导入。';
  return message;
}