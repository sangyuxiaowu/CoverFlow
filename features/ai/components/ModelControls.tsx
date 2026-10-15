import { Brain, Cpu } from 'lucide-react';
import type { AiConfig, ReasoningEffort } from '../types.ts';
import { resolveSelection, selectModel, updateActiveModel } from '../services/config.ts';

interface Props { config: AiConfig; configure: (config: AiConfig) => Promise<void>; disabled: boolean; english: boolean }

export default function ModelControls({ config, configure, disabled, english }: Props) {
  const { endpoint, model } = resolveSelection(config);
  const label = (zh: string, en: string) => english ? en : zh;
  const update = (next: AiConfig) => { void configure(next).catch(() => {}); };
  const effortNames: Record<ReasoningEffort, string> = english ? { none: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Maximum' } : { none: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高' };
  return <div className="cf-ai-model-controls">
    <label className="cf-ai-model-select"><Cpu size={16} /><select aria-label={label('切换模型', 'Switch Model')} disabled={disabled} value={JSON.stringify([endpoint.id, model.id])} onChange={event => { const [endpointId, modelId] = JSON.parse(event.target.value) as [string, string]; update(selectModel(config, endpointId, modelId)); }}>{config.endpoints.map(item => <optgroup key={item.id} label={item.name}>{item.models.map(option => <option key={option.id} value={JSON.stringify([item.id, option.id])}>{option.label}</option>)}</optgroup>)}</select></label>
    {model.thinkingAvailable && <div className="cf-ai-reasoning-controls"><Brain size={16} /><select aria-label={label('思考强度', 'Reasoning Effort')} disabled={disabled} value={model.thinkingEnabled ? model.reasoningEffort : 'none'} onChange={event => update(updateActiveModel(config, { thinkingEnabled: event.target.value !== 'none', ...(event.target.value !== 'none' ? { reasoningEffort: event.target.value as ReasoningEffort } : {}) }))}>{model.supportedReasoningEfforts.map(value => <option key={value} value={value}>{effortNames[value]}</option>)}</select></div>}
  </div>;
}