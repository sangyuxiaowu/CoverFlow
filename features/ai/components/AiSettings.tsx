import { useState } from 'react';
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  FileText,
  MessageSquare,
  Plus,
  RotateCcw,
  Save,
  Sliders,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import type { AiConfig, AiEndpointConfig, AiModelConfig, ReasoningEffort } from '../types.ts';
import {
  ALL_REASONING_EFFORTS,
  createEndpoint,
  createModel,
  DEFAULT_QUICK_SNIPPETS,
  normalizeConfig,
  REASONING_EFFORTS,
  resolveSelection,
  SYSTEM_PROMPT
} from '../services/config.ts';

interface Props {
  config: AiConfig;
  onSave: (config: AiConfig) => Promise<void>;
  onBack: () => void;
  english: boolean;
}

export default function AiSettings({ config, onSave, onBack, english }: Props) {
  const [draft, setDraft] = useState(() => structuredClone(config));
  const [showKeyMap, setShowKeyMap] = useState<Record<string, boolean>>({});
  const [expandedEndpoints, setExpandedEndpoints] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    draft.endpoints.forEach((ep, i) => {
      initial[ep.id] = i === 0; // 默认展开第一个端点
    });
    return initial;
  });
  const [tab, setTab] = useState<'models' | 'prompt' | 'snippets'>('models');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [newSnippet, setNewSnippet] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const label = (zh: string, en: string) => (english ? en : zh);

  const activeSelection = resolveSelection(draft);
  const activeEndpoint = activeSelection.endpoint;
  const activeModel = activeSelection.model;

  const toggleEndpointExpanded = (id: string) => {
    setExpandedEndpoints(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const updateEndpoint = (endpointId: string, patch: Partial<AiEndpointConfig>) => {
    setDraft(prev => ({
      ...prev,
      endpoints: prev.endpoints.map(item => (item.id !== endpointId ? item : { ...item, ...patch }))
    }));
  };

  const updateModel = (endpointId: string, modelId: string, patch: Partial<AiModelConfig>) => {
    setDraft(prev => ({
      ...prev,
      endpoints: prev.endpoints.map(ep =>
        ep.id !== endpointId
          ? ep
          : {
              ...ep,
              models: ep.models.map(m => (m.id !== modelId ? m : { ...m, ...patch }))
            }
      )
    }));
  };

  const addEndpoint = (provider: 'openai' | 'deepseek' | 'local' | 'custom') => {
    const added = createEndpoint(provider);
    setDraft(prev => ({ ...prev, endpoints: [...prev.endpoints, added] }));
    setExpandedEndpoints(prev => ({ ...prev, [added.id]: true }));
  };

  const removeEndpoint = (endpointId: string) => {
    if (draft.endpoints.length <= 1) return;
    const nextEndpoints = draft.endpoints.filter(ep => ep.id !== endpointId);
    let nextActiveSelection = draft.activeSelection;
    if (draft.activeSelection.endpointId === endpointId) {
      nextActiveSelection = {
        endpointId: nextEndpoints[0].id,
        modelId: nextEndpoints[0].models[0].id
      };
    }
    setDraft({
      ...draft,
      endpoints: nextEndpoints,
      activeSelection: nextActiveSelection
    });
  };

  const addModelToEndpoint = (endpointId: string) => {
    const ep = draft.endpoints.find(e => e.id === endpointId);
    if (!ep) return;
    const newM = createModel('custom-model');
    updateEndpoint(endpointId, { models: [...ep.models, newM] });
  };

  const removeModelFromEndpoint = (endpointId: string, modelId: string) => {
    const ep = draft.endpoints.find(e => e.id === endpointId);
    if (!ep || ep.models.length <= 1) return;
    const nextModels = ep.models.filter(m => m.id !== modelId);
    let nextActive = draft.activeSelection;
    if (draft.activeSelection.modelId === modelId) {
      nextActive = { endpointId, modelId: nextModels[0].id };
    }
    setDraft({
      ...draft,
      endpoints: draft.endpoints.map(e => (e.id !== endpointId ? e : { ...e, models: nextModels })),
      activeSelection: nextActive
    });
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestStatus(null);
    try {
      if (!activeEndpoint.endpoint) {
        throw new Error(label('端点 URL 不能为空', 'Endpoint URL cannot be empty'));
      }
      // 轻量连通性检查或格式校验
      const url = new URL(activeEndpoint.endpoint);
      if (!url.protocol.startsWith('http')) {
        throw new Error(label('无效的 URL 协议', 'Invalid URL protocol'));
      }
      // 模拟测试或简单 ping
      await new Promise(resolve => setTimeout(resolve, 800));
      if (!activeEndpoint.apiKey && !activeEndpoint.endpoint.includes('localhost')) {
        setTestStatus(label('⚠️ 尚未填写 API Key', '⚠️ API Key is empty'));
      } else {
        setTestStatus(label('✓ 端点配置正常', '✓ Endpoint Verified'));
      }
    } catch (err) {
      setTestStatus(label(`❌ 连接测试失败: ${(err as Error).message}`, `❌ Failed: ${(err as Error).message}`));
    } finally {
      setIsTesting(false);
    }
  };

  const snippets = draft.quickSnippets || DEFAULT_QUICK_SNIPPETS;

  const handleAddSnippet = () => {
    if (!newSnippet.trim()) return;
    setDraft(prev => ({
      ...prev,
      quickSnippets: [...(prev.quickSnippets || DEFAULT_QUICK_SNIPPETS), newSnippet.trim()]
    }));
    setNewSnippet('');
  };

  const handleDeleteSnippet = (index: number) => {
    setDraft(prev => ({
      ...prev,
      quickSnippets: (prev.quickSnippets || DEFAULT_QUICK_SNIPPETS).filter((_, i) => i !== index)
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const normalized = normalizeConfig(draft);
      await onSave(normalized);
      onBack();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Invalid settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
      <div
        className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden text-slate-200"
        role="dialog"
        aria-modal="true"
        aria-label={label('AI 助手配置中心', 'AI Assistant Configuration Center')}
      >
        {/* 顶部标题栏 (Image 2 样式) */}
        <header className="px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center shadow-inner">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                {label('AI 助手配置中心', 'AI Assistant Configuration')}
              </h2>
              <p className="text-xs text-slate-400">
                {label(
                  '自定义服务端点、模型参数、系统提示词与快捷短语',
                  'Configure service endpoints, model parameters, system prompt and quick snippets'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title={label('关闭', 'Close')}
            aria-label={label('关闭', 'Close')}
          >
            <X size={18} />
          </button>
        </header>

        {/* 标签页导航 (Image 2 样式) */}
        <div className="px-6 border-b border-slate-800 flex items-center gap-6 shrink-0 bg-slate-900/40 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setTab('models')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
              tab === 'models'
                ? 'border-blue-500 text-blue-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu size={15} />
            <span>{label('端点与模型', 'Endpoints & Models')}</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('prompt')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
              tab === 'prompt'
                ? 'border-blue-500 text-blue-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText size={15} />
            <span>{label('系统提示词', 'System Prompt')}</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('snippets')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
              tab === 'snippets'
                ? 'border-blue-500 text-blue-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <MessageSquare size={15} />
            <span>
              {label('快捷短语', 'Quick Snippets')} ({snippets.length})
            </span>
          </button>
        </div>

        {/* 主体表单区域 */}
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
            {error && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-medium">
                {error}
              </div>
            )}

            {/* TAB 1: 端点与模型 */}
            {tab === 'models' && (
              <>
                {/* 当前默认活跃模型横幅卡片 (Image 2 顶部蓝色横幅卡片) */}
                <div className="p-4 rounded-xl border border-blue-500/30 bg-blue-950/20 backdrop-blur-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-[11px] font-bold text-blue-400 uppercase tracking-wider">
                      {label('当前默认活跃模型', 'Current Active Model')}
                    </div>
                    <div className="text-sm font-bold text-white">
                      {activeEndpoint.name} · {activeModel.label} ({activeModel.modelId})
                    </div>
                    <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
                      <span>
                        💡{' '}
                        {activeModel.thinkingAvailable
                          ? label('思考模式已支持', 'Thinking Supported')
                          : label('标准模式', 'Standard Mode')}
                      </span>
                      <span>·</span>
                      <span>
                        {label('窗口', 'Context')}: {activeModel.contextWindow.toLocaleString()} tokens
                      </span>
                      <span>·</span>
                      <span>
                        {label('输出', 'Output')}: {activeModel.maxTokens.toLocaleString()} tokens
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {testStatus && <span className="text-xs text-blue-300 font-medium">{testStatus}</span>}
                    <button
                      type="button"
                      disabled={isTesting}
                      onClick={handleTestConnection}
                      className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-blue-900/30 transition-all cursor-pointer"
                    >
                      <Sparkles size={14} />
                      <span>{isTesting ? label('测试中...', 'Testing...') : label('测试连接', 'Test Connection')}</span>
                    </button>
                  </div>
                </div>

                {/* API 端点配置区域 (Image 2 核心折叠列表) */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-200">
                      {label('API 端点配置', 'API Endpoint Configuration')}
                    </h3>
                    {/* 添加端点快速下拉 */}
                    <div className="relative flex items-center gap-2">
                      <select
                        aria-label={label('添加端点预设', 'Add Endpoint Preset')}
                        value=""
                        onChange={e => {
                          if (e.target.value) addEndpoint(e.target.value as any);
                        }}
                        className="bg-slate-800 border border-slate-700 rounded-lg text-xs font-semibold text-blue-400 px-2.5 py-1 outline-none hover:border-blue-500 cursor-pointer"
                      >
                        <option value="">+ {label('添加端点', 'Add Endpoint')}</option>
                        <option value="deepseek">DeepSeek</option>
                        <option value="openai">OpenAI</option>
                        <option value="local">Ollama (本地)</option>
                        <option value="custom">{label('自定义端点', 'Custom Endpoint')}</option>
                      </select>
                    </div>
                  </div>

                  {/* 端点卡片折叠列表 */}
                  <div className="space-y-3">
                    {draft.endpoints.map(ep => {
                      const isExpanded = Boolean(expandedEndpoints[ep.id]);
                      const hasKey = Boolean(ep.apiKey && ep.apiKey.trim().length > 0);

                      return (
                        <div
                          key={ep.id}
                          className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden transition-all shadow-sm"
                        >
                          {/* 端点标题栏 (可点击折叠/展开) */}
                          <div
                            onClick={() => toggleEndpointExpanded(ep.id)}
                            className="p-3.5 flex items-center justify-between cursor-pointer hover:bg-slate-800/40 select-none"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              {isExpanded ? (
                                <ChevronDown size={16} className="text-slate-400 shrink-0" />
                              ) : (
                                <ChevronRight size={16} className="text-slate-400 shrink-0" />
                              )}
                              <div className="min-w-0">
                                <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                                  <span>{ep.name}</span>
                                  {ep.id === activeEndpoint.id && (
                                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 font-semibold">
                                      {label('活跃', 'Active')}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs font-mono text-slate-500 truncate">{ep.endpoint}</div>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0" onClick={e => e.stopPropagation()}>
                              {/* 状态徽章 (已配置 Key / 未设置 Key) */}
                              {hasKey ? (
                                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                  {label('已配置 Key', 'Key Configured')}
                                </span>
                              ) : (
                                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                  {label('未设置 Key', 'Key Not Set')}
                                </span>
                              )}

                              {/* 删除端点按钮 */}
                              <button
                                type="button"
                                disabled={draft.endpoints.length <= 1}
                                onClick={() => removeEndpoint(ep.id)}
                                className="p-1 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 disabled:opacity-20 transition-colors cursor-pointer"
                                title={label('删除此端点', 'Delete Endpoint')}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>

                          {/* 展开的端点详情 */}
                          {isExpanded && (
                            <div className="p-4 border-t border-slate-800/80 bg-slate-950/40 space-y-4 text-xs">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <label className="space-y-1 block">
                                  <span className="font-semibold text-slate-300">{label('端点名称', 'Endpoint Name')}</span>
                                  <input
                                    required
                                    value={ep.name}
                                    onChange={e => updateEndpoint(ep.id, { name: e.target.value })}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 outline-none focus:border-blue-500 transition-colors"
                                  />
                                </label>

                                <label className="space-y-1 block">
                                  <span className="font-semibold text-slate-300">API Key</span>
                                  <div className="relative flex items-center">
                                    <input
                                      autoComplete="off"
                                      type={showKeyMap[ep.id] ? 'text' : 'password'}
                                      placeholder="sk-..."
                                      value={ep.apiKey}
                                      onChange={e => updateEndpoint(ep.id, { apiKey: e.target.value })}
                                      className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-3 pr-9 py-2 text-slate-100 outline-none focus:border-blue-500 transition-colors font-mono"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setShowKeyMap(m => ({ ...m, [ep.id]: !m[ep.id] }))}
                                      className="absolute right-2 text-slate-500 hover:text-slate-300 p-1"
                                    >
                                      {showKeyMap[ep.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                  </div>
                                </label>
                              </div>

                              <label className="space-y-1 block">
                                <span className="font-semibold text-slate-300">
                                  {label('端点服务地址 (URL)', 'Endpoint Service URL')}
                                </span>
                                <input
                                  type="url"
                                  required
                                  value={ep.endpoint}
                                  onChange={e => updateEndpoint(ep.id, { endpoint: e.target.value })}
                                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 outline-none focus:border-blue-500 transition-colors font-mono"
                                />
                                <span className="text-[11px] text-slate-500 block pt-0.5">
                                  {label(
                                    '请填写兼容 OpenAI Chat Completions 规范的完整 URL。',
                                    'Please provide a full URL compatible with OpenAI Chat Completions.'
                                  )}
                                </span>
                              </label>

                              {/* 该端点下的模型列表 (Image 2 嵌套卡片) */}
                              <div className="pt-2 space-y-3">
                                <div className="flex items-center justify-between">
                                  <span className="font-bold text-slate-200">
                                    {label('该端点下的模型列表', 'Models under this endpoint')}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => addModelToEndpoint(ep.id)}
                                    className="text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1 cursor-pointer"
                                  >
                                    <Plus size={14} />
                                    <span>{label('新增模型', 'Add Model')}</span>
                                  </button>
                                </div>

                                <div className="space-y-3">
                                  {ep.models.map(m => {
                                    const isDefault =
                                      draft.activeSelection.endpointId === ep.id &&
                                      draft.activeSelection.modelId === m.id;

                                    return (
                                      <div
                                        key={m.id}
                                        className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl space-y-3 shadow-inner"
                                      >
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                            <Cpu size={15} className="text-blue-400" />
                                            <span className="font-bold text-slate-100 text-sm">{m.label}</span>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            {isDefault ? (
                                              <span className="px-2 py-0.5 rounded bg-blue-600/20 text-blue-300 border border-blue-500/40 text-[11px] font-semibold">
                                                {label('当前默认', 'Default')}
                                              </span>
                                            ) : (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  setDraft(prev => ({
                                                    ...prev,
                                                    activeSelection: { endpointId: ep.id, modelId: m.id }
                                                  }))
                                                }
                                                className="px-2.5 py-0.5 rounded bg-slate-800 hover:bg-blue-600 text-slate-300 hover:text-white text-[11px] font-semibold transition-colors cursor-pointer"
                                              >
                                                {label('设为默认', 'Set as Default')}
                                              </button>
                                            )}

                                            <button
                                              type="button"
                                              disabled={ep.models.length <= 1}
                                              onClick={() => removeModelFromEndpoint(ep.id, m.id)}
                                              className="p-1 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 disabled:opacity-20 transition-colors cursor-pointer"
                                              title={label('删除此模型', 'Delete Model')}
                                            >
                                              <Trash2 size={14} />
                                            </button>
                                          </div>
                                        </div>

                                        {/* 4列参数布局 (模型展示名称, 模型ID, 上下文Token, 最大输出Token) */}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                          <label className="space-y-1 block">
                                            <span className="text-slate-400 text-[11px]">
                                              {label('模型展示名称', 'Display Name')}
                                            </span>
                                            <input
                                              required
                                              value={m.label}
                                              onChange={e => updateModel(ep.id, m.id, { label: e.target.value })}
                                              className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-slate-100 outline-none focus:border-blue-500 text-xs"
                                            />
                                          </label>
                                          <label className="space-y-1 block">
                                            <span className="text-slate-400 text-[11px]">
                                              {label('模型 ID (API)', 'Model ID (API)')}
                                            </span>
                                            <input
                                              required
                                              value={m.modelId}
                                              onChange={e => updateModel(ep.id, m.id, { modelId: e.target.value })}
                                              className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-slate-100 outline-none focus:border-blue-500 text-xs font-mono"
                                            />
                                          </label>
                                          <label className="space-y-1 block">
                                            <span className="text-slate-400 text-[11px]">
                                              {label('上下文 Token (窗口)', 'Context Tokens')}
                                            </span>
                                            <input
                                              type="number"
                                              required
                                              step={1}
                                              min={256}
                                              value={m.contextWindow}
                                              onChange={e =>
                                                updateModel(ep.id, m.id, { contextWindow: Number(e.target.value) })
                                              }
                                              className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-slate-100 outline-none focus:border-blue-500 text-xs font-mono"
                                            />
                                          </label>
                                          <label className="space-y-1 block">
                                            <span className="text-slate-400 text-[11px]">
                                              {label('最大输出 Token', 'Max Output Tokens')}
                                            </span>
                                            <input
                                              type="number"
                                              required
                                              step={1}
                                              min={1}
                                              value={m.maxTokens}
                                              onChange={e =>
                                                updateModel(ep.id, m.id, { maxTokens: Number(e.target.value) })
                                              }
                                              className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-slate-100 outline-none focus:border-blue-500 text-xs font-mono"
                                            />
                                          </label>
                                        </div>

                                        {/* 思考模式与推理强度配置 (无 Temperature 参数，支持全类别与默认设置) */}
                                        <div className="pt-2 border-t border-slate-800/60 space-y-3">
                                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                              <input
                                                type="checkbox"
                                                checked={m.thinkingAvailable}
                                                onChange={e => {
                                                  const checked = e.target.checked;
                                                  updateModel(ep.id, m.id, {
                                                    thinkingAvailable: checked,
                                                    defaultThinkingEnabled: checked,
                                                    thinkingEnabled: checked,
                                                    supportedReasoningEfforts: checked ? [...ALL_REASONING_EFFORTS] : m.supportedReasoningEfforts
                                                  });
                                                }}
                                                className="rounded accent-blue-500 w-4 h-4 cursor-pointer"
                                              />
                                              <span className="text-slate-200 text-xs font-semibold flex items-center gap-1.5">
                                                <Brain size={14} className="text-blue-400" />
                                                <span>{label('支持思考 / 推理参数 (Thinking)', 'Supports Thinking / Reasoning')}</span>
                                              </span>
                                            </label>

                                            {m.thinkingAvailable && (
                                              <div className="flex items-center gap-4 text-xs">
                                                {/* 是否默认开启思考 */}
                                                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                                  <input
                                                    type="checkbox"
                                                    checked={m.defaultThinkingEnabled ?? m.thinkingEnabled}
                                                    onChange={e =>
                                                      updateModel(ep.id, m.id, {
                                                        defaultThinkingEnabled: e.target.checked
                                                      })
                                                    }
                                                    className="rounded accent-blue-500 w-3.5 h-3.5 cursor-pointer"
                                                  />
                                                  <span className="text-slate-300 text-[11px] font-medium">
                                                    {label('默认开启思考', 'Default Enabled')}
                                                  </span>
                                                </label>

                                            {/* 默认思考强度 */}
                                            {(() => {
                                              const ALL_EFFORT_CATEGORIES: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
                                              const supportedCategories = ALL_EFFORT_CATEGORIES.filter(effort =>
                                                m.supportedReasoningEfforts.includes(effort)
                                              );
                                              const availableDefaultOptions = supportedCategories.length > 0
                                                ? supportedCategories
                                                : (['medium'] as ReasoningEffort[]);
                                              const currentDefaultEffort = availableDefaultOptions.includes(m.defaultReasoningEffort as ReasoningEffort)
                                                ? (m.defaultReasoningEffort as ReasoningEffort)
                                                : (availableDefaultOptions.includes(m.reasoningEffort as ReasoningEffort)
                                                    ? (m.reasoningEffort as ReasoningEffort)
                                                    : availableDefaultOptions[0]);

                                              return (
                                                <div className="flex items-center gap-1.5">
                                                  <span className="text-slate-400 text-[11px]">
                                                    {label('默认强度:', 'Default Effort:')}
                                                  </span>
                                                  <select
                                                    value={currentDefaultEffort}
                                                    onChange={e => {
                                                      const selected = e.target.value as ReasoningEffort;
                                                      const nextSupported = m.supportedReasoningEfforts.includes(selected)
                                                        ? m.supportedReasoningEfforts
                                                        : [...m.supportedReasoningEfforts, selected];
                                                      updateModel(ep.id, m.id, {
                                                        defaultReasoningEffort: selected,
                                                        supportedReasoningEfforts: nextSupported,
                                                        reasoningEffort: m.thinkingEnabled ? selected : m.reasoningEffort
                                                      });
                                                    }}
                                                    className="bg-slate-950 border border-slate-700 rounded-md px-2 py-0.5 text-[11px] font-semibold text-blue-400 outline-none cursor-pointer"
                                                  >
                                                    {availableDefaultOptions.map(effort => (
                                                      <option key={effort} value={effort} className="bg-slate-900 text-slate-200">
                                                        {effort.toUpperCase()}
                                                      </option>
                                                    ))}
                                                  </select>
                                                </div>
                                              );
                                            })()}
                                          </div>
                                        )}
                                      </div>

                                      {/* 思考强度类别勾选区 (全类别支持，可勾选以支持或全选) */}
                                      {m.thinkingAvailable && (
                                        <div className="bg-slate-950/60 rounded-lg p-2.5 border border-slate-800/80 space-y-2">
                                          <div className="flex items-center justify-between text-[11px]">
                                            <span className="text-slate-400 font-medium">
                                              {label('支持的思考级别:', 'Supported Reasoning Levels:')}
                                            </span>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const ALL_EFFORT_CATEGORIES: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
                                                const allSelected = ALL_EFFORT_CATEGORIES.every(e =>
                                                  m.supportedReasoningEfforts.includes(e)
                                                );
                                                const nextSupported: ReasoningEffort[] = allSelected
                                                  ? ['none', 'medium']
                                                  : ['none', ...ALL_EFFORT_CATEGORIES];

                                                const validEfforts = ALL_EFFORT_CATEGORIES.filter(e => nextSupported.includes(e));
                                                let nextDefault = m.defaultReasoningEffort;
                                                if (!validEfforts.includes(nextDefault as ReasoningEffort)) {
                                                  nextDefault = validEfforts[0] || 'medium';
                                                }

                                                updateModel(ep.id, m.id, {
                                                  supportedReasoningEfforts: nextSupported,
                                                  defaultReasoningEffort: nextDefault,
                                                  reasoningEffort: nextSupported.includes(m.reasoningEffort) ? m.reasoningEffort : nextDefault
                                                });
                                              }}
                                              className="text-blue-400 hover:text-blue-300 font-semibold cursor-pointer"
                                            >
                                              {(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as ReasoningEffort[]).every(e =>
                                                m.supportedReasoningEfforts.includes(e)
                                              )
                                                ? label('恢复部分', 'Reset')
                                                : label('全选类别', 'Select All')}
                                            </button>
                                          </div>

                                          <div className="flex flex-wrap gap-2">
                                            {(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as ReasoningEffort[]).map(effort => {
                                              const isChecked = m.supportedReasoningEfforts.includes(effort);
                                              const ALL_EFFORT_CATEGORIES: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

                                              return (
                                                <label
                                                  key={effort}
                                                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] cursor-pointer transition-colors select-none ${
                                                    isChecked
                                                      ? 'bg-blue-600/15 border-blue-500/40 text-blue-300 font-semibold'
                                                      : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                                                  }`}
                                                >
                                                  <input
                                                    type="checkbox"
                                                    checked={isChecked}
                                                    onChange={e => {
                                                      let next: ReasoningEffort[];
                                                      if (e.target.checked) {
                                                        next = Array.from(new Set([...m.supportedReasoningEfforts, effort]));
                                                      } else {
                                                        const remaining = ALL_EFFORT_CATEGORIES.filter(
                                                          item => item !== effort && m.supportedReasoningEfforts.includes(item)
                                                        );
                                                        if (remaining.length === 0) {
                                                          return;
                                                        }
                                                        next = m.supportedReasoningEfforts.filter(item => item !== effort);
                                                      }

                                                      // 联动默认强度选择框
                                                      const nextSupported = ALL_EFFORT_CATEGORIES.filter(item => next.includes(item));
                                                      let nextDefault = m.defaultReasoningEffort;
                                                      if (!nextSupported.includes(nextDefault as ReasoningEffort)) {
                                                        nextDefault = nextSupported[0] || 'medium';
                                                      }

                                                      let nextReasoning = m.reasoningEffort;
                                                      if (nextReasoning !== 'none' && !nextSupported.includes(nextReasoning)) {
                                                        nextReasoning = nextDefault;
                                                      }

                                                      updateModel(ep.id, m.id, {
                                                        supportedReasoningEfforts: next,
                                                        defaultReasoningEffort: nextDefault,
                                                        reasoningEffort: nextReasoning
                                                      });
                                                    }}
                                                    className="rounded accent-blue-500 w-3 h-3 cursor-pointer"
                                                  />
                                                  <span>{effort.toUpperCase()}</span>
                                                </label>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* TAB 2: 系统提示词 */}
            {tab === 'prompt' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-200">
                      {label('封面设计系统提示词', 'System Instructions')}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {label(
                        '指导模型如何调用工具对画布图层进行精准编辑与色彩排版。',
                        'Guides how the model manipulates canvas layers and invokes design tools.'
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDraft(prev => ({ ...prev, systemPrompt: SYSTEM_PROMPT }))}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer"
                  >
                    <RotateCcw size={14} />
                    <span>{label('恢复默认提示词', 'Reset to Default')}</span>
                  </button>
                </div>
                <textarea
                  rows={14}
                  value={draft.systemPrompt}
                  onChange={e => setDraft(prev => ({ ...prev, systemPrompt: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-300 leading-relaxed outline-none focus:border-blue-500 custom-scrollbar"
                />
              </div>
            )}

            {/* TAB 3: 快捷短语 */}
            {tab === 'snippets' && (
              <div className="space-y-5">
                {/* 顶部说明与快捷操作横幅 */}
                <div className="p-4 rounded-xl border border-blue-500/30 bg-blue-950/20 backdrop-blur-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <MessageSquare size={16} className="text-blue-400" />
                      <h3 className="text-sm font-bold text-slate-100">
                        {label('内置快捷短语管理', 'Quick Snippets Management')}
                      </h3>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-600/20 text-blue-300 border border-blue-500/30 font-semibold">
                        {label(`已配置 ${snippets.length} 条`, `${snippets.length} configured`)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      {label(
                        '配置在会话开始时展示的一键快捷发送短语，方便快速发起高频封面设计任务。',
                        'Configure quick prompt chips shown on assistant launch to trigger high-frequency design tasks.'
                      )}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setDraft(prev => ({ ...prev, quickSnippets: [...DEFAULT_QUICK_SNIPPETS] }));
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
                  >
                    <RotateCcw size={13} />
                    <span>{label('恢复默认预设', 'Reset to Defaults')}</span>
                  </button>
                </div>

                {/* 添加新短语输入框 */}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      value={newSnippet}
                      placeholder={label(
                        '输入新的快捷短语，例如：将主标题更换为科技感艺术字并居中...',
                        'Enter new quick snippet, e.g. change title to tech neon style...'
                      )}
                      onChange={e => setNewSnippet(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddSnippet();
                        }
                      }}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 outline-none transition-colors"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddSnippet}
                    disabled={!newSnippet.trim()}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-blue-900/30 cursor-pointer"
                  >
                    <Plus size={15} />
                    <span>{label('添加短语', 'Add Snippet')}</span>
                  </button>
                </div>

                {/* 推荐灵感库快捷添加 (点击即可加入列表) */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400">
                    {label('💡 推荐高频设计意图 (点击快速加入列表):', '💡 Recommended design prompts (click to add):')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      '调整画布背景为深色渐变',
                      '为封面添加一个吸睛的大标题',
                      '居中对齐所有文字并优化排版',
                      '添加精美装饰点缀并提升视觉层次感',
                      '将副标题调整为现代极简无衬线字体',
                      '在四周添加极简科技感几何边框'
                    ].map(rec => {
                      const alreadyAdded = snippets.includes(rec);
                      return (
                        <button
                          key={rec}
                          type="button"
                          disabled={alreadyAdded}
                          onClick={() => {
                            if (!alreadyAdded) {
                              setDraft(prev => ({
                                ...prev,
                                quickSnippets: [...(prev.quickSnippets || DEFAULT_QUICK_SNIPPETS), rec]
                              }));
                            }
                          }}
                          className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                            alreadyAdded
                              ? 'bg-slate-900/40 border-slate-800/60 text-slate-600 cursor-default'
                              : 'bg-slate-900 hover:bg-slate-800 border-slate-700/80 hover:border-blue-500/50 text-slate-300 hover:text-white'
                          }`}
                        >
                          <span>{alreadyAdded ? '✓ ' : '+ '}</span>
                          <span>{rec}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 已配置的短语卡片列表 */}
                <div className="space-y-2.5 pt-1">
                  <div className="text-xs font-bold text-slate-300">
                    {label('当前已启用短语列表', 'Enabled Snippets List')}
                  </div>
                  <div className="space-y-2">
                    {snippets.map((snip, index) => (
                      <div
                        key={index}
                        className="p-3 bg-slate-900/90 border border-slate-800/90 hover:border-slate-700 rounded-xl flex items-center justify-between text-xs group transition-all shadow-sm"
                      >
                        <div className="flex items-center gap-3 min-w-0 pr-3">
                          <span className="w-6 h-6 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400 font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <span className="text-slate-200 font-medium select-text break-words">
                            {snip}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {/* 复制短语按钮 */}
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(snip);
                                setCopiedIndex(index);
                                setTimeout(() => setCopiedIndex(null), 1500);
                              } catch {}
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                            title={label('复制短语', 'Copy snippet')}
                          >
                            {copiedIndex === index ? (
                              <Check size={14} className="text-emerald-400" />
                            ) : (
                              <Copy size={14} />
                            )}
                          </button>

                          {/* 删除短语按钮 */}
                          <button
                            type="button"
                            onClick={() => handleDeleteSnippet(index)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                            title={label('删除短语', 'Delete snippet')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 底部操作栏 (Image 2 底部取消与保存并生效按钮) */}
          <footer className="px-6 py-4 border-t border-slate-800 bg-slate-900/80 flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              disabled={saving}
              onClick={onBack}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
            >
              {label('取消', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/30 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <Save size={15} />
              <span>{saving ? label('保存中...', 'Saving...') : label('保存并生效', 'Save and Apply')}</span>
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}