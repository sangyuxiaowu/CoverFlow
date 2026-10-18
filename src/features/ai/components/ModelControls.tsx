import { useState, useRef, useEffect } from 'react';
import { Brain, ChevronDown } from 'lucide-react';
import type { AiConfig, ReasoningEffort } from '../types.ts';
import { resolveSelection, selectModel, updateActiveModel } from '../services/config.ts';

interface Props {
  config: AiConfig;
  configure: (config: AiConfig) => Promise<void>;
  disabled: boolean;
  english: boolean;
}

const ALL_REASONING_EFFORTS: ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
];

export default function ModelControls({ config, configure, disabled, english }: Props) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { endpoint, model } = resolveSelection(config);
  const label = (zh: string, en: string) => (english ? en : zh);

  const update = (next: AiConfig) => {
    void configure(next).catch(() => {});
  };

  const effortLabels: Record<ReasoningEffort, string> = {
    none: english ? 'Off' : '关闭',
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'XHigh',
    max: 'Max'
  };

  useEffect(() => {
    if (!modelMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModelMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [modelMenuOpen]);

  const isThinkingActive = Boolean(model.thinkingAvailable && model.thinkingEnabled);

  const availableEfforts = ALL_REASONING_EFFORTS.filter(
    val => val !== 'none' && (!model.supportedReasoningEfforts?.length || model.supportedReasoningEfforts.includes(val))
  );

  const currentEffort: ReasoningEffort =
    model.reasoningEffort && model.reasoningEffort !== 'none' && availableEfforts.includes(model.reasoningEffort)
      ? model.reasoningEffort
      : (model.defaultReasoningEffort && model.defaultReasoningEffort !== 'none' && availableEfforts.includes(model.defaultReasoningEffort)
          ? model.defaultReasoningEffort
          : (availableEfforts[0] || 'medium'));

  return (
    <div className="flex items-center gap-1 select-none min-w-0">
      {/* 模型选择触发按钮 (h-5, text-[10px], max-w-[130px]) */}
      <div className="relative min-w-0" ref={menuRef}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setModelMenuOpen(prev => !prev)}
          className={`h-5 max-w-[130px] px-1.5 rounded-md flex items-center gap-1 text-[10px] font-semibold transition-colors cursor-pointer ${
            modelMenuOpen
              ? 'bg-slate-800 text-blue-400'
              : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
          }`}
          title={label('切换当前模型', 'Switch active model')}
          aria-expanded={modelMenuOpen}
        >
          <span className="truncate">{model.label || model.modelId}</span>
          <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
        </button>

        {/* 模型选择弹出浮层 (Image 4 样式) */}
        {modelMenuOpen && (
          <div className="absolute bottom-full left-0 mb-2 z-50 w-64 bg-slate-900/98 backdrop-blur-xl border border-slate-700/80 rounded-xl shadow-2xl p-2 text-xs animate-in fade-in zoom-in-95 duration-150">
            <div className="text-[11px] font-bold text-slate-400 px-2 py-1 select-none">
              {label('选择可用模型', 'Select Available Model')}
            </div>

            <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-2 mt-1">
              {config.endpoints.map(ep => (
                <div key={ep.id} className="space-y-0.5">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-2 pt-1 pb-0.5">
                    {ep.name}
                  </div>
                  {ep.models.map(m => {
                    const isSelected = ep.id === endpoint.id && m.id === model.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          update(selectModel(config, ep.id, m.id));
                          setModelMenuOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left cursor-pointer ${
                          isSelected
                            ? 'bg-blue-600 text-white font-semibold shadow-sm'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <span className="truncate mr-2">{m.label || m.modelId}</span>
                        {m.thinkingAvailable && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-tight shrink-0 ${
                              isSelected
                                ? 'bg-white/20 text-white'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {label('思考', 'Thinking')}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 思考按钮与强度选择下拉 (h-5, text-[10px]) */}
      {model.thinkingAvailable && (
        <div className="flex items-center gap-1">
          {/* 点击切换是否启用思考模式；关闭时直接禁用右侧下拉框，再点一下恢复 */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (isThinkingActive) {
                // 当前开启，点击关闭：直接禁用下拉框，保留当前已选思考强度
                update(
                  updateActiveModel(config, {
                    thinkingEnabled: false,
                    reasoningEffort: currentEffort
                  })
                );
              } else {
                // 当前禁用，再点一下恢复
                update(
                  updateActiveModel(config, {
                    thinkingEnabled: true,
                    reasoningEffort: currentEffort
                  })
                );
              }
            }}
            className={`h-5 px-1.5 rounded-md flex items-center gap-1 text-[10px] transition-colors cursor-pointer select-none ${
              isThinkingActive
                ? 'bg-blue-600/15 text-blue-500 font-semibold'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40 font-medium'
            }`}
            title={
              isThinkingActive
                ? label('点击禁用思考 (禁用右侧下拉框)', 'Disable thinking (disables dropdown)')
                : label('点击恢复思考 (恢复右侧下拉框)', 'Enable thinking (restores dropdown)')
            }
          >
            <Brain className="w-3 h-3 shrink-0" />
            <span>{label('思考', 'Thinking')}</span>
          </button>

          {/* 思考强度下拉选择 (无关闭选项，思考关闭时禁用) */}
          <div className="relative flex items-center">
            <select
              aria-label={label('思考强度', 'Reasoning Effort')}
              disabled={disabled || !isThinkingActive}
              value={currentEffort}
              onChange={e => {
                const nextEffort = e.target.value as ReasoningEffort;
                update(
                  updateActiveModel(config, {
                    thinkingEnabled: true,
                    reasoningEffort: nextEffort
                  })
                );
              }}
              className={`h-5 rounded-md border-0 bg-transparent px-1 text-[10px] font-semibold focus:outline-none transition-all ${
                isThinkingActive
                  ? 'text-slate-200 cursor-pointer opacity-100 hover:text-white'
                  : 'text-slate-500 cursor-not-allowed opacity-50'
              }`}
              title={
                isThinkingActive
                  ? label('选择思考强度', 'Select Reasoning Effort')
                  : label('思考已关闭，点击左侧“思考”按钮开启', 'Thinking disabled, click Thinking button to enable')
              }
            >
              {availableEfforts.map(value => (
                <option key={value} value={value} className="bg-slate-900 text-slate-200">
                  {effortLabels[value]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}