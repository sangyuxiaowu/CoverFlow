import { useEffect, useRef, useState } from 'react';
import { Bot, Brain, Check, CheckCircle2, CircleAlert, GripHorizontal, History, LoaderCircle, Maximize2, Minimize2, Minus, MoveDiagonal2, Plus, RotateCcw, Send, Settings, Square, Trash2, X } from 'lucide-react';
import type { Language } from '../../../translations.ts';
import type { WorkspaceOptions } from '../services/workspace.ts';
import { useAiAssistant } from '../hooks/useAiAssistant.ts';
import AiSettings from './AiSettings.tsx';
import { resolveSelection } from '../services/config.ts';
import { useFloatingPanel } from '../hooks/useFloatingPanel.ts';
import ModelControls from './ModelControls.tsx';
import { useChatStore } from '../hooks/useChatStore.ts';
import SessionList from './SessionList.tsx';
import TokenUsageBar from './TokenUsageBar.tsx';
import './assistant.css';

interface Props { workspace: WorkspaceOptions; lang: Language; onBusyChange: (busy: boolean) => void }

const toolLabels: Record<string, [string, string]> = {
  get_context: ['读取画布', 'Read Canvas'], manage_projects: ['项目管理', 'Manage Projects'], read_layers: ['读取图层', 'Read Layers'],
  add_layer: ['新建图层', 'Add Layer'], edit_layers: ['编辑图层', 'Edit Layers'], update_canvas: ['调整画布', 'Update Canvas']
};

export default function AiAssistant({ workspace, lang, onBusyChange }: Props) {
  const chatStore = useChatStore(workspace);
  const assistant = useAiAssistant(workspace, onBusyChange, chatStore);
  const floating = useFloatingPanel(chatStore);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [prompt, setPrompt] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const english = lang === 'en';
  const active = resolveSelection(assistant.config);
  const controlsDisabled = assistant.busy || assistant.loading || assistant.saving || Boolean(assistant.loadError);
  const label = (zh: string, en: string) => english ? en : zh;
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [assistant.entries, assistant.confirmation]);
  useEffect(() => {
    if (open && !settings && !floating.minimized && !controlsDisabled) inputRef.current?.focus();
  }, [open, settings, floating.minimized, controlsDisabled]);
  useEffect(() => { if (assistant.confirmation) floating.setMinimized(false); }, [assistant.confirmation]);
  const close = () => { if (assistant.busy) assistant.stop(); setOpen(false); launcherRef.current?.focus(); };
  const submit = () => { const value = prompt; if (!value.trim() || controlsDisabled) return; setShowSessions(false); setPrompt(''); void assistant.send(value); };
  return <>
    <button ref={launcherRef} className={`cf-ai-launcher ${open ? 'cf-ai-launcher-hidden' : ''}`} onClick={() => { floating.setMinimized(false); setOpen(true); }} title={label('AI 助手', 'AI Assistant')} aria-label={label('AI 助手', 'AI Assistant')} aria-expanded={open}><Bot size={22} /><span>{label('AI 助手', 'AI Assistant')}</span></button>
    {open && <aside className={`cf-ai-panel ${floating.minimized ? 'cf-ai-minimized' : ''}`} style={floating.style} aria-label={label('AI 助手', 'AI Assistant')} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); if (assistant.confirmation) assistant.confirmation.resolve(false); else close(); }
    }}>
      <header className="cf-ai-header" {...floating.headerEvents}><GripHorizontal size={18} /><div className="cf-ai-heading"><h2>{label('AI 助手', 'AI Assistant')}{assistant.busy && <LoaderCircle size={13} className="cf-ai-spin" />}</h2><span title={active.model.modelId}>{active.endpoint.name} · {active.model.label}</span></div>
        {!floating.minimized && <button className="cf-ai-icon" disabled={controlsDisabled} onClick={() => setSettings(previous => !previous)} title={label('模型设置', 'Model Settings')} aria-label={label('模型设置', 'Model Settings')}><Settings size={18} /></button>}
        <button className="cf-ai-icon" onClick={() => floating.setMinimized(previous => !previous)} title={floating.minimized ? label('展开', 'Expand') : label('最小化', 'Minimize')} aria-label={floating.minimized ? label('展开', 'Expand') : label('最小化', 'Minimize')}>{floating.minimized ? <Maximize2 size={18} /> : <Minus size={18} />}</button>
        {!floating.minimized && <button className="cf-ai-icon" onClick={floating.toggleMaximized} title={floating.maximized ? label('还原窗口', 'Restore Window') : label('最大化', 'Maximize')} aria-label={floating.maximized ? label('还原窗口', 'Restore Window') : label('最大化', 'Maximize')}>{floating.maximized ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>}
        <button className="cf-ai-icon" onClick={close} title={label('关闭', 'Close')} aria-label={label('关闭', 'Close')}><X size={20} /></button>
      </header>
      {!floating.minimized && <>
      {(assistant.loadError || assistant.configError) && <div className="cf-ai-config-error" role="alert"><span>{assistant.loadError || assistant.configError}</span>{assistant.loadError && <button className="cf-ai-icon" onClick={() => { void assistant.reloadConfig(); }} disabled={assistant.loading} title={label('重试读取', 'Retry Loading')} aria-label={label('重试读取', 'Retry Loading')}><RotateCcw size={16} /></button>}</div>}
      {settings ? <AiSettings config={assistant.config} onSave={assistant.configure} onBack={() => setSettings(false)} english={english} /> : <>
        <ModelControls config={assistant.config} configure={assistant.configure} disabled={controlsDisabled} english={english} />
        <div className="cf-ai-session-bar"><button className="cf-ai-icon" disabled={controlsDisabled} onClick={() => setShowSessions(previous => !previous)} title={label('会话历史', 'Session History')} aria-label={label('会话历史', 'Session History')} aria-expanded={showSessions}><History size={16} /></button><span>{assistant.sessions.find(session => session.id === assistant.activeSessionId)?.title || label('新对话', 'New Chat')}</span><button className="cf-ai-icon" disabled={controlsDisabled} onClick={() => { void assistant.newSession(); }} title={label('新建会话', 'New Session')} aria-label={label('新建会话', 'New Session')}><Plus size={16} /></button></div>
        <div className="cf-ai-context"><span className="cf-ai-dot" /><span title={workspace.project?.title}>{workspace.project?.title || label('项目库', 'Project Library')}</span><span className="cf-ai-meta">{workspace.project ? `${workspace.project.layers.length} ${label('图层', 'layers')}` : ''}</span></div>
        <div className="cf-ai-messages" ref={scrollRef} role="log" aria-live="polite">
          {showSessions ? <SessionList sessions={assistant.sessions} activeId={assistant.activeSessionId} disabled={controlsDisabled} english={english} onNew={assistant.newSession} onSelect={assistant.selectSession} onRename={assistant.renameSession} onDelete={assistant.deleteSession} /> : <>
          {!assistant.entries.length && <div className="cf-ai-empty"><Bot size={36} /><h3>{assistant.loading ? label('正在加载配置', 'Loading Settings') : label('开始对话', 'Start a Conversation')}</h3></div>}
          {assistant.entries.map(entry => <article key={entry.id} className={`cf-ai-message cf-ai-${entry.role}`}><div className="cf-ai-message-role">{entry.role === 'user' ? label('你', 'You') : 'CoverFlow'}</div>
            {entry.reasoning && <details className="cf-ai-reasoning"><summary><Brain size={14} />{label('思考过程', 'Reasoning')}</summary><p>{entry.reasoning}</p></details>}
            {entry.tools?.map(tool => <details className="cf-ai-tool" key={tool.id}><summary>{tool.status === 'running' ? <LoaderCircle size={14} className="cf-ai-spin" /> : tool.status === 'error' ? <CircleAlert size={14} className="cf-ai-error" /> : <CheckCircle2 size={14} />}<span>{toolLabels[tool.name]?.[english ? 1 : 0] || tool.name}</span><span className="cf-ai-meta">{tool.status === 'running' ? label('执行中', 'Running') : tool.status === 'error' ? label('失败', 'Failed') : label('完成', 'Done')}</span></summary><pre>{tool.result || label('等待结果', 'Waiting')}</pre></details>)}
            {entry.content && <p className={entry.error ? 'cf-ai-error' : ''}>{entry.content}</p>}
            {!entry.content && assistant.busy && entry.role === 'assistant' && <LoaderCircle size={18} className="cf-ai-spin" aria-label={label('处理中', 'Processing')} />}
          </article>)}
          </>}
        </div>
        {assistant.confirmation && <section className="cf-ai-confirm" role="alertdialog" aria-modal="true" aria-label={label('确认删除', 'Confirm Deletion')}><p>{assistant.confirmation.message}</p><div className="cf-ai-actions"><button className="cf-ai-secondary" onClick={() => assistant.confirmation?.resolve(false)}><X size={16} />{label('取消', 'Cancel')}</button><button className="cf-ai-danger" onClick={() => assistant.confirmation?.resolve(true)}><Check size={16} />{label('确认删除', 'Delete')}</button></div></section>}
        <form className="cf-ai-composer" onSubmit={event => { event.preventDefault(); submit(); }}>
          <TokenUsageBar session={assistant.sessions.find(session => session.id === assistant.activeSessionId)} config={assistant.config} prompt={prompt} busy={assistant.busy} english={english} />
          <textarea ref={inputRef} value={prompt} disabled={controlsDisabled} rows={3} aria-label={label('发送消息', 'Message')} placeholder={label('想做些什么？', 'What would you like to do?')} onChange={event => setPrompt(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
          }} />
          <div className="cf-ai-actions"><button type="button" className="cf-ai-icon" disabled={controlsDisabled || !assistant.entries.length} onClick={() => { void assistant.clear(); }} title={label('清空对话', 'Clear Conversation')} aria-label={label('清空对话', 'Clear Conversation')}><Trash2 size={16} /></button><span className="cf-ai-meta">{assistant.busy ? label('处理中', 'Processing') : assistant.saving ? label('保存中', 'Saving') : assistant.loading ? label('加载中', 'Loading') : label('就绪', 'Ready')}</span>{assistant.busy ? <button type="button" className="cf-ai-primary" onClick={assistant.stop} title={label('停止', 'Stop')} aria-label={label('停止', 'Stop')}><Square size={16} />{label('停止', 'Stop')}</button> : <button type="submit" className="cf-ai-primary" disabled={!prompt.trim() || controlsDisabled} title={label('发送', 'Send')} aria-label={label('发送', 'Send')}><Send size={16} /></button>}</div>
        </form>
      </>}
      {!floating.maximized && <button type="button" className="cf-ai-resize" {...floating.resizeEvents} onKeyDown={event => { if (event.key.startsWith('Arrow')) { event.preventDefault(); floating.resizeByKeyboard(event.key, event.shiftKey); } }} title={label('调整浮窗大小', 'Resize Window')} aria-label={label('调整浮窗大小', 'Resize Window')}><MoveDiagonal2 size={14} /></button>}
      </>}
    </aside>}
  </>;
}