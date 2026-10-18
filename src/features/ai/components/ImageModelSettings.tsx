import React, { useState, useRef, useEffect } from 'react';
import {
  ImagePlus,
  Plus,
  RotateCcw,
  Trash2,
  Sparkles,
  Sliders,
  Link,
  Clock,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import type { AiConfig, ImageModelConfig } from '../types.ts';
import {
  createImageModel,
  imageCapabilities,
  IMAGE_MODEL_PRESETS,
  imageModelToolId,
  imageRequestUrl,
  imageTimeoutSeconds,
  type ImagePresetId,
  type ImageQuality
} from '../image-generation/index.ts';

interface Props {
  config: AiConfig;
  onChange: (config: AiConfig) => void;
  english: boolean;
}

const inputClass =
  'w-full bg-slate-950/90 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all';
const labelClass = 'text-[11px] font-medium text-slate-400 block mb-1';

// 现代平滑开关滑块组件
const ToggleSwitch: React.FC<{
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  id?: string;
}> = ({ checked, disabled, onChange, label, id }) => {
  return (
    <div className="flex items-center gap-2">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={e => {
          e.stopPropagation();
          if (!disabled) onChange(!checked);
        }}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 ${
          checked ? 'bg-indigo-600 shadow-sm shadow-indigo-600/40' : 'bg-slate-700 hover:bg-slate-650'
        } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
      >
        <span
          className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out ${
            checked ? 'translate-x-4' : 'translate-x-1'
          }`}
        />
      </button>
      {label && (
        <span
          onClick={e => {
            e.stopPropagation();
            if (!disabled) onChange(!checked);
          }}
          className={`text-xs font-semibold select-none cursor-pointer ${
            disabled ? 'text-slate-500 cursor-not-allowed' : checked ? 'text-indigo-300' : 'text-slate-400'
          }`}
        >
          {label}
        </span>
      )}
    </div>
  );
};

export default function ImageModelSettings({ config, onChange, english }: Props) {
  const label = (zh: string, en: string) => (english ? en : zh);
  const models = config.imageModels || [];

  // 控制每个模型的折叠/展开状态
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    models.forEach((m, i) => {
      initial[m.id] = i === 0; // 默认展开第一个模型
    });
    return initial;
  });

  // 记录刚刚新增的模型 ID，用于自动展开、平滑滚动定位与高亮提示
  const [newlyAddedId, setNewlyAddedId] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});

  const toggleExpand = (id: string) => {
    setExpandedMap(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAll = () => {
    const next: Record<string, boolean> = {};
    models.forEach(m => {
      next[m.id] = true;
    });
    setExpandedMap(next);
  };

  const collapseAll = () => {
    const next: Record<string, boolean> = {};
    models.forEach(m => {
      next[m.id] = false;
    });
    setExpandedMap(next);
  };

  const update = (id: string, patch: Partial<ImageModelConfig>) =>
    onChange({
      ...config,
      imageModels: models.map(model => (model.id === id ? { ...model, ...patch } : model))
    });

  // 添加新模型时的处理：新增 -> 自动展开 -> 平滑滚动到视野内 -> 边缘高亮反馈
  const handleAddModel = (presetId: ImagePresetId) => {
    const newModel = createImageModel(presetId);
    setExpandedMap(prev => ({ ...prev, [newModel.id]: true }));
    setNewlyAddedId(newModel.id);

    onChange({
      ...config,
      imageModels: [...models, newModel]
    });
  };

  useEffect(() => {
    if (!newlyAddedId) return;
    const targetElement = cardRefs.current[newlyAddedId];
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const timer = setTimeout(() => {
      setNewlyAddedId(null);
    }, 2500);
    return () => clearTimeout(timer);
  }, [newlyAddedId, models.length]);

  return (
    <section className="space-y-5 text-xs min-w-0">
      {/* 顶部控制栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-800/80">
        <div>
          <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
            <span className="p-1 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <ImagePlus size={15} />
            </span>
            <span>{label('生图模型配置', 'Image Generation Models')}</span>
            <span className="text-xs font-normal text-slate-500">
              ({label(`已配置 ${models.length} 个`, `${models.length} configured`)})
            </span>
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            {label(
              '配置用于在画布中一键生成封面插图、背景和元素的 AI 图像模型。',
              'Configure AI models used for on-canvas image, background, and element generation.'
            )}
          </p>
        </div>

        {/* 添加模型预设与批量折叠/展开 */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {models.length > 1 && (
            <div className="flex items-center gap-1.5 mr-1 text-slate-400 text-xs">
              <button
                type="button"
                onClick={expandAll}
                className="px-2 py-1 rounded-lg hover:bg-slate-800 hover:text-slate-200 transition-colors cursor-pointer"
              >
                {label('全部展开', 'Expand All')}
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={collapseAll}
                className="px-2 py-1 rounded-lg hover:bg-slate-800 hover:text-slate-200 transition-colors cursor-pointer"
              >
                {label('全部折叠', 'Collapse All')}
              </button>
            </div>
          )}

          <div className="relative">
            <select
              aria-label={label('添加生图模型', 'Add image model')}
              className="bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-500/40 rounded-xl text-xs font-semibold text-indigo-300 hover:text-white px-3 py-1.5 outline-none cursor-pointer transition-all shadow-sm"
              value=""
              onChange={event => {
                if (event.target.value) {
                  handleAddModel(event.target.value as ImagePresetId);
                }
              }}
            >
              <option value="" disabled className="bg-slate-900 text-slate-400">
                + {label('添加生图模型预设...', 'Add Model Preset...')}
              </option>
              {IMAGE_MODEL_PRESETS.map(preset => (
                <option key={preset.id} value={preset.id} className="bg-slate-900 text-slate-200">
                  {preset.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {models.length === 0 ? (
        <div className="text-center py-12 px-4 rounded-2xl border border-dashed border-slate-800 bg-slate-950/30">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center mx-auto mb-3">
            <ImagePlus size={22} />
          </div>
          <div className="text-sm font-semibold text-slate-300">
            {label('暂无配置的生图模型', 'No image models configured')}
          </div>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
            {label(
              '点击右上角选择预设（如 Kolors、Agnes 等），即可在对话中直接让 AI 绘制图像并插入画布。',
              'Select a preset (e.g. Kolors, Agnes) from above to let AI generate images directly into your canvas.'
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-3.5">
          {models.map(model => {
            const isExpanded = Boolean(expandedMap[model.id]);
            const isNewlyAdded = newlyAddedId === model.id;
            const endpoint = config.endpoints.find(item => item.id === model.endpointId);
            const capabilities = imageCapabilities(model);
            let inheritedUrl = '';
            try {
              if (endpoint) inheritedUrl = imageRequestUrl(endpoint.endpoint);
            } catch {}

            return (
              <article
                key={model.id}
                ref={el => {
                  cardRefs.current[model.id] = el;
                }}
                className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
                  isNewlyAdded
                    ? 'ring-2 ring-indigo-500 bg-indigo-950/20 border-indigo-500 shadow-lg shadow-indigo-950/30'
                    : model.enabled
                    ? 'bg-slate-900/80 border-slate-700/80 shadow-md shadow-indigo-950/10'
                    : 'bg-slate-900/40 border-slate-800/80 opacity-90'
                }`}
              >
                {/* 模型卡片头部（点击整行折叠/展开） */}
                <div
                  onClick={() => toggleExpand(model.id)}
                  className="p-4 bg-slate-900/90 border-b border-slate-800/80 flex items-center justify-between gap-3 cursor-pointer select-none hover:bg-slate-800/40 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="p-1 rounded-lg text-slate-400 hover:text-white bg-slate-800/60 shrink-0">
                      {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </span>

                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
                        model.enabled
                          ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                          : 'bg-slate-800 text-slate-500 border-slate-700'
                      }`}
                    >
                      <Sparkles size={15} />
                    </div>

                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                        <span className="truncate">{model.label}</span>
                        {isNewlyAdded && (
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold animate-pulse">
                            {label('刚刚添加', 'Newly Added')}
                          </span>
                        )}
                        {model.enabled ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            {label('已启用', 'Enabled')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                            {label('已停用', 'Disabled')}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono truncate mt-0.5 flex items-center gap-2">
                        <span>{model.modelId}</span>
                        {endpoint && (
                          <span className="text-slate-500 font-sans">
                            · {endpoint.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0" onClick={e => e.stopPropagation()}>
                    {/* 启用状态切换：开关滑块 (Toggle Switch Slider) */}
                    <ToggleSwitch
                      checked={model.enabled}
                      disabled={!endpoint}
                      onChange={checked => update(model.id, { enabled: checked })}
                      label={
                        !endpoint
                          ? label('需关联端点', 'No Endpoint')
                          : model.enabled
                          ? label('启用中', 'Active')
                          : label('已关闭', 'Off')
                      }
                    />

                    {/* 删除按钮 */}
                    <button
                      type="button"
                      title={label('删除生图模型', 'Delete image model')}
                      aria-label={label('删除生图模型', 'Delete image model')}
                      className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                      onClick={() =>
                        onChange({ ...config, imageModels: models.filter(item => item.id !== model.id) })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* 模型详细配置参数（折叠控制） */}
                {isExpanded && (
                  <div className="p-4 sm:p-5 space-y-4 bg-slate-950/40 border-t border-slate-800/60 animate-in fade-in duration-150">
                    {/* 基本信息 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div>
                        <label className={labelClass}>{label('模型显示名称', 'Display Name')}</label>
                        <input
                          required
                          className={inputClass}
                          value={model.label}
                          onChange={event => update(model.id, { label: event.target.value })}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>{label('API 模型 ID', 'API Model ID')}</label>
                        <input
                          required
                          className={`${inputClass} font-mono`}
                          value={model.modelId}
                          onChange={event => update(model.id, { modelId: event.target.value })}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>{label('模型版本', 'Model Version')}</label>
                        <input
                          maxLength={100}
                          placeholder={label('可选，如 v1.0', 'Optional, e.g. v1.0')}
                          className={inputClass}
                          value={model.version ?? ''}
                          onChange={event => update(model.id, { version: event.target.value })}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>{label('发布日期', 'Release Date')}</label>
                        <input
                          type="date"
                          className={inputClass}
                          value={model.releasedAt ?? ''}
                          onChange={event => update(model.id, { releasedAt: event.target.value })}
                        />
                      </div>
                    </div>

                    <div>
                      <label className={labelClass}>{label('模型简要描述', 'Description')}</label>
                      <textarea
                        rows={2}
                        className={inputClass}
                        value={model.description}
                        placeholder={label('对该生图模型的特性描述...', 'Brief description of model characteristics...')}
                        onChange={event => update(model.id, { description: event.target.value })}
                      />
                    </div>

                    {/* 凭据与网络端点 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className={labelClass}>
                          <span className="flex items-center gap-1.5">
                            <Link size={12} className="text-blue-400" />
                            <span>{label('凭据来源（关联已有端点）', 'Credential Source (Endpoint)')}</span>
                          </span>
                        </label>
                        <select
                          className={inputClass}
                          value={model.endpointId}
                          onChange={event =>
                            update(model.id, {
                              endpointId: event.target.value,
                              enabled: event.target.value ? model.enabled : false
                            })
                          }
                        >
                          <option value="">{label('选择已有 API 端点...', 'Select an existing endpoint...')}</option>
                          {config.endpoints.map(item => (
                            <option key={item.id} value={item.id} className="bg-slate-900 text-slate-200">
                              {item.name} ({item.endpoint})
                            </option>
                          ))}
                        </select>
                        {!endpoint && (
                          <span className="text-[11px] text-amber-400/90 block mt-1">
                            {label('⚠️ 请选择一个已配置的 API 端点以提供鉴权凭据与请求地址。', 'Please link an API endpoint for credentials.')}
                          </span>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center justify-between">
                          <label className={labelClass}>
                            <span className="flex items-center gap-1.5">
                              <Clock size={12} className="text-blue-400" />
                              <span>{label('生成等待超时（秒）', 'Timeout (seconds)')}</span>
                            </span>
                          </label>
                          <button
                            type="button"
                            title={label('恢复预设超时', 'Restore preset timeout')}
                            aria-label={label('恢复预设超时', 'Restore preset timeout')}
                            className="text-[11px] text-slate-400 hover:text-blue-400 flex items-center gap-1 cursor-pointer transition-colors"
                            onClick={() =>
                              update(model.id, {
                                timeoutSeconds: imageTimeoutSeconds({ ...model, timeoutSeconds: undefined })
                              })
                            }
                          >
                            <RotateCcw size={11} />
                            <span>{label('重置', 'Reset')}</span>
                          </button>
                        </div>
                        <input
                          id={`${model.id}-timeout`}
                          type="number"
                          min={60}
                          max={600}
                          step={1}
                          required
                          className={`${inputClass} font-mono`}
                          value={imageTimeoutSeconds(model)}
                          onChange={event => update(model.id, { timeoutSeconds: Number(event.target.value) })}
                        />
                      </div>
                    </div>

                    <div>
                      <label className={labelClass}>
                        {label('独立生图请求 URL（留空则默认继承端点）', 'Image Request URL (empty to inherit endpoint)')}
                      </label>
                      <input
                        type="url"
                        className={`${inputClass} font-mono`}
                        value={model.requestUrl}
                        placeholder={
                          inheritedUrl ||
                          (model.adapter === 'kolors'
                            ? 'https://api.siliconflow.cn/v1/images/generations'
                            : model.adapter === 'agnes'
                            ? 'https://apihub.agnes-ai.com/v1/images/generations'
                            : 'https://api.openai.com/v1/images/generations')
                        }
                        onChange={event => update(model.id, { requestUrl: event.target.value })}
                      />
                    </div>

                    {/* 默认生图参数配置 */}
                    <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-3">
                      <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Sliders size={13} className="text-indigo-400" />
                        <span>{label('默认生图参数设定', 'Default Generation Parameters')}</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div>
                          <label className={labelClass}>{label('默认尺寸', 'Default Size')}</label>
                          {!capabilities.exactSizeSupported ? (
                            <select
                              className={inputClass}
                              value={model.size}
                              onChange={event => update(model.id, { size: event.target.value })}
                            >
                              {capabilities.sizes.map(size => (
                                <option key={size} value={size} className="bg-slate-900 text-slate-200">
                                  {size}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <>
                              <input
                                required
                                className={`${inputClass} font-mono`}
                                list={`sizes-${model.id}`}
                                value={model.size}
                                onChange={event => update(model.id, { size: event.target.value })}
                              />
                              <datalist id={`sizes-${model.id}`}>
                                {capabilities.sizes.map(size => (
                                  <option key={size} value={size} />
                                ))}
                              </datalist>
                            </>
                          )}
                        </div>

                        {capabilities.ratios && (
                          <div>
                            <label className={labelClass}>{label('默认比例', 'Default Ratio')}</label>
                            <select
                              className={inputClass}
                              disabled={!capabilities.sizes.includes(model.size)}
                              value={model.ratio}
                              onChange={event => update(model.id, { ratio: event.target.value })}
                            >
                              {capabilities.ratios.map(ratio => (
                                <option key={ratio} value={ratio} className="bg-slate-900 text-slate-200">
                                  {ratio}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {capabilities.qualities && (
                          <div>
                            <label className={labelClass}>{label('默认画质', 'Default Quality')}</label>
                            <select
                              className={inputClass}
                              value={model.quality ?? 'high'}
                              onChange={event => update(model.id, { quality: event.target.value as ImageQuality })}
                            >
                              {capabilities.qualities.map(quality => (
                                <option key={quality} value={quality} className="bg-slate-900 text-slate-200">
                                  {quality}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {capabilities.maxImages && (
                          <div>
                            <label className={labelClass}>{label('默认张数', 'Default Image Count')}</label>
                            <input
                              type="number"
                              required
                              min={1}
                              max={capabilities.maxImages}
                              step={1}
                              className={`${inputClass} font-mono`}
                              value={model.n ?? 1}
                              onChange={event => update(model.id, { n: Number(event.target.value) })}
                            />
                          </div>
                        )}

                        {model.adapter === 'kolors' && (
                          <>
                            <div>
                              <label className={labelClass}>{label('推理步数', 'Inference Steps')}</label>
                              <input
                                type="number"
                                min={1}
                                max={100}
                                step={1}
                                required
                                className={`${inputClass} font-mono`}
                                value={model.steps}
                                onChange={event => update(model.id, { steps: Number(event.target.value) })}
                              />
                            </div>
                            <div>
                              <label className={labelClass}>{label('引导强度 (CFG)', 'Guidance Scale')}</label>
                              <input
                                type="number"
                                min={0}
                                max={20}
                                step={0.1}
                                required
                                className={`${inputClass} font-mono`}
                                value={model.guidance}
                                onChange={event => update(model.id, { guidance: Number(event.target.value) })}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* 工具 ID 提示 */}
                    <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                      <span className="font-mono text-slate-400">
                        tool_call: <span className="text-slate-300 font-semibold">{imageModelToolId(model)}</span>
                      </span>
                      <span>adapter: {model.adapter}</span>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}