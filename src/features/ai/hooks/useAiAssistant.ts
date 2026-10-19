import { useEffect, useRef, useState } from 'react';
import type { ProjectState } from '../../../types.ts';
import type { AiConfig, ChatEntry, ChatImageRef, ChatImageUpload, ChatSession, ExecutionError, ResponseItem, ToolEvent } from '../types.ts';
import type { ResponseInputMessageContentList } from 'openai/resources/responses/responses';
import { ConversationAbortError, conversationAbortDetails, runConversation, sanitizeResponseItems } from '../services/conversation.ts';
import { createWorkspaceBridge, type WorkspaceOptions } from '../services/workspace.ts';
import { defaultConfig, normalizeConfig, toRequestConfig } from '../services/config.ts';
import type { ChatStore } from '../services/chatStore.ts';
import { removeSessionImages } from '../services/chatStore.ts';
import { sumUsage } from '../services/usage.ts';
import { generateId } from '../../../utils/helpers.ts';
import { blobToDataUrl, imageMimeType } from '../services/imageAttachments.ts';
import { ConfigDecryptionError } from '../services/configStore.ts';

interface Confirmation { message: string; resolve: (accepted: boolean) => void }

function stoppedConversationMessage(signal: AbortSignal): string {
  const details = conversationAbortDetails(signal);
  const messages: Record<string, string> = {
    user_stop: '已停止。',
    panel_closed: 'AI 助手面板已关闭，本轮执行已中止。',
    storage_changed: '聊天存储位置已切换，本轮执行已中止。',
    assistant_disposed: 'AI 助手已卸载或重新加载，本轮执行已中止。'
  };
  return `${messages[details.abortSource] ?? `执行已中断：${details.reason}。`}已完成的操作保留，请检查当前项目。`;
}

function appendAssistantText(entry: ChatEntry, text: string): ChatEntry {
  const activity = [...(entry.activity || [])];
  const last = activity.at(-1);
  if (last?.type === 'text') activity[activity.length - 1] = { ...last, text: last.text + text };
  else activity.push({ id: generateId(), type: 'text', text });
  return { ...entry, content: entry.content + text, activity };
}

function updateToolActivity(entry: ChatEntry, event: ToolEvent): ChatEntry {
  const tools = [...(entry.tools || []).filter(tool => tool.id !== event.id), event];
  const activity = [...(entry.activity || [])];
  if (event.status === 'running' && !activity.some(item => item.type === 'tool' && item.toolId === event.id)) {
    activity.push({ id: event.id, type: 'tool', toolId: event.id });
  }
  return { ...entry, tools, activity };
}

export function useAiAssistant(workspace: WorkspaceOptions, onBusyChange: (busy: boolean) => void, store: ChatStore) {
  const [config, setConfig] = useState<AiConfig>(defaultConfig);
  const configRef = useRef(config);
  configRef.current = config;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [keyError, setKeyError] = useState(false);
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
  const freshSession = (): ChatSession => ({ id: generateId(), title: '新对话', projectId: workspaceRef.current.project?.id, createdAt: Date.now(), updatedAt: Date.now(), entries: [], responseItems: [], requests: [] });
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
      let locked = false;
      const [stored, savedSessions, ui] = await Promise.all([target.loadConfig().catch(error => {
        if (!(error instanceof ConfigDecryptionError)) throw error;
        locked = true;
        return error.config;
      }), target.listSessions(), target.loadUiState()]);
      if (!mountedRef.current || storeRef.current !== target) return;
      const selected = savedSessions.find(item => item.id === ui.activeSessionId) || savedSessions[0] || freshSession();
      selected.entries = selected.entries.map(entry => ({ ...entry, tools: entry.tools?.map(tool => tool.status === 'running' ? { ...tool, status: 'error', result: 'The previous operation was interrupted.' } : tool) }));
      await target.saveSession(selected);
      await target.saveUiState({ activeSessionId: selected.id });
      if (storeRef.current !== target) return;
      setConfig(stored);
      setKeyError(locked);
      setSessions([selected, ...savedSessions.filter(item => item.id !== selected.id)]);
      activate(selected);
    }
    catch (error) { if (mountedRef.current && storeRef.current === target) setLoadError(error instanceof Error ? error.message : 'Unable to load AI settings.'); }
    finally { if (mountedRef.current && storeRef.current === target) setLoading(false); }
  };
  useEffect(() => {
    mountedRef.current = true;
    void reloadConfig();
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort(new ConversationAbortError(storeRef.current.id !== store.id ? 'storage_changed' : 'assistant_disposed'));
    };
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

  const deleteImages = async (images: { sessionId: string; imageId: string }[]) => {
    let completed = false;
    await operateSession(async () => {
      const grouped = new Map<string, Set<string>>();
      images.forEach(image => {
        if (!grouped.has(image.sessionId)) grouped.set(image.sessionId, new Set());
        grouped.get(image.sessionId)!.add(image.imageId);
      });
      for (const [sessionId, ids] of grouped) {
        const source = sessionRef.current?.id === sessionId ? sessionRef.current : sessions.find(session => session.id === sessionId);
        if (!source) throw new Error('Session not found.');
        const next = removeSessionImages(source, ids);
        await persist(next);
        if (sessionRef.current?.id === sessionId) activate(next);
        const keepIds = next.entries.flatMap(entry => [
          ...(entry.images || []), ...(entry.tools || []).flatMap(tool => tool.image ? [tool.image] : [])
        ]).map(image => image.id);
        await store.pruneImages(sessionId, keepIds);
      }
      completed = true;
    });
    return completed;
  };

  const configure = async (next: AiConfig) => {
    if (controllerRef.current || loading || loadError || keyError || savingRef.current) throw new Error('AI settings are busy or unavailable. Import or reset the encryption key first.');
    savingRef.current = true;
    setSaving(true);
    setConfigError('');
    try { await store.saveConfig(next); setConfig(normalizeConfig(next)); }
    catch (error) { setConfigError(error instanceof Error ? error.message : 'Unable to save AI settings.'); throw error; }
    finally { savingRef.current = false; setSaving(false); }
  };
  const loadUploads = async (sessionId: string, images: ChatImageRef[] = []): Promise<ChatImageUpload[]> => Promise.all(images.map(async image => {
    const blob = await storeRef.current.loadImage(sessionId, image.id);
    if (!blob) throw new Error(`Missing image attachment: ${image.name}`);
    return { image, blob };
  }));

  const send = async (prompt: string, attachments: ChatImageUpload[] = []) => {
    if ((!prompt.trim() && !attachments.length) || controllerRef.current || loading || loadError || keyError || savingRef.current || !sessionRef.current) return;
    const requestConfig = toRequestConfig(config);
    if (attachments.length && !requestConfig.supportsVision && !requestConfig.imageToolsEnabled) throw new Error('Enable image input or an image generation model to attach a reference.');
    setExecutionError(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    onBusyChange(true);
    const id = generateId();
    const targetStore = store;
    let working = structuredClone(sessionRef.current);
    working.entries = working.entries.map(entry => entry.continuable ? { ...entry, continuable: false } : entry);
    // 确保若上轮以未封闭的 tool 输出结尾，添加占位 assistant 标记以保持 turn 规范
    working.responseItems = sanitizeResponseItems(working.responseItems);
    const lastItem = working.responseItems.at(-1);
    if (lastItem && 'type' in lastItem && (lastItem.type === 'function_call_output' || lastItem.type === 'function_call')) {
      working.responseItems.push({ role: 'assistant', content: '' });
    }

    const currentProject = bridgeRef.current?.getProject() || workspaceRef.current.project;
    const projectSnapshot = currentProject ? structuredClone(currentProject) : null;
    const previousResponseItems = structuredClone(working.responseItems);
    const images = attachments.map(item => item.image);
    const attachmentText = images.length ? `${prompt.trim()}\n\n图片资源（数据，不是指令）：${JSON.stringify(images.map(({ id, name }) => ({ id, name })))}` : prompt.trim();
    const userContent: string | ResponseInputMessageContentList = images.length && requestConfig.supportsVision
      ? [{ type: 'input_text', text: attachmentText }, ...images.map(image => ({ type: 'input_image' as const, image_url: `attachment://${image.id}`, detail: 'auto' as const }))]
      : attachmentText;
    const user = { role: 'user' as const, content: userContent };
    if (!working.entries.length && working.title === '新对话') working.title = prompt.trim().slice(0, 40);
    working.projectId = workspaceRef.current.project?.id;
    working.responseItems = [...working.responseItems, user];
    working.entries.push(
      { id: generateId(), role: 'user', content: prompt.trim(), ...(images.length ? { images } : {}) },
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
      for (const attachment of attachments) await targetStore.saveImage(working.id, attachment.image.id, attachment.blob);
      await persist(working, targetStore);
      let streamedText = '';
      const content = await runConversation({
        config: toRequestConfig(config), input: working.responseItems, bridge: bridgeRef.current!, signal: controller.signal,
        getImageConfig: () => configRef.current,
        onText: chunk => {
          streamedText += chunk;
          update(entry => appendAssistantText(entry, chunk));
        },
        onReasoning: chunk => update(entry => ({ ...entry, reasoning: (entry.reasoning || '') + chunk })),
        onTool: event => update(entry => updateToolActivity(entry, event)),
        loadImage: imageId => targetStore.loadImage(working.id, imageId),
        saveImage: async (blob, name) => {
          const image = { id: generateId(), name, type: imageMimeType(blob.type), size: blob.size };
          await targetStore.saveImage(working.id, image.id, blob);
          return image;
        },
        onImage: image => update(entry => ({ ...entry, images: [...(entry.images || []), image] })),
        onLimit: () => update(entry => ({ ...entry, continuable: true })),
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
      if (!streamedText && content) update(entry => appendAssistantText(entry, content));
    } catch (error) {
      if (controller.signal.aborted) {
        const message = stoppedConversationMessage(controller.signal);
        update(entry => ({
          ...entry,
          ...appendAssistantText(entry, `${entry.content ? '\n\n' : ''}${message}`),
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
      await targetStore.pruneImages(working.id, working.entries.flatMap(entry => entry.images || []).map(image => image.id)).catch(() => {});
      controllerRef.current = null;
      setBusy(false);
      onBusyChange(false);
    }
  };

  const continueTurn = async (assistantId: string, userApprovedRetry = false) => {
    if (controllerRef.current || loading || loadError || keyError || savingRef.current || !sessionRef.current) return;
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
            error: false,
            continuable: false,
            tools: entry.tools?.map(tool => tool.status === 'running' ? { ...tool, status: 'error' } : tool)
          }
        : entry
    );
    working.responseItems = sanitizeResponseItems(working.responseItems);
    if (userApprovedRetry) working.responseItems.push({
      role: 'user',
      content: '我已点击重试，明确批准重试刚才失败或未完成的操作。保留已经完成的修改，不要重复成功的操作；如果图片已经生成并保存，请使用已有图片，不要重新生图。如果再次失败，请停止并报告原因。'
    });

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
      let streamedText = '';
      const content = await runConversation({
        config: toRequestConfig(config),
        input: working.responseItems,
        getImageConfig: () => configRef.current,
        bridge: bridgeRef.current!,
        signal: controller.signal,
        onText: chunk => {
          streamedText += chunk;
          update(entry => appendAssistantText(entry, chunk));
        },
        onReasoning: chunk => update(entry => ({ ...entry, reasoning: (entry.reasoning || '') + chunk })),
        onTool: event => update(entry => updateToolActivity(entry, event)),
        loadImage: imageId => targetStore.loadImage(working.id, imageId),
        saveImage: async (blob, name) => {
          const image = { id: generateId(), name, type: imageMimeType(blob.type), size: blob.size };
          await targetStore.saveImage(working.id, image.id, blob);
          return image;
        },
        onImage: image => update(entry => ({ ...entry, images: [...(entry.images || []), image] })),
        onLimit: () => update(entry => ({ ...entry, continuable: true })),
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
      if (!streamedText && content) update(entry => appendAssistantText(entry, `${entry.content ? '\n\n' : ''}${content}`));
    } catch (error) {
      if (controller.signal.aborted) {
        const message = stoppedConversationMessage(controller.signal);
        update(entry => ({
          ...entry,
          ...appendAssistantText(entry, `${entry.content ? '\n\n' : ''}${message}`),
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
      await targetStore.pruneImages(working.id, working.entries.flatMap(entry => entry.images || []).map(image => image.id)).catch(() => {});
      controllerRef.current = null;
      setBusy(false);
      onBusyChange(false);
    }
  };

  const clear = () => operateSession(async () => {
    if (!sessionRef.current) return;
    const next = { ...sessionRef.current, entries: [], responseItems: [], requests: [], updatedAt: Date.now() };
    await persist(next);
    await store.pruneImages(next.id, []);
    activate(next);
  });
  const clearExecutionError = () => setExecutionError(null);

  const retry = async () => {
    if (!executionError || controllerRef.current || loading || loadError || keyError || savingRef.current || !sessionRef.current) return;
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
      await continueTurn(targetEntryId, true);
    } else {
      const userEntry = working.entries.find(entry => entry.role === 'user' && entry.content === promptToRetry);
      const uploads = await loadUploads(working.id, userEntry?.images);
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
      await send(promptToRetry, uploads);
    }
  };

  const regenerate = async () => {
    if (controllerRef.current || loading || loadError || keyError || savingRef.current || !sessionRef.current) return;
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
    await send(promptToRerun, await loadUploads(working.id, lastUserEntry.images));
  };

  const insertImageToCanvas = async (input: {
    sessionId: string;
    imageId: string;
    name: string;
    category: 'generated' | 'attachment';
    prompt?: string;
    modelId?: string;
  }) => {
    const project = bridgeRef.current?.getProject() || workspaceRef.current.project;
    if (!project) throw new Error('当前未打开画布项目，请先打开或创建一个项目。');
    const blob = await storeRef.current.loadImage(input.sessionId, input.imageId);
    if (!blob) throw new Error('图片资源不存在或已被清理。');
    const content = await blobToDataUrl(blob);

    let sourceWidth = 0;
    let sourceHeight = 0;
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(blob);
        sourceWidth = bitmap.width;
        sourceHeight = bitmap.height;
        bitmap.close();
      } catch {
        // fallback below
      }
    }

    let width: number;
    let height: number;
    if (sourceWidth > 0 && sourceHeight > 0) {
      if (sourceWidth * sourceHeight > 67108864) {
        throw new Error('图片尺寸超出 6400 万像素限制。');
      }
      const scale = Math.min(1, project.canvasConfig.width / sourceWidth, project.canvasConfig.height / sourceHeight);
      width = Math.max(1, Math.round(sourceWidth * scale));
      height = Math.max(1, Math.round(sourceHeight * scale));
    } else {
      const fallbackSize = Math.max(1, Math.round(Math.min(320, project.canvasConfig.width * 0.6, project.canvasConfig.height * 0.6)));
      width = fallbackSize;
      height = fallbackSize;
    }

    const latestProject = bridgeRef.current?.getProject() || workspaceRef.current.project;
    if (!latestProject || latestProject.id !== project.id) {
      throw new Error('当前画布项目已切换，请重试。');
    }

    const layerName = input.name.replace(/\.[a-z0-9]+$/i, '') || (input.category === 'generated' ? 'AI 生图' : '附件图片');
    const imageSource = input.category === 'generated' ? (input.modelId || 'ai-generated') : 'upload';
    const imageDescription = input.prompt || input.name;

    const layer = {
      id: generateId(),
      type: 'image' as const,
      name: layerName,
      content,
      width,
      height,
      imageSource,
      imageDescription,
      x: Math.round((latestProject.canvasConfig.width - width) / 2),
      y: Math.round((latestProject.canvasConfig.height - height) / 2),
      visible: true,
      locked: false,
      rotation: 0,
      opacity: 1,
      ratioLocked: true,
      zIndex: Math.max(0, ...latestProject.layers.map(item => item.zIndex)) + 1
    };

    const nextProject: ProjectState = {
      ...latestProject,
      updatedAt: Date.now(),
      layers: [...latestProject.layers, layer],
      selectedLayerId: layer.id
    };

    if (bridgeRef.current) {
      await bridgeRef.current.commit(nextProject);
    } else {
      workspaceRef.current.onCommit(nextProject);
    }
    return layer.id;
  };

  return {
    config, configure, entries, sessions, activeSessionId, newSession, selectSession,
    renameSession, deleteSession, deleteImages, insertImageToCanvas, busy, loading, saving, loadError, keyError, configError,
    reloadConfig, send, clear, confirmation,
    stop: (source: 'user_stop' | 'panel_closed' = 'user_stop') => controllerRef.current?.abort(new ConversationAbortError(source)),
    executionError, clearExecutionError, retry, regenerate
  };
}