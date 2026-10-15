import { useState } from 'react';
import { ArrowLeft, Eye, EyeOff, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import type { AiConfig, AiEndpointConfig, AiModelConfig, ReasoningEffort, ReasoningProtocol } from '../types.ts';
import { createEndpoint, createModel, normalizeConfig, REASONING_EFFORTS, resolveSelection, SYSTEM_PROMPT } from '../services/config.ts';

interface Props { config: AiConfig; onSave: (config: AiConfig) => Promise<void>; onBack: () => void; english: boolean }

export default function AiSettings({ config, onSave, onBack, english }: Props) {
  const [draft, setDraft] = useState(() => structuredClone(config));
  const [endpointId, setEndpointId] = useState(config.activeSelection.endpointId);
  const [modelId, setModelId] = useState(config.activeSelection.modelId);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'models' | 'prompt'>('models');
  const label = (zh: string, en: string) => english ? en : zh;
  const endpoint = draft.endpoints.find(item => item.id === endpointId) || draft.endpoints[0];
  const model = endpoint.models.find(item => item.id === modelId) || endpoint.models[0];
  const updateEndpoint = (patch: Partial<AiEndpointConfig>) => setDraft(previous => ({ ...previous, endpoints: previous.endpoints.map(item => item.id !== endpoint.id ? item : { ...item, ...patch, ...(patch.endpoint !== undefined ? { apiKey: '' } : {}) }) }));
  const updateModel = (patch: Partial<AiModelConfig>) => updateEndpoint({ models: endpoint.models.map(item => item.id === model.id ? { ...item, ...patch } : item) });
  const addEndpoint = (provider: 'openai' | 'deepseek' | 'local' | 'custom') => {
    const added = createEndpoint(provider);
    setDraft(previous => ({ ...previous, endpoints: [...previous.endpoints, added] }));
    setEndpointId(added.id);
    setModelId(added.models[0].id);
    setShowKey(false);
  };
  const removeEndpoint = () => {
    const next = normalizeConfig({ ...draft, endpoints: draft.endpoints.filter(item => item.id !== endpoint.id) });
    setDraft(next);
    const active = resolveSelection(next);
    setEndpointId(active.endpoint.id);
    setModelId(active.model.id);
    setShowKey(false);
  };
  const removeModel = () => {
    const models = endpoint.models.filter(item => item.id !== model.id);
    setDraft(normalizeConfig({ ...draft, endpoints: draft.endpoints.map(item => item.id === endpoint.id ? { ...item, models } : item) }));
    setModelId(models[0].id);
  };
  return <form className="cf-ai-settings" onSubmit={async event => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try { await onSave(draft); onBack(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Invalid settings'); }
    finally { setSaving(false); }
  }}>
    <div className="cf-ai-section-title"><button type="button" className="cf-ai-icon" disabled={saving} onClick={onBack} title={label('返回', 'Back')} aria-label={label('返回', 'Back')}><ArrowLeft size={18} /></button><h3>{label('AI 设置', 'AI Settings')}</h3></div>
    <div className="cf-ai-tabs" role="tablist" aria-label={label('设置分类', 'Settings Sections')}><button type="button" role="tab" aria-selected={tab === 'models'} onClick={() => setTab('models')}>{label('接入点与模型', 'Endpoints & Models')}</button><button type="button" role="tab" aria-selected={tab === 'prompt'} onClick={() => setTab('prompt')}>{label('系统提示词', 'System Prompt')}</button></div>
    <fieldset disabled={saving} className="cf-ai-settings-fields">
      {tab === 'models' ? <>
        <div className="cf-ai-selector-row"><label>{label('接入点', 'Endpoint')}<select value={endpoint.id} onChange={event => { const next = draft.endpoints.find(item => item.id === event.target.value)!; setEndpointId(next.id); setModelId(next.models[0].id); setShowKey(false); }}>{draft.endpoints.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" className="cf-ai-icon" disabled={draft.endpoints.length <= 1} onClick={removeEndpoint} title={label('删除接入点', 'Delete Endpoint')} aria-label={label('删除接入点', 'Delete Endpoint')}><Trash2 size={16} /></button></div>
        <div className="cf-ai-provider-row"><select aria-label={label('添加接入点预设', 'Add Endpoint Preset')} value="" onChange={event => { if (event.target.value) addEndpoint(event.target.value as 'openai' | 'deepseek' | 'local' | 'custom'); }}><option value="">{label('添加接入点...', 'Add Endpoint...')}</option><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option><option value="local">Ollama</option><option value="custom">{label('自定义', 'Custom')}</option></select><button type="button" className="cf-ai-icon" onClick={() => addEndpoint('custom')} title={label('添加接入点', 'Add Endpoint')} aria-label={label('添加接入点', 'Add Endpoint')}><Plus size={18} /></button></div>
        <label>{label('接入点名称', 'Endpoint Name')}<input required value={endpoint.name} onChange={event => updateEndpoint({ name: event.target.value })} /></label>
        <label>{label('Chat Completions 地址', 'Chat Completions URL')}<input type="url" required value={endpoint.endpoint} onChange={event => updateEndpoint({ endpoint: event.target.value })} /></label>
        <label>API Key <span className="cf-ai-meta">{label('本机加密保存', 'Encrypted Locally')}</span><div className="cf-ai-secret"><input aria-label="API Key" autoComplete="off" type={showKey ? 'text' : 'password'} value={endpoint.apiKey} onChange={event => updateEndpoint({ apiKey: event.target.value })} /><button type="button" className="cf-ai-icon" onClick={() => setShowKey(previous => !previous)} title={label('显示或隐藏密钥', 'Show or Hide Key')} aria-label={label('显示或隐藏密钥', 'Show or Hide Key')}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
        <div className="cf-ai-selector-row"><label>{label('模型', 'Model')}<select value={model.id} onChange={event => setModelId(event.target.value)}>{endpoint.models.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button type="button" className="cf-ai-icon" onClick={() => { const added = createModel('new-model'); updateEndpoint({ models: [...endpoint.models, added] }); setModelId(added.id); }} title={label('添加模型', 'Add Model')} aria-label={label('添加模型', 'Add Model')}><Plus size={18} /></button><button type="button" className="cf-ai-icon" disabled={endpoint.models.length <= 1} onClick={removeModel} title={label('删除模型', 'Delete Model')} aria-label={label('删除模型', 'Delete Model')}><Trash2 size={16} /></button></div>
        <div className="cf-ai-field-row"><label>{label('模型名称', 'Model Name')}<input required value={model.label} onChange={event => updateModel({ label: event.target.value })} /></label><label>{label('模型 ID', 'Model ID')}<input required value={model.modelId} onChange={event => updateModel({ modelId: event.target.value })} /></label></div>
        <div className="cf-ai-field-row"><label>{label('温度', 'Temperature')}<input type="number" min={0} max={2} step={0.1} value={model.temperature} onChange={event => updateModel({ temperature: Number(event.target.value) })} /></label><label>{label('最大输出 Token', 'Max Output Tokens')}<input type="number" min={256} max={65536} step={256} value={model.maxTokens} onChange={event => updateModel({ maxTokens: Number(event.target.value) })} /></label></div>
        <label>{label('思考协议', 'Reasoning Protocol')}<select value={model.reasoningProtocol} onChange={event => updateModel({ reasoningProtocol: event.target.value as ReasoningProtocol, thinkingEnabled: event.target.value !== 'none' })}><option value="none">{label('不支持思考', 'No Reasoning')}</option><option value="openai">OpenAI · reasoning_effort</option><option value="deepseek">DeepSeek · thinking</option></select></label>
        <div className="cf-ai-field-row"><label className="cf-ai-checkbox"><input type="checkbox" checked={model.thinkingEnabled} disabled={model.reasoningProtocol === 'none'} onChange={event => updateModel({ thinkingEnabled: event.target.checked })} />{label('启用思考', 'Enable Reasoning')}</label><label>{label('默认思考深度', 'Default Reasoning Effort')}<select value={model.reasoningEffort} disabled={model.reasoningProtocol === 'none' || !model.thinkingEnabled} onChange={event => updateModel({ reasoningEffort: event.target.value as ReasoningEffort })}>{REASONING_EFFORTS.map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
        <button type="button" className="cf-ai-secondary" onClick={() => setDraft(previous => ({ ...previous, activeSelection: { endpointId: endpoint.id, modelId: model.id } }))}>{draft.activeSelection.endpointId === endpoint.id && draft.activeSelection.modelId === model.id ? label('当前默认模型', 'Current Default Model') : label('设为默认模型', 'Set as Default Model')}</button>
      </> : <label>{label('系统提示词', 'System Prompt')}<textarea rows={12} value={draft.systemPrompt} onChange={event => setDraft(previous => ({ ...previous, systemPrompt: event.target.value }))} /></label>}
    </fieldset>
    {error && <p role="alert" className="cf-ai-error">{error}</p>}
    <div className="cf-ai-actions">{tab === 'prompt' && <button type="button" className="cf-ai-icon" disabled={saving} onClick={() => setDraft(previous => ({ ...previous, systemPrompt: SYSTEM_PROMPT }))} title={label('恢复默认提示词', 'Reset System Prompt')} aria-label={label('恢复默认提示词', 'Reset System Prompt')}><RotateCcw size={18} /></button>}<button type="submit" className="cf-ai-primary" disabled={saving}><Save size={16} />{saving ? label('保存中', 'Saving') : label('保存', 'Save')}</button></div>
  </form>;
}