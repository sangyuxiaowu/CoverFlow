import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Brain,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  ImagePlus,
  FileText,
  MessageSquare,
  Plus,
  RotateCcw,
  Save,
  Sliders,
  Sparkles,
  Scissors,
  Trash2,
  X,
  Globe,
  Terminal,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Info
} from 'lucide-react';
import type { AiConfig, AiEndpointConfig, AiModelConfig, ReasoningEffort } from '../types.ts';
import ImageModelSettings from './ImageModelSettings.tsx';
import SkillSettings from './SkillSettings.tsx';
import BackgroundRemovalSettings from '../../background-removal/BackgroundRemovalSettings.tsx';
import EncryptionKeySettings from './EncryptionKeySettings.tsx';
import type { ChatStore } from '../services/chatStore.ts';
import type { EncryptionStatus } from '../services/encryptionKeys.ts';
import {
  ALL_REASONING_EFFORTS,
  createEndpoint,
  createModel,
  DEFAULT_IMAGE_TOOL_PROMPT,
  DEFAULT_MAX_IMAGE_FAILURES,
  DEFAULT_MAX_TOOL_ROUNDS,
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
  store: ChatStore;
  onKeyChanged: () => Promise<void>;
  initialSecurity?: boolean;
}

export default function AiSettings({ config, onSave, onBack, english, store, onKeyChanged, initialSecurity }: Props) {
  const [draft, setDraft] = useState(() => structuredClone(config));
  const [showKeyMap, setShowKeyMap] = useState<Record<string, boolean>>({});
  const [expandedEndpoints, setExpandedEndpoints] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    draft.endpoints.forEach((ep, i) => {
      initial[ep.id] = i === 0; // 默认展开第一个端点
    });
    return initial;
  });
  const [tab, setTab] = useState<'models' | 'other' | 'images' | 'removal' | 'prompt' | 'skills' | 'snippets'>(initialSecurity ? 'other' : 'models');
  const [keyStatus, setKeyStatus] = useState<EncryptionStatus | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [backupPending, setBackupPending] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [newlyAddedEndpointId, setNewlyAddedEndpointId] = useState<string | null>(null);
  const endpointRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [newSnippet, setNewSnippet] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const label = (zh: string, en: string) => (english ? en : zh);

  useEffect(() => {
    tabsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);

  useEffect(() => {
    if (!newlyAddedEndpointId) return;
    endpointRefs.current[newlyAddedEndpointId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = setTimeout(() => setNewlyAddedEndpointId(null), 2500);
    return () => clearTimeout(timer);
  }, [newlyAddedEndpointId, draft.endpoints.length]);

  useEffect(() => {
    if (!backupPending) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [backupPending]);

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
    setNewlyAddedEndpointId(added.id);
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
      imageModels: draft.imageModels?.map(model =>
        model.endpointId === endpointId ? { ...model, endpointId: '', enabled: false } : model
      ),
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
      const url = new URL(activeEndpoint.endpoint);
      if (!url.protocol.startsWith('http')) {
        throw new Error(label('无效的 URL 协议', 'Invalid URL protocol'));
      }
      await new Promise(resolve => setTimeout(resolve, 800));
      if (!activeEndpoint.apiKey && !activeEndpoint.endpoint.includes('localhost')) {
        setTestStatus(label('⚠️ 尚未填写 API Key', '⚠️ API Key is empty'));
      } else {
        setTestStatus(label('✓ 端点配置验证成功', '✓ Endpoint Verified'));
      }
    } catch (err) {
      setTestStatus(label(`❌ 连接测试失败: ${(err as Error).message}`, `❌ Failed: ${(err as Error).message}`));
    } finally {
      setIsTesting(false);
    }
  };

  const snippets = draft.quickSnippets || DEFAULT_QUICK_SNIPPETS;

  const tabList = useMemo(() => [
    {
      id: 'models' as const,
      label: label('端点与模型', 'Endpoints & Models'),
      icon: Cpu,
      count: draft.endpoints.reduce((acc, ep) => acc + (ep.models?.length || 0), 0),
      tooltip: label('管理 LLM API 端点与模型列表', 'Manage LLM endpoints and model list')
    },
    {
      id: 'images' as const,
      label: label('生图模型', 'Image Models'),
      icon: ImagePlus,
      count: draft.imageModels?.length || 0,
      tooltip: label('配置 AI 图像生成模型与参数', 'Configure AI image generation models')
    },
    {
      id: 'removal' as const,
      label: label('智能抠图', 'Background Removal'),
      icon: Scissors,
      tooltip: label('本地 ONNX 智能背景移除模型', 'Local ONNX background removal models')
    },
    {
      id: 'prompt' as const,
      label: label('系统提示词', 'System Prompt'),
      icon: FileText,
      tooltip: label('定制大模型设计思维与生图指令', 'Customize system instructions')
    },
    {
      id: 'skills' as const,
      label: 'SKILL',
      icon: BookOpen,
      count: draft.skills?.length || 0,
      tooltip: label('管理纯文本任务规则', 'Manage plain-text task rules')
    },
    {
      id: 'snippets' as const,
      label: label('快捷短语', 'Quick Snippets'),
      icon: MessageSquare,
      count: snippets.length,
      tooltip: label('管理设计助手快捷提问短语', 'Manage assistant quick snippets')
    },
    {
      id: 'other' as const,
      label: label('其他设置', 'Other Settings'),
      icon: Sliders,
      alert: keyStatus === 'missing' || keyStatus === 'locked',
      tooltip: label('密钥加密存储与轮次限制', 'Encryption storage and turn limits')
    }
  ], [draft.endpoints, draft.imageModels, draft.skills?.length, snippets.length, keyStatus, english]);

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tabIds: Array<'models' | 'images' | 'removal' | 'prompt' | 'skills' | 'snippets' | 'other'> = [
      'models',
      'images',
      'removal',
      'prompt',
      'skills',
      'snippets',
      'other'
    ];
    const currentIndex = tabIds.indexOf(tab);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIndex = (currentIndex + 1) % tabIds.length;
      setTab(tabIds[nextIndex]);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIndex = (currentIndex - 1 + tabIds.length) % tabIds.length;
      setTab(tabIds[prevIndex]);
    }
  };

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
    if (saving || keyBusy || backupPending || keyStatus !== 'ready') return;
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

// 现代平滑开关滑块组件
const ToggleSwitch: React.FC<{
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  id?: string;
  activeColor?: string;
}> = ({ checked, disabled, onChange, label, id, activeColor = 'bg-blue-600 shadow-blue-600/40' }) => {
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
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 ${
          checked ? `${activeColor} shadow-sm` : 'bg-slate-700 hover:bg-slate-650'
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
            disabled ? 'text-slate-500 cursor-not-allowed' : checked ? 'text-blue-300' : 'text-slate-400'
          }`}
        >
          {label}
        </span>
      )}
    </div>
  );
};

  const inputClass =
    'w-full bg-slate-950/80 border border-slate-800 focus:border-blue-500/80 focus:ring-1 focus:ring-blue-500/30 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 outline-none transition-all';
  const labelClass = 'text-[11px] font-medium text-slate-400 block mb-1';

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
      <div
        className="bg-[#0b0f17] border border-slate-800 rounded-2xl shadow-2xl max-w-4xl w-full h-[88vh] max-h-[880px] min-h-0 sm:min-h-[520px] flex flex-col overflow-hidden text-slate-200"
        role="dialog"
        aria-modal="true"
        aria-label={label('AI 助手配置中心', 'AI Assistant Configuration Center')}
      >
        {/* 顶部标题栏 */}
        <header className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between shrink-0 bg-slate-900/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/10 border border-blue-500/30 text-blue-400 flex items-center justify-center shadow-inner">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <span>{label('AI 助手配置中心', 'AI Assistant Configuration')}</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {label(
                  '配置大模型 API 端点、生成参数、生图模型与系统提示词',
                  'Configure LLM endpoints, parameters, image models and system instructions'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onBack}
            disabled={keyBusy || backupPending || saving}
            className="w-8 h-8 rounded-xl bg-slate-850 hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title={label('关闭', 'Close')}
            aria-label={label('关闭', 'Close')}
          >
            <X size={16} />
          </button>
        </header>

        {/* 导航选项卡栏 */}
        <div className="px-4 sm:px-6 py-2.5 bg-slate-900/50 border-b border-slate-800/80 shrink-0 backdrop-blur-md">
          <div
            ref={tabsRef}
            role="tablist"
            aria-label={label('配置分类', 'Settings Categories')}
            onKeyDown={handleTabKeyDown}
            className={`flex items-center gap-1.5 p-1 rounded-2xl bg-slate-950/70 border border-slate-800/80 overflow-x-auto no-scrollbar scroll-smooth whitespace-nowrap [&>button]:shrink-0 ${
              keyBusy || backupPending ? 'pointer-events-none opacity-50' : ''
            }`}
            inert={keyBusy || backupPending || undefined}
          >
            {tabList.map(item => {
              const isActive = tab === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  id={`ai-settings-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`ai-settings-tabpanel-${item.id}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setTab(item.id)}
                  title={item.tooltip}
                  className={`group relative px-3 sm:px-3.5 py-2 rounded-xl flex items-center gap-2 text-xs transition-all duration-200 cursor-pointer select-none shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 ${
                    isActive
                      ? 'bg-gradient-to-r from-blue-600/25 via-blue-500/15 to-indigo-600/20 text-blue-200 border border-blue-500/40 shadow-[0_2px_12px_rgba(59,130,246,0.18)] font-semibold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850/60 border border-transparent font-medium'
                  }`}
                >
                  <Icon
                    size={15}
                    className={`shrink-0 transition-colors duration-200 ${
                      isActive ? 'text-blue-400 drop-shadow-[0_0_6px_rgba(96,165,250,0.5)]' : 'text-slate-400 group-hover:text-slate-300'
                    }`}
                  />
                  <span>{item.label}</span>
                  {typeof item.count === 'number' && item.count > 0 && (
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono transition-colors border ${
                        isActive
                          ? 'bg-blue-500/25 text-blue-200 border-blue-400/30'
                          : 'bg-slate-800/80 text-slate-400 border-slate-700/50 group-hover:border-slate-600/60'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                  {item.alert && (
                    <span className="relative flex h-2 w-2 ml-0.5" title={label('密钥状态需配置', 'Key configuration needed')}>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                    </span>
                  )}
                  {isActive && (
                    <span
                      className="absolute -bottom-[1px] left-3 right-3 h-[2px] bg-gradient-to-r from-transparent via-blue-400 to-transparent rounded-full shadow-[0_0_6px_rgba(96,165,250,0.8)]"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 主体表单区域 */}
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
          <div
            className="flex-1 overflow-y-auto custom-scrollbar p-5 sm:p-7 space-y-6"
            role="tabpanel"
            id={`ai-settings-tabpanel-${tab}`}
            aria-labelledby={`ai-settings-tab-${tab}`}
          >
            {error && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium flex items-center gap-2">
                <AlertCircle size={16} className="text-rose-400 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* TAB: 生图模型 */}
            {tab === 'images' && (
              <div className="animate-in fade-in-50 duration-200 slide-in-from-bottom-1 space-y-6">
                <ImageModelSettings config={draft} onChange={setDraft} english={english} />
              </div>
            )}
            {tab === 'removal' && (
              <div className="animate-in fade-in-50 duration-200 slide-in-from-bottom-1 space-y-6">
                <BackgroundRemovalSettings english={english} />
              </div>
            )}

            <div hidden={tab !== 'other'} className={`space-y-6 ${tab === 'other' ? 'animate-in fade-in-50 duration-200 slide-in-from-bottom-1' : ''}`}>
              {store.encryption && <EncryptionKeySettings manager={store.encryption} english={english}
                onStatus={status => { setKeyStatus(status); if (status !== 'ready') setTab('other'); }}
                onBusy={setKeyBusy} onBackupPending={setBackupPending}
                onChanged={async () => {
                  const restored = await store.loadConfig();
                  setDraft(previous => ({ ...previous, endpoints: previous.endpoints.map(endpoint => ({ ...endpoint,
                    apiKey: restored.endpoints.find(item => item.id === endpoint.id)?.apiKey || '' })) }));
                  await onKeyChanged();
                }} />}
            {tab === 'other' && (
              <section className="p-5 rounded-2xl border border-slate-800/80 bg-slate-900/40 backdrop-blur-sm space-y-4">
                <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                  <div>
                    <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      <Sliders size={16} className="text-blue-400" />
                      <span>{label('单轮对话限制', 'Per-Turn Limits')}</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {label('防止长会话无限调用工具或重试生图消耗过多额度。', 'Guard against runaway tool loops and consecutive image retry limits.')}
                    </p>
                  </div>
                  <button type="button"
                    onClick={() => setDraft(prev => ({ ...prev, maxToolRounds: DEFAULT_MAX_TOOL_ROUNDS, maxImageFailures: DEFAULT_MAX_IMAGE_FAILURES }))}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
                    title={label('恢复默认限制', 'Reset Turn Limits')}
                    aria-label={label('恢复默认限制', 'Reset Turn Limits')}>
                    <RotateCcw size={14} />
                    <span>{label('恢复默认', 'Reset')}</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-1">
                  <div className="min-w-0">
                    <label htmlFor="ai-max-tool-rounds" className={labelClass}>{label('工具调用轮次上限', 'Tool Round Limit')}</label>
                    <input id="ai-max-tool-rounds" type="number" min={1} max={Number.MAX_SAFE_INTEGER} step={1} required
                      value={Number.isNaN(draft.maxToolRounds) ? '' : draft.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS}
                      onChange={event => setDraft(prev => ({ ...prev, maxToolRounds: event.target.valueAsNumber }))}
                      className={inputClass} />
                  </div>
                  <div className="min-w-0">
                    <label htmlFor="ai-max-image-failures" className={labelClass}>{label('生图累计失败上限', 'Image Failure Limit')}</label>
                    <input id="ai-max-image-failures" type="number" min={1} max={Number.MAX_SAFE_INTEGER} step={1} required
                      value={Number.isNaN(draft.maxImageFailures) ? '' : draft.maxImageFailures ?? DEFAULT_MAX_IMAGE_FAILURES}
                      onChange={event => setDraft(prev => ({ ...prev, maxImageFailures: event.target.valueAsNumber }))}
                      className={inputClass} />
                  </div>
                </div>
              </section>
            )}
            </div>

            {/* TAB: 端点与模型 */}
            {tab === 'models' && (
              <div className="animate-in fade-in-50 duration-200 slide-in-from-bottom-1 space-y-6">
                {/* 顶部活跃模型旗舰卡片 */}
                <div className="p-5 rounded-2xl border border-blue-500/25 bg-gradient-to-r from-blue-950/30 via-slate-900/60 to-indigo-950/20 backdrop-blur-sm space-y-3.5 shadow-lg shadow-blue-950/10">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                      </span>
                      <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">
                        {label('当前默认活跃模型', 'Current Active Model')}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {testStatus && (
                        <span className="text-xs font-medium text-blue-300 flex items-center gap-1.5 bg-blue-950/40 px-2.5 py-1 rounded-lg border border-blue-500/20">
                          {testStatus}
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={isTesting}
                        onClick={handleTestConnection}
                        className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-blue-900/30 transition-all cursor-pointer"
                      >
                        <Sparkles size={13} className={isTesting ? 'animate-spin' : ''} />
                        <span>{isTesting ? label('测试中...', 'Testing...') : label('测试连通性', 'Test Connection')}</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-base font-bold text-white flex items-center gap-2 flex-wrap">
                      <span>{activeModel.label}</span>
                      <span className="text-xs font-normal text-slate-400">
                        ({label('来自端点', 'from')}: {activeEndpoint.name})
                      </span>
                      <span className="text-xs font-mono text-blue-300/80 bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20">
                        {activeModel.modelId}
                      </span>
                    </div>

                    <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                      <span className="text-slate-300">
                        {activeModel.thinkingAvailable
                          ? label('🧠 思考推理模式已支持', '🧠 Thinking reasoning supported')
                          : label('⚡ 标准快速生成模式', '⚡ Standard generation mode')}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span>
                        {label('上下文窗口', 'Context')}:{' '}
                        <strong className="text-slate-300 font-mono">
                          {activeModel.contextWindow.toLocaleString()}
                        </strong>{' '}
                        tokens
                      </span>
                      <span className="text-slate-600">·</span>
                      <span>
                        {label('最大输出', 'Max Output')}:{' '}
                        <strong className="text-slate-300 font-mono">
                          {activeModel.maxTokens.toLocaleString()}
                        </strong>{' '}
                        tokens
                      </span>
                      <span className="text-slate-600">·</span>
                      <span>
                        {activeModel.supportsVision
                          ? label('👁️ 支持多模态图像识别', '👁️ Vision input supported')
                          : label('📝 纯文本交互', '📝 Text only')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* API 端点列表区域 */}
                <div className="space-y-4 pt-1">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-200">
                        {label('API 服务端点配置', 'API Endpoint Configurations')}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {label(
                          '支持任何兼容 OpenAI Chat Completions 规范的云端或本地 Ollama 服务',
                          'Supports OpenAI-compatible cloud APIs or local Ollama endpoints'
                        )}
                      </p>
                    </div>

                    {/* 添加端点快速选择 */}
                    <div className="relative">
                      <select
                        aria-label={label('添加端点预设', 'Add Endpoint Preset')}
                        value=""
                        onChange={e => {
                          if (e.target.value) addEndpoint(e.target.value as any);
                        }}
                        className="bg-slate-850 hover:bg-slate-800 border border-slate-700 hover:border-blue-500 text-xs font-semibold text-blue-400 rounded-xl px-3 py-1.5 outline-none cursor-pointer transition-colors shadow-sm"
                      >
                        <option value="" disabled>
                          + {label('添加端点预设', 'Add Endpoint')}
                        </option>
                        <option value="deepseek">DeepSeek (官方)</option>
                        <option value="openai">OpenAI (官方)</option>
                        <option value="local">Ollama (本地)</option>
                        <option value="custom">{label('自定义端点 (OpenAI兼容)', 'Custom Endpoint')}</option>
                      </select>
                    </div>
                  </div>

                  {/* 端点卡片列表 */}
                  <div className="space-y-3.5">
                    {draft.endpoints.map(ep => {
                      const isExpanded = Boolean(expandedEndpoints[ep.id]);
                      const hasKey = Boolean(ep.apiKey && ep.apiKey.trim().length > 0);
                      const isCurrentActiveEndpoint = ep.id === activeEndpoint.id;

                      return (
                        <div
                          key={ep.id}
                          ref={element => {
                            endpointRefs.current[ep.id] = element;
                          }}
                          className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                            newlyAddedEndpointId === ep.id
                              ? 'ring-2 ring-blue-500 bg-blue-950/20 border-blue-500 shadow-lg shadow-blue-950/30'
                              : isCurrentActiveEndpoint
                              ? 'bg-slate-900/90 border-blue-500/40 shadow-md shadow-blue-950/15'
                              : 'bg-slate-900/50 border-slate-800 hover:border-slate-700/80'
                          }`}
                        >
                          {/* 端点卡片头部 */}
                          <div
                            onClick={() => toggleEndpointExpanded(ep.id)}
                            className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-800/30 select-none transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="p-1 rounded-lg text-slate-400 hover:text-white bg-slate-800/60 shrink-0">
                                {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                              </span>

                              <div className="min-w-0">
                                <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                                  <span className="truncate">{ep.name}</span>
                                  {isCurrentActiveEndpoint && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30 font-semibold">
                                      {label('活跃端点', 'Active')}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs font-mono text-slate-400 truncate mt-0.5">{ep.endpoint}</div>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0" onClick={e => e.stopPropagation()}>
                              {/* Key 状态展示 */}
                              {hasKey ? (
                                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                  {label('Key 已配置', 'Key Configured')}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-xs text-amber-400/90 font-medium">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                  {label('未设置 Key', 'No API Key')}
                                </span>
                              )}

                              {/* 删除端点按钮 */}
                              <button
                                type="button"
                                disabled={draft.endpoints.length <= 1}
                                onClick={() => removeEndpoint(ep.id)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-20 transition-colors cursor-pointer"
                                title={label('删除此端点', 'Delete Endpoint')}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>

                          {/* 展开的端点详情配置 */}
                          {isExpanded && (
                            <div className="p-5 border-t border-slate-800/80 bg-slate-950/40 space-y-4 text-xs">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                  <label className={labelClass}>{label('端点标识名称', 'Endpoint Name')}</label>
                                  <input
                                    required
                                    value={ep.name}
                                    onChange={e => updateEndpoint(ep.id, { name: e.target.value })}
                                    className={inputClass}
                                    placeholder={label('例如：DeepSeek 官方', 'e.g. DeepSeek API')}
                                  />
                                </div>

                                <div>
                                  <label className={labelClass}>API Key</label>
                                  <div className="relative flex items-center">
                                    <input
                                      autoComplete="off"
                                      type={showKeyMap[ep.id] ? 'text' : 'password'}
                                      placeholder="sk-..."
                                      value={ep.apiKey}
                                      onChange={e => updateEndpoint(ep.id, { apiKey: e.target.value })}
                                      className={`${inputClass} pr-9 font-mono`}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setShowKeyMap(m => ({ ...m, [ep.id]: !m[ep.id] }))}
                                      className="absolute right-2.5 text-slate-400 hover:text-slate-200 p-1 cursor-pointer"
                                    >
                                      {showKeyMap[ep.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                  </div>
                                </div>
                              </div>

                              <div>
                                <label className={labelClass}>
                                  {label('端点服务完整地址 (Base URL)', 'Endpoint Base Service URL')}
                                </label>
                                <input
                                  type="url"
                                  required
                                  value={ep.endpoint}
                                  onChange={e => updateEndpoint(ep.id, { endpoint: e.target.value })}
                                  className={`${inputClass} font-mono`}
                                  placeholder="https://api.openai.com/v1"
                                />
                                <span className="text-[11px] text-slate-500 block mt-1">
                                  {label(
                                    '请填写兼容 OpenAI Chat Completions 规范的完整 URL，如 https://api.deepseek.com/v1',
                                    'Enter full OpenAI-compatible URL, e.g. https://api.deepseek.com/v1'
                                  )}
                                </span>
                              </div>

                              {/* 该端点下的模型列表 */}
                              <div className="pt-3 space-y-3">
                                <div className="flex items-center justify-between pb-1">
                                  <span className="font-bold text-slate-200 flex items-center gap-1.5">
                                    <Cpu size={14} className="text-blue-400" />
                                    <span>{label('该端点下的模型列表', 'Models under this endpoint')}</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => addModelToEndpoint(ep.id)}
                                    className="text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1 cursor-pointer transition-colors"
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
                                        className={`p-4 bg-slate-900/90 border rounded-xl space-y-3.5 transition-all ${
                                          isDefault
                                            ? 'border-blue-500/40 shadow-sm'
                                            : 'border-slate-800 hover:border-slate-700/80'
                                        }`}
                                      >
                                        <div className="flex items-center justify-between gap-3">
                                          <div className="flex items-center gap-2 min-w-0">
                                            <div className="w-6 h-6 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0">
                                              <Cpu size={13} />
                                            </div>
                                            <span className="font-bold text-slate-100 text-sm truncate">{m.label}</span>
                                          </div>

                                          <div className="flex items-center gap-2 shrink-0">
                                            {isDefault ? (
                                              <span className="px-2.5 py-0.5 rounded-lg bg-blue-600/20 text-blue-300 border border-blue-500/40 text-[11px] font-semibold">
                                                {label('当前默认模型', 'Default')}
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
                                                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-blue-600 text-slate-300 hover:text-white text-[11px] font-semibold transition-colors cursor-pointer"
                                              >
                                                {label('设为默认', 'Set as Default')}
                                              </button>
                                            )}

                                            <button
                                              type="button"
                                              disabled={ep.models.length <= 1}
                                              onClick={() => removeModelFromEndpoint(ep.id, m.id)}
                                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-20 transition-colors cursor-pointer"
                                              title={label('删除此模型', 'Delete Model')}
                                            >
                                              <Trash2 size={14} />
                                            </button>
                                          </div>
                                        </div>

                                        {/* 参数网格 */}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                          <div>
                                            <label className={labelClass}>
                                              {label('模型展示名称', 'Display Name')}
                                            </label>
                                            <input
                                              required
                                              value={m.label}
                                              onChange={e => updateModel(ep.id, m.id, { label: e.target.value })}
                                              className={inputClass}
                                            />
                                          </div>
                                          <div>
                                            <label className={labelClass}>
                                              {label('模型 ID (API 请求参数)', 'Model ID (API)')}
                                            </label>
                                            <input
                                              required
                                              value={m.modelId}
                                              onChange={e => updateModel(ep.id, m.id, { modelId: e.target.value })}
                                              className={`${inputClass} font-mono`}
                                            />
                                          </div>
                                          <div>
                                            <label className={labelClass}>
                                              {label('上下文窗口 (Tokens)', 'Context Window')}
                                            </label>
                                            <input
                                              type="number"
                                              required
                                              step={1}
                                              min={256}
                                              value={m.contextWindow}
                                              onChange={e =>
                                                updateModel(ep.id, m.id, { contextWindow: Number(e.target.value) })
                                              }
                                              className={`${inputClass} font-mono`}
                                            />
                                          </div>
                                          <div>
                                            <label className={labelClass}>
                                              {label('最大输出 (Max Tokens)', 'Max Tokens')}
                                            </label>
                                            <input
                                              type="number"
                                              required
                                              step={1}
                                              min={1}
                                              value={m.maxTokens}
                                              onChange={e =>
                                                updateModel(ep.id, m.id, { maxTokens: Number(e.target.value) })
                                              }
                                              className={`${inputClass} font-mono`}
                                            />
                                          </div>
                                        </div>

                                        {/* 思考模式与多模态特性设置 */}
                                        <div className="pt-2 border-t border-slate-800/80 space-y-3">
                                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                            <div className="flex items-center gap-5">
                                              <div className="flex items-center gap-2">
                                                <Brain size={14} className="text-blue-400 shrink-0" />
                                                <ToggleSwitch
                                                  checked={m.thinkingAvailable}
                                                  onChange={checked => {
                                                    updateModel(ep.id, m.id, {
                                                      thinkingAvailable: checked,
                                                      defaultThinkingEnabled: checked,
                                                      thinkingEnabled: checked,
                                                      supportedReasoningEfforts: checked
                                                        ? [...ALL_REASONING_EFFORTS]
                                                        : m.supportedReasoningEfforts
                                                    });
                                                  }}
                                                  label={label('思考推理', 'Thinking')}
                                                />
                                              </div>

                                              <div className="flex items-center gap-2">
                                                <Eye size={14} className="text-emerald-400 shrink-0" />
                                                <ToggleSwitch
                                                  checked={m.supportsVision}
                                                  activeColor="bg-emerald-600 shadow-emerald-600/40"
                                                  onChange={checked =>
                                                    updateModel(ep.id, m.id, { supportsVision: checked })
                                                  }
                                                  label={label('多模态视觉', 'Vision')}
                                                />
                                              </div>
                                            </div>

                                            {m.thinkingAvailable && (
                                              <div className="flex items-center gap-4 text-xs">
                                                <ToggleSwitch
                                                  checked={m.defaultThinkingEnabled ?? m.thinkingEnabled}
                                                  onChange={checked =>
                                                    updateModel(ep.id, m.id, {
                                                      defaultThinkingEnabled: checked
                                                    })
                                                  }
                                                  label={label('默认开启', 'Default')}
                                                />

                                                {/* 默认思考强度 */}
                                                {(() => {
                                                  const ALL_EFFORT_CATEGORIES: ReasoningEffort[] = [
                                                    'minimal',
                                                    'low',
                                                    'medium',
                                                    'high',
                                                    'xhigh',
                                                    'max'
                                                  ];
                                                  const supportedCategories = ALL_EFFORT_CATEGORIES.filter(effort =>
                                                    m.supportedReasoningEfforts.includes(effort)
                                                  );
                                                  const availableDefaultOptions =
                                                    supportedCategories.length > 0
                                                      ? supportedCategories
                                                      : (['medium'] as ReasoningEffort[]);
                                                  const currentDefaultEffort = availableDefaultOptions.includes(
                                                    m.defaultReasoningEffort as ReasoningEffort
                                                  )
                                                    ? (m.defaultReasoningEffort as ReasoningEffort)
                                                    : availableDefaultOptions.includes(m.reasoningEffort as ReasoningEffort)
                                                    ? (m.reasoningEffort as ReasoningEffort)
                                                    : availableDefaultOptions[0];

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
                                                        className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-[11px] font-semibold text-blue-400 outline-none cursor-pointer"
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

                                          {/* 思考级别多选控制 */}
                                          {m.thinkingAvailable && (
                                            <div className="bg-slate-950/70 rounded-xl p-3 border border-slate-800/80 space-y-2">
                                              <div className="flex items-center justify-between text-[11px]">
                                                <span className="text-slate-400 font-medium">
                                                  {label('支持的思考级别选择 (Reasoning Efforts):', 'Supported Reasoning Levels:')}
                                                </span>
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    const ALL_EFFORT_CATEGORIES: ReasoningEffort[] = [
                                                      'minimal',
                                                      'low',
                                                      'medium',
                                                      'high',
                                                      'xhigh',
                                                      'max'
                                                    ];
                                                    const allSelected = ALL_EFFORT_CATEGORIES.every(e =>
                                                      m.supportedReasoningEfforts.includes(e)
                                                    );
                                                    const nextSupported: ReasoningEffort[] = allSelected
                                                      ? ['none', 'medium']
                                                      : ['none', ...ALL_EFFORT_CATEGORIES];

                                                    const validEfforts = ALL_EFFORT_CATEGORIES.filter(e =>
                                                      nextSupported.includes(e)
                                                    );
                                                    let nextDefault = m.defaultReasoningEffort;
                                                    if (!validEfforts.includes(nextDefault as ReasoningEffort)) {
                                                      nextDefault = validEfforts[0] || 'medium';
                                                    }

                                                    updateModel(ep.id, m.id, {
                                                      supportedReasoningEfforts: nextSupported,
                                                      defaultReasoningEffort: nextDefault,
                                                      reasoningEffort: nextSupported.includes(m.reasoningEffort)
                                                        ? m.reasoningEffort
                                                        : nextDefault
                                                    });
                                                  }}
                                                  className="text-blue-400 hover:text-blue-300 font-semibold cursor-pointer"
                                                >
                                                  {(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as ReasoningEffort[]).every(
                                                    e => m.supportedReasoningEfforts.includes(e)
                                                  )
                                                    ? label('恢复部分', 'Reset Partial')
                                                    : label('全选类别', 'Select All')}
                                                </button>
                                              </div>

                                              <div className="flex flex-wrap gap-2">
                                                {(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as ReasoningEffort[]).map(
                                                  effort => {
                                                    const isChecked = m.supportedReasoningEfforts.includes(effort);
                                                    const ALL_EFFORT_CATEGORIES: ReasoningEffort[] = [
                                                      'minimal',
                                                      'low',
                                                      'medium',
                                                      'high',
                                                      'xhigh',
                                                      'max'
                                                    ];

                                                    return (
                                                      <label
                                                        key={effort}
                                                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] cursor-pointer transition-colors select-none ${
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
                                                              next = Array.from(
                                                                new Set([...m.supportedReasoningEfforts, effort])
                                                              );
                                                            } else {
                                                              const remaining = ALL_EFFORT_CATEGORIES.filter(
                                                                item => item !== effort && m.supportedReasoningEfforts.includes(item)
                                                              );
                                                              if (remaining.length === 0) return;
                                                              next = m.supportedReasoningEfforts.filter(item => item !== effort);
                                                            }

                                                            const nextSupported = ALL_EFFORT_CATEGORIES.filter(item =>
                                                              next.includes(item)
                                                            );
                                                            let nextDefault = m.defaultReasoningEffort;
                                                            if (!nextSupported.includes(nextDefault as ReasoningEffort)) {
                                                              nextDefault = nextSupported[0] || 'medium';
                                                            }

                                                            let nextReasoning = m.reasoningEffort;
                                                            if (
                                                              nextReasoning !== 'none' &&
                                                              !nextSupported.includes(nextReasoning)
                                                            ) {
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
                                                  }
                                                )}
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
              </div>
            )}

            {tab === 'skills' && (
              <SkillSettings skills={draft.skills ?? []} english={english}
                onChange={skills => setDraft(previous => ({ ...previous, skills }))} />
            )}

            {/* TAB: 系统提示词 */}
            {tab === 'prompt' && (
              <div className="animate-in fade-in-50 duration-200 slide-in-from-bottom-1 space-y-6">
                {/* 封面设计系统提示词 */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-800">
                    <div>
                      <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                        <FileText size={16} className="text-blue-400" />
                        <span>{label('封面设计系统提示词 (System Prompt)', 'System Instructions')}</span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {label(
                          '指导大模型如何理解画布尺寸、图层属性并精准调用设计与编辑工具。',
                          'Directs how the model manipulates canvas layers and invokes design tools.'
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDraft(prev => ({ ...prev, systemPrompt: SYSTEM_PROMPT }))}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
                    >
                      <RotateCcw size={13} />
                      <span>{label('恢复默认提示词', 'Reset to Default')}</span>
                    </button>
                  </div>
                  <textarea
                    rows={12}
                    value={draft.systemPrompt}
                    onChange={e => setDraft(prev => ({ ...prev, systemPrompt: e.target.value }))}
                    className="w-full bg-slate-950/90 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-300 leading-relaxed outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 custom-scrollbar"
                  />
                  <div className="text-[11px] text-slate-500 flex items-center justify-between">
                    <span>{label('提示：修改提示词后需保存并开启新会话方可生效。', 'Note: Changes apply to newly created sessions.')}</span>
                    <span>{draft.systemPrompt.length} {label('字符', 'chars')}</span>
                  </div>
                </div>

                {/* 生图工具提示词 */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-800">
                    <div>
                      <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                        <ImagePlus size={16} className="text-indigo-400" />
                        <span>{label('生图工具提示词 (Image Tool Prompt)', 'Image Tool Instructions')}</span>
                      </h4>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {label(
                          '当启用生图模型工具时自动追加到系统指令；若清空则不追加。',
                          'Appended to system prompt when image tools are enabled; leave blank to omit.'
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDraft(prev => ({ ...prev, imageToolPrompt: DEFAULT_IMAGE_TOOL_PROMPT }))}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
                    >
                      <RotateCcw size={13} />
                      <span>{label('恢复默认', 'Reset')}</span>
                    </button>
                  </div>
                  <textarea
                    rows={5}
                    value={draft.imageToolPrompt ?? DEFAULT_IMAGE_TOOL_PROMPT}
                    onChange={e => setDraft(prev => ({ ...prev, imageToolPrompt: e.target.value }))}
                    className="w-full bg-slate-950/90 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-300 leading-relaxed outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 custom-scrollbar"
                  />
                </div>
              </div>
            )}

            {/* TAB: 快捷短语 */}
            {tab === 'snippets' && (
              <div className="animate-in fade-in-50 duration-200 slide-in-from-bottom-1 space-y-5">
                {/* 说明横幅 */}
                <div className="p-4 rounded-2xl border border-blue-500/20 bg-blue-950/20 backdrop-blur-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
                        '在会话初始界面展示的一键快捷发送短语，方便快速发起高频封面设计指令。',
                        'Configure quick prompt chips shown on assistant launch for fast workflow triggering.'
                      )}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setDraft(prev => ({ ...prev, quickSnippets: [...DEFAULT_QUICK_SNIPPETS] }));
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
                  >
                    <RotateCcw size={13} />
                    <span>{label('恢复默认预设', 'Reset Defaults')}</span>
                  </button>
                </div>

                {/* 添加新短语输入框 */}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      value={newSnippet}
                      placeholder={label(
                        '输入新的快捷短语，例如：将主标题更换为科技感艺术字并居中...',
                        'Enter new prompt, e.g. center all text layers and enhance typography...'
                      )}
                      onChange={e => setNewSnippet(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddSnippet();
                        }
                      }}
                      className="w-full bg-slate-950/90 border border-slate-800 focus:border-blue-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder:text-slate-600 outline-none transition-all shadow-inner"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddSnippet}
                    disabled={!newSnippet.trim()}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-blue-900/30 cursor-pointer shrink-0"
                  >
                    <Plus size={15} />
                    <span>{label('添加短语', 'Add Snippet')}</span>
                  </button>
                </div>

                {/* 推荐设计意图快捷点击 */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400">
                    {label('💡 推荐常用封面设计意图 (点击直接加入列表):', '💡 Recommended design prompts (click to add):')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      '调整画布背景为高级暗色质感渐变',
                      '为封面添加醒目的艺术大标题',
                      '自动居中所有文字并优化上下间距',
                      '在四周添加极简科技感几何边框与点缀',
                      '将副标题调整为现代极简无衬线字体',
                      '生成一张契合主题的高清插画背景图'
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
                          className={`text-xs px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
                            alreadyAdded
                              ? 'bg-slate-900/40 border-slate-800/60 text-slate-600 cursor-default'
                              : 'bg-slate-900 hover:bg-slate-800 border-slate-700/80 hover:border-blue-500/50 text-slate-300 hover:text-white shadow-sm'
                          }`}
                        >
                          <span>{alreadyAdded ? '✓ ' : '+ '}</span>
                          <span>{rec}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 已启用的短语列表 */}
                <div className="space-y-2.5 pt-1">
                  <div className="text-xs font-bold text-slate-300 flex items-center justify-between">
                    <span>{label('当前生效短语列表', 'Enabled Snippets List')}</span>
                    <span className="text-[11px] font-normal text-slate-500">
                      {label('会话中将按以下顺序展示', 'Shown in assistant welcome screen')}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {snippets.map((snip, index) => (
                      <div
                        key={index}
                        className="p-3 bg-slate-900/70 border border-slate-800 hover:border-slate-700 rounded-xl flex items-center justify-between text-xs group transition-all shadow-sm"
                      >
                        <div className="flex items-center gap-3 min-w-0 pr-3">
                          <span className="w-6 h-6 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <span className="text-slate-200 font-medium select-text break-words">
                            {snip}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* 复制短语 */}
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

                          {/* 删除短语 */}
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

          {/* 底部操作栏 */}
          <footer className="px-4 sm:px-6 py-4 border-t border-slate-800/80 bg-slate-900/60 flex flex-wrap items-center justify-end gap-3 shrink-0">
            {backupPending && <span className="mr-auto text-xs text-amber-300">{label('请先完成一次性备份步骤', 'Finish the one-time backup step first')}</span>}
            <button
              type="button"
              disabled={saving || keyBusy || backupPending}
              onClick={onBack}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-750 transition-colors cursor-pointer"
            >
              {label('取消', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={saving || keyBusy || backupPending || keyStatus !== 'ready'}
              className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/30 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <Save size={15} />
              <span>{saving ? label('保存中...', 'Saving...') : label('保存并生效配置', 'Save and Apply')}</span>
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}