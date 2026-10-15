import { useEffect, useRef, useState } from 'react';
import type { AiConfig, ChatEntry, ChatSession, ExecutionError } from '../types.ts';
import { runConversation, sanitizeResponseItems } from '../services/conversation.ts';
import { createWorkspaceBridge, type WorkspaceOptions } from '../services/workspace.ts';
import { defaultConfig, normalizeConfig, toRequestConfig } from '../services/config.ts';
import type { ChatStore } from '../services/chatStore.ts';
import { sumUsage } from '../services/usage.ts';

interface Confirmation { message: string; resolve: (accepted: boolean) => void }

export function useAiAssistant(workspace: WorkspaceOptions, onBusyChange: (busy: boolean) => void, store: ChatStore) {
  const [config, setConfig] = useState<AiConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [configError, setConfigError] = useState('');
  const [executionError, setExecutionError] = useState<ExecutionError | null>(null);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const sessionRef = useRef<ChatSession | null>(null);
  const storeRef = useRef(store);
  storeRef.current = store;
  const [busy, setBusy] = useState(false);

  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const controllerRef = useRef<AbortController | null>(null);
  const bridgeRef = useRef<ReturnType<typeof createWorkspaceBridge> | null>(null);
  if (!bridgeRef.current) bridgeRef.current = createWorkspaceBridge(() => workspaceRef.current, (message, signal) => new Promise<boolean>((resolve, reject) => {
    const cancel = () => { setConfirmation(null); reject(signal.reason); };
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener('abort', cancel, { once: true });
    setConfirmation({ message, resolve: accepted => { signal.removeEventListener('abort', cancel); setConfirmation(null); resolve(accepted); } });
  }));

  const activate = (session: ChatSession) => {
    sessionRef.current = session;
    setActiveSessionId(session.id);
    setEntries(session.entries);
  };
  const freshSession = (): ChatSession => ({ id: crypto.randomUUID(), title: '新对话', projectId: workspaceRef.current.project?.id, createdAt: Date.now(), updatedAt: Date.now(), entries: [], responseItems: [], requests: [] });
  const upsert = (session: ChatSession) => setSessions(previous => [session, ...previous.filter(item => item.id !== session.id)].sort((left, right) => right.updatedAt - left.updatedAt));
  const persist = async (session: ChatSession, target = store) => {
    await target.saveSession(session);
    if (storeRef.current === target) upsert(session);
  };
  const reloadConfig = async () => {
    const target = store;
    setLoading(true);
    setLoadError('');
    setConfigError('');
    try {
      const [stored, savedSessions, ui] = await Promise.all([target.loadConfig(), target.listSessions(), target.loadUiState()]);
      if (!mountedRef.current || storeRef.current !== target) return;
      const selected = savedSessions.find(item => item.id === ui.activeSessionId) || savedSessions[0] || freshSession();
      selected.entries = selected.entries.map(entry => ({ ...entry, tools: entry.tools?.map(tool => tool.status === 'running' ? { ...tool, status: 'error', result: 'The previous operation was interrupted.' } : tool) }));
      await target.saveSession(selected);
      await target.saveUiState({ activeSessionId: selected.id });
      if (storeRef.current !== target) return;
      setConfig(stored);
      setSessions([selected, ...savedSessions.filter(item => item.id !== selected.id)]);
      activate(selected);
    }
    catch (error) { if (mountedRef.current && storeRef.current === target) setLoadError(error instanceof Error ? error.message : 'Unable to load AI settings.'); }
    finally { if (mountedRef.current && storeRef.current === target) setLoading(false); }
  };
  useEffect(() => {
    mountedRef.current = true;
    void reloadConfig();
    return () => { mountedRef.current = false; controllerRef.current?.abort(); };
  }, [store]);

  useEffect(() => {
    if (loading || loadError || !sessionRef.current) return;
    const id = sessionRef.current.id;
    const timer = window.setTimeout(() => {
      if (sessionRef.current?.id !== id) return;
      void persist(structuredClone(sessionRef.current)).catch(error => setConfigError(error instanceof Error ? error.message : 'Chat save failed.'));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [entries, store, loading, loadError]);

  const operateSession = async (operation: () => Promise<void>) => {
    if (controllerRef.current || loading || loadError || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setConfigError('');
    setExecutionError(null);
    try { await operation(); }
    catch (error) { setConfigError(error instanceof Error ? error.message : 'Session operation failed.'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const newSession = () => operateSession(async () => {
    if (sessionRef.current) await persist(sessionRef.current);
    const next = freshSession();
    await persist(next);
    await store.saveUiState({ activeSessionId: next.id });
    activate(next);
  });
  const selectSession = (id: string) => operateSession(async () => {
    if (sessionRef.current) await persist(sessionRef.current);
    const next = (await store.listSessions()).find(item => item.id === id);
    if (!next) throw new Error('Session not found.');
    await store.saveUiState({ activeSessionId: next.id });
    activate(next);
  });
  const renameSession = (id: string, title: string) => operateSession(async () => {
    const source = sessionRef.current?.id === id ? sessionRef.current : sessions.find(item => item.id === id);
    if (!source || !title.trim()) throw new Error('Session title is required.');
    const next = { ...source, title: title.trim().slice(0, 120), updatedAt: Date.now() };
    await persist(next);
    if (sessionRef.current?.id === id) activate(next);
  });
  const deleteSession = (id: string) => operateSession(async () => {
    await store.deleteSession(id);
    const remaining = await store.listSessions();
    setSessions(remaining);
    if (sessionRef.current?.id === id) {
      const next = remaining[0] || freshSession();
      await persist(next);
      await store.saveUiState({ activeSessionId: next.id });
      activate(next);
    }
  });

  const configure = async (next: AiConfig) => {
    if (controllerRef.current || loading || loadError || savingRef.current) throw new Error('AI settings are busy or unavailable.');
    savingRef.current = true;
    setSaving(true);
    setConfigError('');
    try { await store.saveConfig(next); setConfig(normalizeConfig(next)); }
    catch (error) { setConfigError(error instanceof Error ? error.message : 'Unable to save AI settings.'); throw error; }
    finally { savingRef.current = false; setSaving(false); }
  };
  const send = async (prompt: string) => {
    if (!prompt.trim() || controllerRef.current || loading || loadError || savingRef.current || !sessionRef.current) return;
    setExecutionError(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    onBusyChange(true);
    const id = crypto.randomUUID();
    const targetStore = store;
    let working = structuredClone(sessionRef.current);

    // 确保若上轮以未封闭的 tool 输出结尾，添加占位 assistant 标记以保持 turn 规范
    working.responseItems = sanitizeResponseItems(working.responseItems);
    const lastItem = working.responseItems.at(-1);
    if (lastItem && 'type' in lastItem && (lastItem.type === 'function_call_output' || lastItem.type === 'function_call')) {
      working.responseItems.push({ role: 'assistant', content: '' });
    }

    const currentProject = bridgeRef.current?.getProject() || workspaceRef.current.project;
    const projectSnapshot = currentProject ? structuredClone(currentProject) : null;
    const previousResponseItems = structuredClone(working.responseItems);
    const user = { role: 'user' as const, content: prompt.trim() };
    if (!working.entries.length && working.title === '新对话') working.title = prompt.trim().slice(0, 40);
    working.projectId = workspaceRef.current.project?.id;
    working.responseItems = [...working.responseItems, user];
    working.entries.push(
      { id: crypto.randomUUID(), role: 'user', content: prompt.trim() },
      { id, role: 'assistant', content: '', tools: [], projectSnapshot, previousResponseItems }
    );
    const publish = () => {
      working.updatedAt = Date.now();
      if (storeRef.current !== targetStore) return;
      sessionRef.current = working;
      setEntries([...working.entries]);
      upsert(working);
    };
    publish();
    const update = (modifier: (entry: ChatEntry) => ChatEntry) => { working = { ...working, entries: working.entries.map(entry => entry.id === id ? modifier(entry) : entry) }; publish(); };
    try {
      await persist(working, targetStore);
      const content = await runConversation({
        config: toRequestConfig(config), input: working.responseItems, bridge: bridgeRef.current!, signal: controller.signal,
        onText: chunk => update(entry => ({ ...entry, content: entry.content + chunk })),
        onReasoning: chunk => update(entry => ({ ...entry, reasoning: (entry.reasoning || '') + chunk })),
        onTool: event => update(entry => ({ ...entry, tools: [...(entry.tools || []).filter(tool => tool.id !== event.id), event] })),
        onUsage: request => {
          const updatedRequests = [...working.requests.filter(item => item.id !== request.id), { ...request, entryId: id }];
          working.requests = updatedRequests;
          const turnRequests = updatedRequests.filter(item => item.entryId === id);
          const turnUsage = sumUsage(turnRequests);
          const turnDurationMs = turnRequests.reduce((sum, r) => sum + (r.durationMs || 0), 0);
          working.entries = working.entries.map(entry => entry.id === id ? { ...entry, usage: turnUsage, durationMs: turnDurationMs || undefined } : entry);
          publish();
        },
        onHistory: input => { working.responseItems = input; publish(); }
      });
      update(entry => ({ ...entry, content: content || entry.content }));
    } catch (error) {
      if (controller.signal.aborted) {
        const message = '已停止。已完成的操作保留，请检查当前项目。';
        update(entry => ({
          ...entry,
          content: entry.content ? entry.content + '\n\n' + message : message,
          tools: entry.tools?.map(tool => tool.status === 'running' ? { ...tool, status: 'error', result: message } : tool)
        }));
      } else {
        const errorMessage = error instanceof Error ? error.message : 'AI 请求失败。';
        const currentAssistantEntry = working.entries.find(entry => entry.id === id);
        const hasTools = Boolean(currentAssistantEntry?.tools && currentAssistantEntry.tools.length > 0);
        const hasReasoning = Boolean(currentAssistantEntry?.reasoning && currentAssistantEntry.reasoning.trim().length > 0);
        const hasContent = Boolean(currentAssistantEntry?.content && currentAssistantEntry.content.trim().length > 0);

        if (!hasTools && !hasReasoning && !hasContent && working.responseItems.length === previousResponseItems.length + 1) {
          working.entries = working.entries.filter(entry => entry.id !== id);
          working.responseItems = previousResponseItems;
        } else {
          // 保留已有执行工具与思考过程，避免丢失进度或重复执行已生效的操作
          working.entries = working.entries.map(entry =>
            entry.id === id
              ? {
                  ...entry,
                  tools: entry.tools?.map(tool =>
                    tool.status === 'running' ? { ...tool, status: 'error', result: errorMessage } : tool
                  )
                }
              : entry
          );
          working.responseItems = sanitizeResponseItems(working.responseItems);
        }

        setExecutionError({
          message: errorMessage,
          prompt: prompt.trim(),
          entryId: id
        });
        publish();
      }
    } finally {
      try { await persist(working, targetStore); }
      catch (error) { if (storeRef.current === targetStore) setConfigError(error instanceof Error ? error.message : 'Chat save failed.'); }
      controllerRef.current = null;
      setBusy(false);
      onBusyChange(false);
    }
  };

  const continueTurn = async (assistantId: string) => {
    if (controllerRef.current || loading || loadError || savingRef.current || !sessionRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    onBusyChange(true);
    const targetStore = store;
    let working = structuredClone(sessionRef.current);

    working.entries = working.entries.map(entry =>
      entry.id === assistantId
        ? {
            ...entry,
            content: '',
            error: false,
            tools: entry.tools?.map(tool => tool.status === 'running' ? { ...tool, status: 'error' } : tool)
          }
        : entry
    );
    working.responseItems = sanitizeResponseItems(working.responseItems);

    const publish = () => {
      working.updatedAt = Date.now();
      if (storeRef.current !== targetStore) return;
      sessionRef.current = working;
      setEntries([...working.entries]);
      upsert(working);
    };
    publish();

    const update = (modifier: (entry: ChatEntry) => ChatEntry) => {
      working = {
        ...working,
        entries: working.entries.map(entry => entry.id === assistantId ? modifier(entry) : entry)
      };
      publish();
    };

    try {
      await persist(working, targetStore);
      const content = await runConversation({
        config: toRequestConfig(config),
        input: working.responseItems,
        bridge: bridgeRef.current!,
        signal: controller.signal,
        onText: chunk => update(entry => ({ ...entry, content: entry.content + chunk })),
        onReasoning: chunk => update(entry => ({ ...entry, reasoning: (entry.reasoning || '') + chunk })),
        onTool: event => update(entry => ({
          ...entry,
          tools: [...(entry.tools || []).filter(tool => tool.id !== event.id), event]
        })),
        onUsage: request => {
          const updatedRequests = [...working.requests.filter(item => item.id !== request.id), { ...request, entryId: assistantId }];
          working.requests = updatedRequests;
          const turnRequests = updatedRequests.filter(item => item.entryId === assistantId);
          const turnUsage = sumUsage(turnRequests);
          const turnDurationMs = turnRequests.reduce((sum, r) => sum + (r.durationMs || 0), 0);
          working.entries = working.entries.map(entry => entry.id === assistantId ? { ...entry, usage: turnUsage, durationMs: turnDurationMs || undefined } : entry);
          publish();
        },
        onHistory: input => { working.responseItems = input; publish(); }
      });
      update(entry => ({ ...entry, content: content || entry.content }));
    } catch (error) {
      if (controller.signal.aborted) {
        const message = '已停止。已完成的操作保留，请检查当前项目。';
        update(entry => ({
          ...entry,
          content: entry.content ? entry.content + '\n\n' + message : message,
          tools: entry.tools?.map(tool => tool.status === 'running' ? { ...tool, status: 'error', result: message } : tool)
        }));
      } else {
        const errorMessage = error instanceof Error ? error.message : 'AI 请求失败。';
        setExecutionError({
          message: errorMessage,
          prompt: working.entries.find(e => e.role === 'user')?.content || '',
          entryId: assistantId
        });
        working.entries = working.entries.map(entry =>
          entry.id === assistantId
            ? {
                ...entry,
                tools: entry.tools?.map(tool =>
                  tool.status === 'running' ? { ...tool, status: 'error', result: errorMessage } : tool
                )
              }
            : entry
        );
        working.responseItems = sanitizeResponseItems(working.responseItems);
        publish();
      }
    } finally {
      try { await persist(working, targetStore); }
      catch (error) { if (storeRef.current === targetStore) setConfigError(error instanceof Error ? error.message : 'Chat save failed.'); }
      controllerRef.current = null;
      setBusy(false);
      onBusyChange(false);
    }
  };

  const clear = () => operateSession(async () => {
    if (!sessionRef.current) return;
    const next = { ...sessionRef.current, entries: [], responseItems: [], requests: [], updatedAt: Date.now() };
    await persist(next);
    activate(next);
  });
  const clearExecutionError = () => setExecutionError(null);

  const retry = async () => {
    if (!executionError || controllerRef.current || loading || loadError || savingRef.current || !sessionRef.current) return;
    const targetEntryId = executionError.entryId;
    const promptToRetry = executionError.prompt;
    setExecutionError(null);

    const working = structuredClone(sessionRef.current);
    const targetEntry = targetEntryId ? working.entries.find(entry => entry.id === targetEntryId) : null;
    const hasProgress = Boolean(
      targetEntry && (
        (targetEntry.tools && targetEntry.tools.length > 0) ||
        (targetEntry.reasoning && targetEntry.reasoning.trim().length > 0)
      )
    );

    if (hasProgress && targetEntryId) {
      await continueTurn(targetEntryId);
    } else {
      const lastEntry = working.entries.at(-1);
      if (lastEntry && lastEntry.role === 'user' && lastEntry.content === promptToRetry) {
        working.entries.pop();
        const lastResponse = working.responseItems.at(-1);
        if (lastResponse && 'role' in lastResponse && lastResponse.role === 'user' && lastResponse.content === promptToRetry) {
          working.responseItems.pop();
        }
        sessionRef.current = working;
        setEntries([...working.entries]);
      }
      await send(promptToRetry);
    }
  };

  const regenerate = async () => {
    if (controllerRef.current || loading || loadError || savingRef.current || !sessionRef.current) return;
    setExecutionError(null);
    const working = structuredClone(sessionRef.current);

    // 找到最后一条 AI 回复
    let lastAssistantIdx = -1;
    for (let i = working.entries.length - 1; i >= 0; i--) {
      if (working.entries[i].role === 'assistant') {
        lastAssistantIdx = i;
        break;
      }
    }
    if (lastAssistantIdx === -1) return;
    const lastAssistant = working.entries[lastAssistantIdx];

    // 找到该 AI 回复对应的上一条用户输入
    let lastUserIdx = -1;
    for (let i = lastAssistantIdx - 1; i >= 0; i--) {
      if (working.entries[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) return;
    const lastUserEntry = working.entries[lastUserIdx];
    const promptToRerun = lastUserEntry.content;

    // 1. 撤销之前的 AI 操作：恢复快照
    const snapshot = lastAssistant.projectSnapshot;
    if (snapshot) {
      try {
        if (bridgeRef.current) {
          await bridgeRef.current.commit(structuredClone(snapshot));
        } else if (workspaceRef.current) {
          workspaceRef.current.onCommit(structuredClone(snapshot));
          await workspaceRef.current.storage.saveProject(structuredClone(snapshot));
        }
      } catch (err) {
        console.warn('Failed to revert project snapshot on regenerate:', err);
      }
    }

    // 2. 移除上一轮的用户和助手 entry，撤销历史不分叉
    working.entries = working.entries.filter((_, idx) => idx !== lastAssistantIdx && idx !== lastUserIdx);

    // 3. 恢复 responseItems 到该次用户提问之前的状态
    if (lastAssistant.previousResponseItems) {
      working.responseItems = structuredClone(lastAssistant.previousResponseItems);
    } else {
      working.responseItems = sanitizeResponseItems(working.responseItems);
      let userPromptIdx = -1;
      for (let i = working.responseItems.length - 1; i >= 0; i--) {
        const item = working.responseItems[i];
        if ('role' in item && item.role === 'user' && item.content === promptToRerun) {
          userPromptIdx = i;
          break;
        }
      }
      if (userPromptIdx !== -1) {
        working.responseItems = working.responseItems.slice(0, userPromptIdx);
      }
    }

    // 清理该 assistant entry 的单次 requests 记录
    working.requests = working.requests.filter(r => r.entryId !== lastAssistant.id);

    sessionRef.current = working;
    setEntries([...working.entries]);
    await persist(working);

    // 4. 从上次用户输入重新发起
    await send(promptToRerun);
  };

  return {
    config, configure, entries, sessions, activeSessionId, newSession, selectSession,
    renameSession, deleteSession, busy, loading, saving, loadError, configError,
    reloadConfig, send, clear, confirmation, stop: () => controllerRef.current?.abort(),
    executionError, clearExecutionError, retry, regenerate
  };
}