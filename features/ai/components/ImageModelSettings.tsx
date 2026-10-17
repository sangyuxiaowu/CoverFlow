import { ImagePlus, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { AiConfig, ImageModelConfig } from '../types.ts';
import { AGNES_SIZES, createImageModel, DEFAULT_IMAGE_TIMEOUT_SECONDS, DEFAULT_REFERENCE_IMAGE_PROMPT, DEFAULT_TEXT_IMAGE_PROMPT, imageModelToolId, imageRequestUrl, IMAGE_RATIOS, KOLORS_SIZES } from '../services/imageGeneration.ts';

interface Props {
  config: AiConfig;
  onChange: (config: AiConfig) => void;
  english: boolean;
}

const inputClass = 'w-full min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 outline-none focus:border-blue-500';

export default function ImageModelSettings({ config, onChange, english }: Props) {
  const label = (zh: string, en: string) => english ? en : zh;
  const models = config.imageModels || [];
  const update = (id: string, patch: Partial<ImageModelConfig>) => onChange({ ...config, imageModels: models.map(model => model.id === id ? { ...model, ...patch } : model) });

  return (
    <section className="space-y-4 text-xs min-w-0">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-bold text-sm flex items-center gap-2"><ImagePlus size={16} />{label('生图模型', 'Image Models')}</h3>
        <div className="flex gap-2">
          {(['kolors', 'agnes'] as const).map(adapter => (
            <button key={adapter} type="button" className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800" onClick={() => onChange({ ...config, imageModels: [...models, createImageModel(adapter)] })}>
              <Plus size={13} />{adapter === 'kolors' ? 'Kolors' : 'Agnes'}
            </button>
          ))}
        </div>
      </div>
      {models.map(model => {
        const endpoint = config.endpoints.find(item => item.id === model.endpointId);
        let inheritedUrl = '';
        try { if (endpoint) inheritedUrl = imageRequestUrl(endpoint.endpoint); } catch {}
        return (
          <article key={model.id} className="border border-slate-700 rounded-lg p-4 space-y-3 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold text-sm min-w-0 break-words">{model.label}</span>
              <div className="flex items-center gap-3 shrink-0">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={model.enabled} disabled={!endpoint} onChange={event => update(model.id, { enabled: event.target.checked })} />
                  {label('启用', 'Enabled')}
                </label>
                <button type="button" title={label('删除生图模型', 'Delete image model')} aria-label={label('删除生图模型', 'Delete image model')} className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded" onClick={() => onChange({ ...config, imageModels: models.filter(item => item.id !== model.id) })}><Trash2 size={15} /></button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1"> <span>{label('名称', 'Name')}</span><input required className={inputClass} value={model.label} onChange={event => update(model.id, { label: event.target.value })} /></label>
              <label className="space-y-1"> <span>{label('API 模型 ID', 'API model ID')}</span><input required className={inputClass} value={model.modelId} onChange={event => update(model.id, { modelId: event.target.value })} /></label>
            </div>
            <label className="block space-y-1"><span>{label('模型介绍', 'Model description')}</span><textarea rows={2} className={inputClass} value={model.description} onChange={event => update(model.id, { description: event.target.value })} /></label>
            <label className="block space-y-1"><span>{label('凭据来源', 'Credential source')}</span>
              <select className={inputClass} value={model.endpointId} onChange={event => update(model.id, { endpointId: event.target.value, enabled: event.target.value ? model.enabled : false })}>
                <option value="">{label('选择已有端点', 'Select an existing endpoint')}</option>
                {config.endpoints.map(item => <option key={item.id} value={item.id}>{item.name} · {item.endpoint}</option>)}
              </select>
            </label>
            <label className="block space-y-1"><span>{label('请求 URL（留空继承端点）', 'Request URL (empty to inherit endpoint)')}</span><input type="url" className={inputClass} value={model.requestUrl} placeholder={inheritedUrl || (model.adapter === 'kolors' ? 'https://api.siliconflow.cn/v1/images/generations' : 'https://apihub.agnes-ai.com/v1/images/generations')} onChange={event => update(model.id, { requestUrl: event.target.value })} /></label>
            <label className="block space-y-1"><span>{label('生成等待超时（秒）', 'Generation timeout (seconds)')}</span><input type="number" min={60} max={600} step={1} required className={inputClass} value={model.timeoutSeconds ?? DEFAULT_IMAGE_TIMEOUT_SECONDS} onChange={event => update(model.id, { timeoutSeconds: Number(event.target.value) })} /></label>
            <details className="border-t border-slate-800 pt-3">
              <summary className="cursor-pointer font-semibold text-slate-300">{label('提示词参数说明', 'Prompt Parameter Descriptions')}</summary>
              <div className="space-y-3 pt-3">
                {([
                  ['textPromptDescription', label('文生图 prompt 说明', 'Text-to-image prompt description'), DEFAULT_TEXT_IMAGE_PROMPT],
                  ['referencePromptDescription', label('单图参考 prompt 说明', 'Single-reference prompt description'), DEFAULT_REFERENCE_IMAGE_PROMPT]
                ] as const).map(([field, name, fallback]) => (
                  <div key={field} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor={`${model.id}-${field}`}>{name}</label>
                      <button type="button" title={label('恢复默认说明', 'Restore default description')} aria-label={`${name}: ${label('恢复默认说明', 'Restore default description')}`} className="p-1 text-slate-400 hover:text-white" onClick={() => update(model.id, { [field]: fallback })}><RotateCcw size={13} /></button>
                    </div>
                    <textarea id={`${model.id}-${field}`} rows={5} required maxLength={10000} className={inputClass} value={model[field] ?? fallback} onChange={event => update(model.id, { [field]: event.target.value })} />
                  </div>
                ))}
              </div>
            </details>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1"><span>{label('默认尺寸', 'Default size')}</span>
                {model.adapter === 'kolors' ? <select className={inputClass} value={model.size} onChange={event => update(model.id, { size: event.target.value })}>{KOLORS_SIZES.map(size => <option key={size}>{size}</option>)}</select>
                  : <><input required className={inputClass} list={`sizes-${model.id}`} value={model.size} onChange={event => update(model.id, { size: event.target.value })} /><datalist id={`sizes-${model.id}`}>{AGNES_SIZES.map(size => <option key={size} value={size} />)}</datalist></>}
              </label>
              {model.adapter === 'agnes' && <label className="space-y-1"><span>{label('默认比例', 'Default ratio')}</span><select className={inputClass} disabled={!AGNES_SIZES.includes(model.size)} value={model.ratio} onChange={event => update(model.id, { ratio: event.target.value })}>{IMAGE_RATIOS.map(ratio => <option key={ratio}>{ratio}</option>)}</select></label>}
              {model.adapter === 'kolors' && <>
                <label className="space-y-1"><span>{label('推理步数', 'Inference steps')}</span><input type="number" min={1} max={100} step={1} required className={inputClass} value={model.steps} onChange={event => update(model.id, { steps: Number(event.target.value) })} /></label>
                <label className="space-y-1"><span>{label('引导强度', 'Guidance scale')}</span><input type="number" min={0} max={20} step={0.1} required className={inputClass} value={model.guidance} onChange={event => update(model.id, { guidance: Number(event.target.value) })} /></label>
              </>}
            </div>
            <div className="text-slate-500 break-all">ID: {imageModelToolId(model)}</div>
          </article>
        );
      })}
    </section>
  );
}