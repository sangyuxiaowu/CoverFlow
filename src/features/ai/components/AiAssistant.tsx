import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  Brain,
  Check,
  CheckCircle2,
  CircleAlert,
  Copy,
  History,
  Image as ImageIcon,
  ImagePlus,
  LoaderCircle,
  Maximize2,
  Minus,
  Plus,
  Play,
  RotateCcw,
  RotateCw,
  Send,
  Settings,
  Sparkles,
  Square,
  Trash2,
  X,
  Zap
} from 'lucide-react';
import type { Language } from '../../../translations.ts';
import type { WorkspaceOptions } from '../services/workspace.ts';
import { useAiAssistant } from '../hooks/useAiAssistant.ts';
import AiSettings from './AiSettings.tsx';
import { DEFAULT_QUICK_SNIPPETS, resolveSelection } from '../services/config.ts';
import { useFloatingPanel } from '../hooks/useFloatingPanel.ts';
import { useChatScroll } from '../hooks/useChatScroll.ts';
import ModelControls from './ModelControls.tsx';
import { useChatStore } from '../hooks/useChatStore.ts';
import SessionList from './SessionList.tsx';
import TokenUsageBar from './TokenUsageBar.tsx';
import MarkdownView from './MarkdownView.tsx';
import ToolDuration from './ToolDuration.tsx';
import ChatScrollbar from './ChatScrollbar.tsx';
import { imageModelForTool } from './imageToolModel.ts';
import { sumUsage } from '../services/usage.ts';
import { createImageUpload } from '../services/imageAttachments.ts';
import type { ChatImageUpload } from '../types.ts';
import './assistant.css';

interface Props {
  workspace: WorkspaceOptions;
  lang: Language;
  onBusyChange: (busy: boolean) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const toolLabels: Record<string, [string, string]> = {
  get_context: ['读取画布', 'Read Canvas'],
  get_cover_size_recommendations: ['封面尺寸建议', 'Cover Size Recommendations'],
  create_project: ['新建项目', 'Create Project'],
  search_projects: ['搜索项目', 'Search Projects'],
  manage_projects: ['项目管理', 'Manage Projects'],
  read_layers: ['读取图层', 'Read Layers'],
  get_selected_layers: ['读取选中图层', 'Read Selected Layers'],
  add_layer: ['新建图层', 'Add Layer'],
  edit_layers: ['编辑图层', 'Edit Layers'],
  update_canvas: ['调整画布', 'Update Canvas'],
  list_image_models: ['读取生图模型', 'List Image Models'],
  generate_image: ['生成图片', 'Generate Image'],
  remove_background: ['移除背景', 'Remove Background'],
  get_canvas_preview: ['预览当前效果', 'Preview Canvas']
};

export default function AiAssistant({
  workspace,
  lang,
  onBusyChange,
  open: propOpen,
  onOpenChange
}: Props) {
  const chatStore = useChatStore(workspace);
  const assistant = useAiAssistant(workspace, onBusyChange, chatStore);
  const floating = useFloatingPanel(chatStore);

  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = propOpen !== undefined;
  const open = isControlled ? propOpen : internalOpen;

  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const nextVal = typeof next === 'function' ? next(open) : next;
    if (!isControlled) {
      setInternalOpen(nextVal);
    }
    onOpenChange?.(nextVal);
  };

  const [settings, setSettings] = useState(false);
  const [securityRequested, setSecurityRequested] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [keyAlert, setKeyAlert] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const chatScroll = useChatScroll(assistant.activeSessionId, open && !floating.minimized, !showSessions);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imageUploads, setImageUploads] = useState<ChatImageUpload[]>([]);
  const [selectedImage, setSelectedImage] = useState<{ name: string; src: string } | null>(null);
  const imagePreviewUrls = useMemo(() => imageUploads.map(item => URL.createObjectURL(item.blob)), [imageUploads]);

  useEffect(() => () => imagePreviewUrls.forEach(url => URL.revokeObjectURL(url)), [imagePreviewUrls]);
  useEffect(() => {
    if (!selectedImage) return;
    return () => URL.revokeObjectURL(selectedImage.src);
  }, [selectedImage?.src]);

  const english = lang === 'en';
  const active = resolveSelection(assistant.config);
  const controlsDisabled = assistant.busy || assistant.loading || assistant.saving || Boolean(assistant.loadError);
  const label = (zh: string, en: string) => (english ? en : zh);

  const activeSession = assistant.sessions.find(session => session.id === assistant.activeSessionId);
  const currentSessionTitle = activeSession?.title || label('新对话', 'New Chat');

  // 最小化时轮播真实的模型文本和工具步骤
  const [tickerIndex, setTickerIndex] = useState(0);

  useEffect(() => {
    if (!assistant.busy) return;
    const timer = window.setInterval(() => {
      setTickerIndex(prev => prev + 1);
    }, 2400);
    return () => window.clearInterval(timer);
  }, [assistant.busy]);

  const lastAssistantEntry = useMemo(
    () => [...assistant.entries].reverse().find(e => e.role === 'assistant'),
    [assistant.entries]
  );
  const runningTool = lastAssistantEntry?.tools?.find(t => t.status === 'running');
  const runningToolLabel = runningTool ? (toolLabels[runningTool.name]?.[english ? 1 : 0] || runningTool.name) : null;

  const busyStatusList = useMemo(() => {
    if (!assistant.busy) return [];
    const list = (lastAssistantEntry?.activity || []).flatMap(event => {
      if (event.type === 'text') {
        const text = event.text.replace(/[#*`\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(-64);
        return text ? [text] : [];
      }
      const tool = lastAssistantEntry?.tools?.find(item => item.id === event.toolId);
      if (!tool) return [];
      const name = toolLabels[tool.name]?.[english ? 1 : 0] || tool.name;
      return [tool.status === 'running'
        ? (english ? `Executing: ${name}...` : `正在执行：${name}`)
        : tool.status === 'error'
          ? (english ? `Failed: ${name}` : `执行失败：${name}`)
          : (english ? `Done: ${name}` : `已完成：${name}`)];
    });
    if (runningToolLabel && !list.length) {
      list.push(english ? `Executing: ${runningToolLabel}...` : `正在执行：${runningToolLabel}`);
    }
    const defaults = english
      ? ['Planning canvas layout & hierarchy...', 'Adjusting layers and typography...', 'Refining visual aesthetics...']
      : ['正在规划画面排版与视觉重点...', '正在组织画布图层与尺寸规范...', '正在完善细节与配色方案...'];
    return list.length ? list : defaults;
  }, [assistant.busy, runningToolLabel, lastAssistantEntry, english]);

  const currentBusyStatus = busyStatusList[tickerIndex % (busyStatusList.length || 1)] || (english ? 'AI is working...' : 'AI 正在执行操作...');

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId(prev => (prev === id ? null : prev));
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  // 从配置中读取快捷短语或使用预设
  const activeSnippets = assistant.config.quickSnippets || DEFAULT_QUICK_SNIPPETS;

  useEffect(() => {
    if (open) {
      floating.setMinimized(false);
    }
  }, [open]);

  useEffect(() => {
    if (open && !settings && !floating.minimized && !controlsDisabled) {
      inputRef.current?.focus();
    }
  }, [open, settings, floating.minimized, controlsDisabled]);

  useEffect(() => {
    if (assistant.confirmation) {
      floating.setMinimized(false);
    }
  }, [assistant.confirmation]);

  const close = () => {
    if (assistant.busy) assistant.stop('panel_closed');
    setOpen(false);
  };

  const submit = (overridePrompt?: string) => {
    const value = overridePrompt !== undefined ? overridePrompt : prompt;
    if ((!value.trim() && !imageUploads.length) || controlsDisabled) return;

    // 当前选择的AI模型没有设置KEY的时候，在发送时，直接提醒前往设置配置KEY，然后输入内容退回输入框
    const hasKey = Boolean(active.endpoint.apiKey && active.endpoint.apiKey.trim().length > 0);
    if (!hasKey) {
      setPrompt(value);
      setKeyAlert(
        english
          ? `Model "${active.model.label}" has no API Key configured. Please go to AI Settings to configure KEY.`
          : `当前选择的 AI 模型（${active.model.label}）未设置 KEY，请前往设置配置 KEY。`
      );
      inputRef.current?.focus();
      return;
    }

    setKeyAlert(null);
    setShowSessions(false);
    chatScroll.resetScroll();
    setPrompt('');
    const uploads = imageUploads;
    setImageUploads([]);
    void assistant.send(value.trim() || label('请分析这张图片。', 'Please analyze this image.'), uploads).catch(error => {
      setPrompt(value);
      setImageUploads(uploads);
      setKeyAlert(error instanceof Error ? error.message : label('图片发送失败。', 'Image upload failed.'));
    });
  };

  const addImages = async (files: FileList | File[] | null) => {
    const selectedFiles = files ? Array.from(files) : [];
    if (!selectedFiles.length) return;
    if (imageUploads.length + selectedFiles.length > 4) {
      setKeyAlert(label('每条消息最多添加 4 张图片。', 'Attach up to 4 images per message.'));
      return;
    }
    try {
      const uploads = await Promise.all(selectedFiles.map(file => createImageUpload(file, assistant.config.imageModels?.some(model => model.enabled))));
      setImageUploads(previous => [...previous, ...uploads]);
      setKeyAlert(null);
    } catch (error) {
      setKeyAlert(error instanceof Error ? error.message : label('图片处理失败。', 'Image processing failed.'));
    }
  };

  const openStoredImage = async (image: { id: string; name: string }) => {
    const sessionId = assistant.activeSessionId;
    if (!sessionId) return;
    try {
      const blob = await chatStore.loadImage(sessionId, image.id);
      if (!blob) throw new Error(label('图片附件不存在。', 'Image attachment not found.'));
      setSelectedImage({ name: image.name, src: URL.createObjectURL(blob) });
    } catch (error) {
      setKeyAlert(error instanceof Error ? error.message : label('图片读取失败。', 'Unable to load image.'));
    }
  };

  const handleSelectQuickPrompt = (text: string) => {
    if (controlsDisabled) return;
    setPrompt(text);
    inputRef.current?.focus();
  };

  if (!open) return null;

  return (
    <>
      <aside
        className={`cf-ai-panel ${floating.minimized ? 'cf-ai-minimized' : ''}`}
        style={floating.style}
        aria-label={label('AI 助手', 'AI Assistant')}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            if (assistant.confirmation) {
              assistant.confirmation.resolve(false);
            } else {
              close();
            }
          }
        }}
      >
        {/* 顶部标题栏 */}
        <header className="cf-ai-header" {...floating.headerEvents}>
          {/* 左上角六个点（拖拽手柄及 busy 动效） */}
          <div
            className={`cf-ai-header-drag-dots ${assistant.busy ? 'is-loading' : ''}`}
            title={assistant.busy ? label('AI 正在处理...', 'AI Processing...') : label('按住拖拽移动', 'Drag to move')}
            aria-hidden="true"
          >
            <span className="cf-ai-drag-dot" />
            <span className="cf-ai-drag-dot" />
            <span className="cf-ai-drag-dot" />
            <span className="cf-ai-drag-dot" />
            <span className="cf-ai-drag-dot" />
            <span className="cf-ai-drag-dot" />
          </div>

          <div className="cf-ai-bot-avatar">
            <Bot size={18} />
          </div>

          <div className="cf-ai-heading">
            <h2>
              {label('AI 封面助手', 'CoverFlow AI')}
            </h2>
            {floating.minimized && assistant.busy ? (
              <div className="cf-ai-minimized-ticker" title={currentBusyStatus}>
                <span className="cf-ai-ticker-badge">{english ? 'WORKING' : '执行中'}</span>
                <span className="cf-ai-ticker-text" key={`${tickerIndex % busyStatusList.length}:${currentBusyStatus}`}>{runningTool ? `${label('正在执行：', 'Executing: ')}${runningToolLabel}` : currentBusyStatus}</span>
                {runningTool && <ToolDuration tool={runningTool} english={english} />}
              </div>
            ) : (
              <span title={currentSessionTitle}>
                {currentSessionTitle}
              </span>
            )}
          </div>

          <div className="cf-ai-header-actions">
            {!floating.minimized && (
              <>
                <button
                  type="button"
                  className="cf-ai-icon"
                  disabled={controlsDisabled}
                  onClick={() => {
                    void assistant.newSession();
                    setShowSessions(false);
                  }}
                  title={label('新建对话', 'New Chat')}
                  aria-label={label('新建对话', 'New Chat')}
                >
                  <Plus size={16} />
                </button>
                <button
                  type="button"
                  className={`cf-ai-icon ${showSessions ? 'cf-ai-icon-active text-emerald-400 bg-emerald-500/15' : ''}`}
                  disabled={controlsDisabled}
                  onClick={() => setShowSessions(previous => !previous)}
                  title={label('历史对话', 'Chat History')}
                  aria-label={label('历史对话', 'Chat History')}
                  aria-expanded={showSessions}
                >
                  <History size={16} />
                </button>
                <button
                  type="button"
                  className="cf-ai-icon"
                  disabled={assistant.busy || assistant.loading || assistant.saving}
                  onClick={() => {
                    setKeyAlert(null);
                    setSecurityRequested(assistant.keyError);
                    setSettings(true);
                  }}
                  title={label('AI 配置中心', 'AI Settings Center')}
                  aria-label={label('AI 配置中心', 'AI Settings Center')}
                >
                  <Settings size={16} />
                </button>
              </>
            )}
            <button
              type="button"
              className="cf-ai-icon"
              onClick={() => floating.setMinimized(previous => !previous)}
              title={floating.minimized ? label('恢复', 'Restore') : label('最小化', 'Minimize')}
              aria-label={floating.minimized ? label('恢复', 'Restore') : label('最小化', 'Minimize')}
            >
              {floating.minimized ? <Maximize2 size={15} /> : <Minus size={16} />}
            </button>
            <button
              type="button"
              className="cf-ai-icon cf-ai-icon-close"
              onClick={close}
              title={label('关闭', 'Close')}
              aria-label={label('关闭', 'Close')}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {!floating.minimized && (
          <>
            {assistant.keyError && <div className="cf-ai-config-error" role="alert">
              <span>{label('API Key 无法解锁。请导入对应密钥，或重新生成后填写 API Key。', 'API keys are locked. Import the matching key, or regenerate and re-enter API keys.')}</span>
              <button type="button" className="cf-ai-icon" onClick={() => { setSecurityRequested(true); setSettings(true); }}
                title={label('管理密钥', 'Manage Encryption Key')} aria-label={label('管理密钥', 'Manage Encryption Key')}><Settings size={16} /></button>
            </div>}
            {(assistant.loadError || assistant.configError) && (
              <div className="cf-ai-config-error" role="alert">
                <span>{assistant.loadError || assistant.configError}</span>
                {assistant.loadError && (
                  <button
                    className="cf-ai-icon"
                    onClick={() => {
                      void assistant.reloadConfig();
                    }}
                    disabled={assistant.loading}
                    title={label('重试读取', 'Retry Loading')}
                    aria-label={label('重试读取', 'Retry Loading')}
                  >
                    <RotateCcw size={16} />
                  </button>
                )}
              </div>
            )}

            {/* 上下文画布状态栏 */}
            <div className="cf-ai-context">
              <span className="cf-ai-dot" />
              <span title={workspace.project?.title}>
                {workspace.project?.title || label('未打开项目 (项目库)', 'Project Library')}
              </span>
              <span className="cf-ai-meta">
                {workspace.project ? `${workspace.project.layers.length} ${label('图层', 'layers')}` : ''}
              </span>
            </div>

            {/* 消息区域 */}
            <div className="cf-ai-messages-region">
            <div
              className="cf-ai-messages"
              ref={chatScroll.scrollRef}
              onScroll={chatScroll.onScroll}
              onWheel={chatScroll.onWheel}
              role="log"
              aria-live="polite"
            >
              <div className="cf-ai-messages-content" ref={chatScroll.contentRef}>
              {showSessions ? (
                <SessionList
                  sessions={assistant.sessions}
                  activeId={assistant.activeSessionId}
                  disabled={controlsDisabled}
                  english={english}
                  canInsertImage={Boolean(workspace.project)}
                  onNew={async () => {
                    await assistant.newSession();
                    setShowSessions(false);
                  }}
                  onSelect={async id => {
                    await assistant.selectSession(id);
                    setShowSessions(false);
                  }}
                  onRename={assistant.renameSession}
                  onDelete={assistant.deleteSession}
                  onDeleteImages={assistant.deleteImages}
                  onInsertImage={assistant.insertImageToCanvas}
                  onLoadImage={(sessionId, imageId) => chatStore.loadImage(sessionId, imageId)}
                />
              ) : (
                <>
                  {!assistant.entries.length && (
                    <div className="cf-ai-empty">
                      <div className="cf-ai-empty-icon-wrap">
                        <Sparkles size={26} />
                      </div>
                      <h3>
                        {assistant.loading
                          ? label('正在加载 AI 配置...', 'Loading AI Configuration...')
                          : label('封面设计智能助手', 'CoverFlow AI Assistant')}
                      </h3>
                      <p>
                        {label(
                          '通过自然语言描述，我可以直接为你调整画布背景、排版标题、增删装饰与组织图层。',
                          'Describe your creative ideas in plain text. I can adjust background colors, organize layers, and add headlines automatically.'
                        )}
                      </p>
                      <div className="cf-ai-quick-prompts">
                        {activeSnippets.map((snip, idx) => (
                          <button
                            key={idx}
                            type="button"
                            className="cf-ai-quick-btn"
                            disabled={controlsDisabled}
                            onClick={() => handleSelectQuickPrompt(snip)}
                          >
                            <span className="emoji">{['🎨', '✍️', '📐', '✨'][idx % 4]}</span>
                            <span className="truncate">{snip}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {(() => {
                    const lastAssistantEntry = [...assistant.entries].reverse().find(e => e.role === 'assistant');
                    const currentSession = assistant.sessions.find(session => session.id === assistant.activeSessionId);

                    return assistant.entries.map(entry => {
                      const isLastAssistant = entry.id === lastAssistantEntry?.id;
                      const entryUsage = entry.usage || (currentSession?.requests ? sumUsage(currentSession.requests.filter(r => r.entryId === entry.id)) : undefined);
                      const hasContent = Boolean(entry.content && entry.content.trim());
                      const hasFinished = entry.role === 'assistant' && (hasContent || Boolean(entry.tools?.length) || entry.continuable) && !assistant.busy;
                      const activity = entry.activity?.length ? entry.activity : [
                        ...(entry.tools || []).map(tool => ({ id: tool.id, type: 'tool' as const, toolId: tool.id })),
                        ...(hasContent ? [{ id: `${entry.id}-content`, type: 'text' as const, text: entry.content }] : [])
                      ];

                      return (
                        <article key={entry.id} className={`cf-ai-message cf-ai-${entry.role}`}>
                          <div className="cf-ai-message-header">
                            <span className="cf-ai-message-role">
                              {entry.role === 'user' ? label('你', 'You') : 'CoverFlow AI'}
                            </span>
                          </div>
                          {entry.reasoning && (
                            <details className="cf-ai-reasoning">
                              <summary>
                                <Brain size={13} />
                                {label('思考过程', 'Reasoning')}
                              </summary>
                              <p>{entry.reasoning}</p>
                            </details>
                          )}
                          {activity.map(item => {
                            if (item.type === 'text') {
                              if (!item.text.trim()) return null;
                              return (
                                <div className="cf-ai-message-bubble" key={item.id}>
                                  {entry.role === 'assistant' ? <MarkdownView content={item.text} /> : <p>{item.text}</p>}
                                </div>
                              );
                            }
                            const tool = entry.tools?.find(candidate => candidate.id === item.toolId);
                            if (!tool) return null;
                            const imageModel = imageModelForTool(tool, assistant.config.imageModels);
                            return (
                              <details className="cf-ai-tool" key={item.id} open={Boolean(tool.image)}>
                                <summary>
                                  {tool.status === 'running' ? (
                                    <LoaderCircle size={14} className="cf-ai-spin text-amber-400" />
                                  ) : tool.status === 'error' ? (
                                    <CircleAlert size={14} className="cf-ai-error" />
                                  ) : (
                                    <CheckCircle2 size={14} className="text-emerald-400" />
                                  )}
                                  <span>{toolLabels[tool.name]?.[english ? 1 : 0] || tool.name}</span>
                                  {imageModel && <span className="cf-ai-tool-model" title={imageModel.modelId}>{imageModel.label}</span>}
                                  <ToolDuration tool={tool} english={english} />
                                  <span className={`cf-ai-tool-badge ${tool.status}`} title={tool.durationMs === undefined ? undefined : `${label('工具总耗时', 'Total tool elapsed time')}: ${(tool.durationMs / 1000).toFixed(1)}s`}>
                                    {tool.status === 'running'
                                      ? tool.name === 'generate_image' ? label('等待生成结果', 'Waiting') : label('执行中', 'Running')
                                      : tool.status === 'error'
                                        ? label('失败', 'Failed')
                                        : label('完成', 'Done')}
                                  </span>
                                </summary>
                                <div className="cf-ai-tool-section-label">{label('请求参数', 'Request Arguments')}</div>
                                <pre>{tool.arguments}</pre>
                                <div className="cf-ai-tool-section-label">{label('执行结果', 'Execution Result')}</div>
                                <pre>{tool.result || label('等待执行结果...', 'Waiting for result...')}</pre>
                                {tool.image && (
                                  <button
                                    type="button"
                                    onClick={() => void openStoredImage(tool.image!)}
                                    className="cf-ai-preview-link"
                                    title={label('点击查看预览图', 'Click to view preview')}
                                  >
                                    <ImageIcon size={13} />
                                    <span>{tool.image.name}</span>
                                  </button>
                                )}
                              </details>
                            );
                          })}
                          {entry.continuable && isLastAssistant && !assistant.busy && (
                            <p className="cf-ai-continuable-note">
                              {label('本轮已暂停，已完成的修改已保留。', 'Paused at the turn limit. Completed changes are preserved.')}
                            </p>
                          )}
                          {entry.role === 'user' && entry.images?.length ? (
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {entry.images.map(image => (
                                <button
                                  key={image.id}
                                  type="button"
                                  onClick={() => void openStoredImage(image)}
                                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900/70 px-2 py-1 text-[10px] text-slate-400 transition-colors hover:border-emerald-500/60 hover:text-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"
                                  title={label('点击查看图片', 'Click to view image')}
                                  aria-label={`${label('查看图片', 'View image')}: ${image.name}`}
                                >
                                  <ImageIcon size={12} />
                                  <span className="max-w-36 truncate">{image.name}</span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {!entry.content?.trim() && assistant.busy && entry.role === 'assistant' && (
                            <div className="flex items-center gap-2 text-slate-400 text-xs py-2 px-1">
                              <LoaderCircle size={16} className="cf-ai-spin text-emerald-400" />
                              <span>{label('正在构思与执行...', 'Thinking and executing...')}</span>
                            </div>
                          )}

                          {/* AI 返回操作栏：左1 图标复制 (仅图标)，左2 图标重新生成 (仅图标)，右边 显示图标和 xxxtoken */}
                          {entry.role === 'assistant' && hasFinished && (
                            <div className="cf-ai-message-footer flex items-center gap-1.5 mt-1.5 px-0.5 text-xs">
                              {/* 左1：图标复制 (仅图标，无文字) */}
                              {hasContent && (
                                <button
                                  type="button"
                                  onClick={() => handleCopy(entry.id, entry.content)}
                                  className="cf-ai-action-btn flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 transition-colors cursor-pointer select-none"
                                  title={copiedId === entry.id ? label('已复制', 'Copied') : label('复制回复', 'Copy response')}
                                  aria-label={copiedId === entry.id ? label('已复制', 'Copied') : label('复制回复', 'Copy response')}
                                >
                                  {copiedId === entry.id ? (
                                    <Check size={13} className="text-emerald-400" />
                                  ) : (
                                    <Copy size={13} />
                                  )}
                                </button>
                              )}

                              {/* 左2：图标重新生成 (仅图标，无文字，样式与复制按钮完全一致) */}
                              {isLastAssistant && !assistant.busy && (
                                <button
                                  type="button"
                                  disabled={controlsDisabled}
                                  onClick={() => void assistant.regenerate()}
                                  className="cf-ai-action-btn flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 transition-colors cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed"
                                  title={label(
                                    '从上次用户输入开始重新生成，撤销之前的AI操作 (重做)',
                                    'Regenerate from last user input, revert previous AI operations (Redo)'
                                  )}
                                  aria-label={label('重新生成 (重做)', 'Regenerate (Redo)')}
                                >
                                  <RotateCw size={13} />
                                </button>
                              )}

                              {isLastAssistant && entry.continuable && (
                                <button
                                  type="button"
                                  disabled={controlsDisabled}
                                  onClick={() => void assistant.send(label('继续', 'Continue'))}
                                  className="cf-ai-continue-btn"
                                >
                                  <Play size={12} />
                                  <span>{label('继续', 'Continue')}</span>
                                </button>
                              )}

                              {/* 右边：显示图标和 xxxtoken (悬停展示耗时与速率等详情) */}
                              {entryUsage && (entryUsage.outputTokens > 0 || entryUsage.totalTokens > 0) && (() => {
                                const turnDuration = entry.durationMs || (currentSession?.requests
                                  ? currentSession.requests.filter(r => r.entryId === entry.id && r.durationMs).reduce((sum, r) => sum + (r.durationMs || 0), 0)
                                  : undefined);
                                const outTokens = entryUsage.outputTokens || entryUsage.totalTokens || 0;
                                const turnSpeed = turnDuration && turnDuration > 0
                                  ? Math.round((outTokens / (turnDuration / 1000)) * 10) / 10
                                  : undefined;

                                const tooltipText = english
                                  ? [
                                      `In: ${entryUsage.inputTokens.toLocaleString()} · Out: ${entryUsage.outputTokens.toLocaleString()} · Total: ${entryUsage.totalTokens.toLocaleString()} tokens`,
                                      turnDuration ? `Duration: ${(turnDuration / 1000).toFixed(1)}s` : '',
                                      turnSpeed ? `Speed: ${turnSpeed} tokens/s` : ''
                                    ].filter(Boolean).join(' · ')
                                  : [
                                      `输入: ${entryUsage.inputTokens.toLocaleString()} · 输出: ${entryUsage.outputTokens.toLocaleString()} · 总计: ${entryUsage.totalTokens.toLocaleString()} tokens`,
                                      turnDuration ? `耗时: ${(turnDuration / 1000).toFixed(1)}s` : '',
                                      turnSpeed ? `速率: ${turnSpeed} tokens/s` : ''
                                    ].filter(Boolean).join(' · ');

                                return (
                                  <span
                                    className="cf-ai-token-tag ml-auto inline-flex items-center gap-1 text-[10px] text-slate-400 font-mono px-2 py-0.5 rounded-md bg-slate-800/60 border border-slate-700/50 select-none hover:border-slate-600/80 transition-colors"
                                    title={tooltipText}
                                  >
                                    <Zap size={11} className="text-amber-400/90" />
                                    <span>{`${outTokens.toLocaleString()} tokens`}</span>
                                  </span>
                                );
                              })()}
                            </div>
                          )}
                        </article>
                      );
                    });
                  })()}

                  {/* 执行出现异常时的重试卡片 (不把错误信息塞到历史对话中，提供重试按钮) */}
                  {assistant.executionError && (
                    <div
                      role="alert"
                      className="cf-ai-error-card bg-rose-950/40 border border-rose-800/60 rounded-xl p-3 my-2 text-xs flex flex-col gap-2.5 animate-in fade-in"
                    >
                      <div className="flex items-start gap-2.5 text-rose-300">
                        <CircleAlert size={16} className="text-rose-400 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-rose-200">
                            {label('执行出现异常', 'Execution Error')}
                          </div>
                          <p className="mt-0.5 text-rose-300/90 break-words leading-relaxed font-mono">
                            {assistant.executionError.message}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2 pt-1.5 border-t border-rose-800/40">
                        <button
                          type="button"
                          onClick={assistant.clearExecutionError}
                          className="px-2.5 py-1 text-slate-400 hover:text-slate-200 text-xs rounded-lg transition-colors cursor-pointer"
                        >
                          {label('忽略', 'Dismiss')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void assistant.retry()}
                          disabled={assistant.busy}
                          className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm shadow-rose-900/30 active:scale-95"
                        >
                          <RotateCcw size={13} />
                          <span>{label('重试', 'Retry')}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
              </div>
            </div>

              <ChatScrollbar
                scrollRef={chatScroll.scrollRef}
                contentRef={chatScroll.contentRef}
                scrollTo={chatScroll.scrollManually}
                english={english}
              />
            </div>

            {/* 操作确认框 */}
            {assistant.confirmation && (
              <section
                className="cf-ai-confirm"
                role="alertdialog"
                aria-modal="true"
                aria-label={label('确认删除', 'Confirm Deletion')}
              >
                <p>{assistant.confirmation.message}</p>
                <div className="cf-ai-actions">
                  <button className="cf-ai-secondary" onClick={() => assistant.confirmation?.resolve(false)}>
                    <X size={15} />
                    {label('取消', 'Cancel')}
                  </button>
                  <button className="cf-ai-danger" onClick={() => assistant.confirmation?.resolve(true)}>
                    <Check size={15} />
                    {label('确认删除', 'Delete')}
                  </button>
                </div>
              </section>
            )}

            {/* 未配置 KEY 提醒条 (提示前往设置配置 KEY，提供一键直达) */}
            {keyAlert && (
              <div
                role="alert"
                className="mx-3 mb-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between gap-2 shadow-lg animate-in fade-in slide-in-from-bottom-2 shrink-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <CircleAlert size={16} className="text-amber-400 shrink-0" />
                  <span className="truncate">{keyAlert}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setKeyAlert(null);
                      setSettings(true);
                    }}
                    className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs transition-colors cursor-pointer flex items-center gap-1 shadow-sm"
                  >
                    <Settings size={13} />
                    <span>{label('前往设置', 'Go to Settings')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setKeyAlert(null)}
                    className="p-1 hover:text-white text-amber-400 transition-colors cursor-pointer rounded-lg hover:bg-amber-500/20"
                    title={label('关闭提醒', 'Dismiss')}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* 底部输入框容器 (悬浮在输入框内部底部的极小尺寸控制工具栏，无分割线) */}
            <form
              className="p-3 border-t shrink-0 bg-slate-900/60 border-slate-800/80"
              onSubmit={event => {
                event.preventDefault();
                submit();
              }}
            >
              <div className="relative rounded-xl border transition-colors focus-within:border-blue-500 bg-slate-950/70 border-slate-700/80">
                {imageUploads.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto px-2 pt-2">
                    {imageUploads.map((upload, index) => (
                      <div key={upload.image.id} className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-slate-700">
                        <img src={imagePreviewUrls[index]} alt={upload.image.name} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setImageUploads(previous => previous.filter(item => item.image.id !== upload.image.id))}
                          className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center bg-slate-950/80 text-slate-200"
                          title={label('移除图片', 'Remove image')}
                          aria-label={`${label('移除图片', 'Remove image')}: ${upload.image.name}`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  ref={inputRef}
                  value={prompt}
                  disabled={controlsDisabled}
                  rows={3}
                  aria-label={label('发送消息', 'Message')}
                  placeholder={label(
                    '向 AI 助手描述修改意图，Ctrl+Enter 发送',
                    'Describe design intent to AI Assistant, Ctrl+Enter to send'
                  )}
                  onChange={event => {
                    setPrompt(event.target.value);
                    if (keyAlert) setKeyAlert(null);
                  }}
                  onPaste={event => {
                    const pastedImages = Array.from(event.clipboardData.items)
                      .filter(item => item.type.startsWith('image/'))
                      .map(item => item.getAsFile())
                      .filter((file): file is File => Boolean(file));
                    if (pastedImages.length) {
                      event.preventDefault();
                      void addImages(pastedImages);
                    }
                  }}
                  onKeyDown={event => {
                    if (
                      event.key === 'Enter' &&
                      (event.ctrlKey || event.metaKey) &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      submit();
                    }
                  }}
                  className="block w-full rounded-[11px] border-0 p-2.5 pb-9 text-xs resize-none focus:outline-none leading-normal bg-transparent text-slate-100 placeholder:text-slate-400 custom-scrollbar"
                />

                {/* 悬浮工具栏 (h-5, 绝对定位在底部，不分割独立区域) */}
                <div className="absolute inset-x-0 bottom-1.5 h-5 flex items-center justify-between gap-2 px-2 bg-transparent pointer-events-auto">
                  <div className="flex items-center gap-1 min-w-0">
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      multiple
                      className="hidden"
                      onChange={event => {
                        void addImages(event.currentTarget.files);
                        event.currentTarget.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={controlsDisabled || (!active.model.supportsVision && !assistant.config.imageModels?.some(model => model.enabled)) || imageUploads.length >= 4}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-emerald-300 disabled:opacity-30"
                      title={label('添加图片／生图参考（最多 4 张）', 'Attach images / generation references (up to 4)')}
                      aria-label={label('添加图片', 'Attach image')}
                    >
                      <ImagePlus size={14} />
                    </button>
                    <TokenUsageBar
                      session={assistant.sessions.find(session => session.id === assistant.activeSessionId)}
                      config={assistant.config}
                      prompt={prompt}
                      busy={assistant.busy}
                      english={english}
                    />
                    <ModelControls
                      config={assistant.config}
                      configure={assistant.configure}
                      disabled={controlsDisabled}
                      english={english}
                    />
                  </div>

                  <div className="flex items-center gap-1">
                    {assistant.busy ? (
                      <button
                        type="button"
                        onClick={() => assistant.stop()}
                        className="relative -top-0.5 w-8 h-8 flex items-center justify-center rounded-full bg-rose-600 hover:bg-rose-500 text-white transition-colors cursor-pointer active:scale-95 shadow-md shadow-rose-900/40"
                        title={label('停止', 'Stop')}
                      >
                        <Square size={12} />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={(!prompt.trim() && !imageUploads.length) || controlsDisabled}
                        className="relative -top-0.5 w-8 h-8 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white transition-colors cursor-pointer active:scale-95 shadow-md shadow-blue-900/40"
                        title={label('发送消息 (Ctrl+Enter)', 'Send message (Ctrl+Enter)')}
                      >
                        <Send className="w-3.5 h-3.5 -translate-x-[0.5px] -translate-y-[0.5px]" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </form>
          </>
        )}

        {!floating.minimized && (
          <button
            type="button"
            className="cf-ai-resize"
            {...floating.resizeEvents}
            onKeyDown={event => {
              if (event.key.startsWith('Arrow')) {
                event.preventDefault();
                floating.resizeByKeyboard(event.key, event.shiftKey);
              }
            }}
            title={label('调整浮窗大小', 'Resize Window')}
            aria-label={label('调整浮窗大小', 'Resize Window')}
          />
        )}
      </aside>

      {/* AI 助手配置中心模态弹窗 (Image 2 样式) */}
      {settings && (
        <AiSettings
          key={chatStore.id}
          config={assistant.config}
          onSave={assistant.configure}
          onBack={() => setSettings(false)}
          english={english}
          store={chatStore}
          onKeyChanged={assistant.reloadConfig}
          initialSecurity={securityRequested || assistant.keyError}
        />
      )}
      {selectedImage && createPortal(
        <div
          className="fixed inset-0 z-[240] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm"
          onClick={() => setSelectedImage(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={selectedImage.name}
            className="flex max-h-[94vh] max-w-[96vw] flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={event => event.stopPropagation()}
            onKeyDown={event => {
              if (event.key === 'Escape') setSelectedImage(null);
            }}
            tabIndex={-1}
          >
            <div className="flex min-w-0 items-center justify-between gap-4 border-b border-slate-700 px-3 py-2">
              <span className="truncate text-xs text-slate-300">{selectedImage.name}</span>
              <button
                type="button"
                onClick={() => setSelectedImage(null)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white"
                title={label('关闭图片预览', 'Close image preview')}
                aria-label={label('关闭图片预览', 'Close image preview')}
              >
                <X size={16} />
              </button>
            </div>
            <img
              src={selectedImage.src}
              alt={selectedImage.name}
              className="max-h-[84vh] max-w-[96vw] object-contain"
              draggable={false}
            />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}