import { useEffect, useRef, useState } from 'react';
import type { AiConfig, ChatEntry, ChatSession } from '../types.ts';
import { runConversation } from '../services/conversation.ts';
import { createWorkspaceBridge, type WorkspaceOptions } from '../services/workspace.ts';
import { defaultConfig, normalizeConfig, toRequestConfig } from '../services/config.ts';
import type { ChatStore } from '../services/chatStore.ts';

interface Confirmation { message: string; resolve: (accepted: boolean) => void }

export function useAiAssistant(workspace: WorkspaceOptions, onBusyChange: (busy: boolean) => void, store: ChatStore) {
  const [config, setConfig] = useState<AiConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [configError, setConfigError] = useState('');
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
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    onBusyChange(true);
    const id = crypto.randomUUID();
    const targetStore = store;
    let working = structuredClone(sessionRef.current);
    const user = { role: 'user' as const, content: prompt.trim() };
    if (!working.entries.length && working.title === '新对话') working.title = prompt.trim().slice(0, 40);
    working.projectId = workspaceRef.current.project?.id;
    working.responseItems = [...working.responseItems, user];
    working.entries.push({ id: crypto.randomUUID(), role: 'user', content: prompt.trim() }, { id, role: 'assistant', content: '', tools: [] });
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
          working.requests = [...working.requests.filter(item => item.id !== request.id), { ...request, entryId: id }];
          publish();
        },
        onHistory: input => { working.responseItems = input; publish(); }
      });
      update(entry => ({ ...entry, content: content || entry.content }));
    } catch (error) {
      const message = controller.signal.aborted ? '已停止。已完成的操作保留，请检查当前项目。' : `${error instanceof Error ? error.message : 'AI 请求失败。'} 已完成的操作不会自动回滚。`;
      update(entry => ({ ...entry, content: entry.content ? entry.content + '\n\n' + message : message, error: !controller.signal.aborted, tools: entry.tools?.map(tool => tool.status === 'running' ? { ...tool, status: 'error', result: message } : tool) }));
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
  return { config, configure, entries, sessions, activeSessionId, newSession, selectSession, renameSession, deleteSession, busy, loading, saving, loadError, configError, reloadConfig, send, clear, confirmation, stop: () => controllerRef.current?.abort() };
}