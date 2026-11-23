import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssistant, type AssistantRunner, type ImageUpload, type StartSessionOptions } from 'sang-ai-kit';
import { blobToDataUrl } from 'sang-ai-kit/image-attachments';
import type { ResponseInputMessageContentList } from 'openai/resources/responses/responses';
import type { ProjectState } from '../../../types.ts';
import { generateId } from '../../../utils/helpers.ts';
import type { AiConfig, ResponseItem } from '../types.ts';
import { defaultConfig, normalizeConfig, toRequestConfig } from '../services/config.ts';
import { ConfigDecryptionError } from '../services/configStore.ts';
import { createAssistantStorage } from '../services/assistantStorage.ts';
import type { ChatStore } from '../services/chatStore.ts';
import { ConversationAbortError, runConversation, sanitizeResponseItems, type ConversationAbortSource } from '../services/conversation.ts';
import { createWorkspaceBridge, type WorkspaceOptions } from '../services/workspace.ts';

interface Confirmation { message: string; resolve: (accepted: boolean) => void }

export function useAiAssistant(workspace: WorkspaceOptions, onBusyChange: (busy: boolean) => void, store: ChatStore, switching = false) {
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const storeRef = useRef(store);
  storeRef.current = store;
  const switchingRef = useRef(switching);
  switchingRef.current = switching;
  const [config, setConfig] = useState<AiConfig>(defaultConfig);
  const configRef = useRef(config);
  configRef.current = config;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [loadError, setLoadError] = useState('');
  const [keyError, setKeyError] = useState(false);
  const [configError, setConfigError] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const mounted = useRef(false);
  const retrying = useRef(false);
  const abortSource = useRef<ConversationAbortSource>('assistant_disposed');
  const checkpoint = useRef<{ token: symbol; sessionId: string; entryId: string; storeId: string } | null>(null);
  const bridgeRef = useRef<ReturnType<typeof createWorkspaceBridge> | null>(null);
  if (!bridgeRef.current) bridgeRef.current = createWorkspaceBridge(() => workspaceRef.current, (message, signal) => new Promise<boolean>((resolve, reject) => {
    const cancel = () => { setConfirmation(null); reject(signal.reason); };
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener('abort', cancel, { once: true });
    setConfirmation({ message, resolve: accepted => { signal.removeEventListener('abort', cancel); setConfirmation(null); resolve(accepted); } });
  }));
  const storage = useMemo(() => createAssistantStorage(store, () => workspaceRef.current.project?.id), [store]);

  const invalidateRegenerate = () => {
    checkpoint.current = null;
    workspaceRef.current.aiHistory?.clear();
  };
  const runner: AssistantRunner = async (entries, events) => {
    if (switchingRef.current) {
      abortSource.current = 'storage_changed';
      assistant.stop();
      events.signal.throwIfAborted();
    }
    abortSource.current = 'assistant_disposed';
    const requestConfig = toRequestConfig(configRef.current);
    const currentProject = bridgeRef.current!.getProject() || workspaceRef.current.project;
    storage.setProject(events.session.id, currentProject?.id);
    const token = workspaceRef.current.aiHistory?.begin(currentProject);
    const response = events.session.entries.at(-1);
    checkpoint.current = token && response
      ? { token, sessionId: events.session.id, entryId: response.id, storeId: store.id }
      : null;
    const controller = new AbortController();
    const abort = () => {
      const source = events.signal.reason;
      controller.abort(new ConversationAbortError(
        source === 'assistant_disposed' ? source : abortSource.current
      ));
    };
    if (events.signal.aborted) abort();
    else events.signal.addEventListener('abort', abort, { once: true });
    try {
      if (!events.history.every(item => item !== null && typeof item === 'object' && !Array.isArray(item))) {
        throw new Error('Invalid conversation history.');
      }
      const history = sanitizeResponseItems(events.history as ResponseItem[]);
      const last = history.at(-1);
      if (last && 'type' in last && (last.type === 'function_call_output' || last.type === 'function_call')) {
        history.push({ role: 'assistant', content: '' });
      }
      const newEntries = history.length ? entries.slice(-1) : entries;
      const input: ResponseItem[] = [...history, ...newEntries.map(entry => {
        const text = entry.sentContent ?? entry.content;
        if (entry.role !== 'user' || !entry.images?.length) return { role: entry.role, content: text };
        const imageText = `${text.trim()}\n\n<available_images>\n${entry.images.map(({ id, name }) => `- ID: ${id}, Name: ${name}`).join('\n')}\n</available_images>`;
        const content: ResponseInputMessageContentList = [
          { type: 'input_text', text: imageText },
          ...entry.images.map(image => ({ type: 'input_image' as const, image_url: `attachment://${image.id}`, detail: 'auto' as const }))
        ];
        return { role: 'user' as const, content };
      })];
      events.onHistory(input);
      let streamed = false;
      let limited = false;
      let limitHistory: ResponseItem[] | undefined;
      const content = await runConversation({
        config: requestConfig,
        input,
        bridge: bridgeRef.current!,
        signal: controller.signal,
        shouldYield: events.shouldYield,
        getImageConfig: () => configRef.current,
        onText: text => { streamed = true; events.onText(text); },
        onReasoning: events.onReasoning,
        onTool: events.onTool,
        onUsage: events.onUsage,
        onLimit: () => { limited = true; events.onLimit(); },
        onHistory: items => {
          if (limited) limitHistory = items;
          else events.onHistory(items);
        },
        loadImage: events.loadImage,
        saveImage: events.saveImage
      });
      if (!streamed && content) events.onText(content);
      if (limitHistory) events.onHistory(limitHistory);
    } finally {
      events.signal.removeEventListener('abort', abort);
      if (token) workspaceRef.current.aiHistory?.setRunning(token, false);
    }
  };
  const assistant = useAssistant(runner, storage, {
    messageQueue: true,
    interruptionMessage: source => {
      const messages: Record<string, string> = {
        user_stop: '已停止。',
        panel_closed: 'AI 助手面板已关闭，本轮执行已中止。',
        storage_changed: '聊天存储位置已切换，本轮执行已中止。',
        assistant_disposed: 'AI 助手已卸载或重新加载，本轮执行已中止。'
      };
      const reason = source === 'assistant_disposed' ? source : abortSource.current;
      return `${messages[reason] || messages.user_stop}已完成的操作保留，请检查当前项目。`;
    },
    beforeRegenerate: async ({ session, assistantEntry }) => {
      if (switchingRef.current) return false;
      if (retrying.current) return true;
      const redo = checkpoint.current;
      if (!redo || redo.storeId !== store.id || redo.sessionId !== session.id || redo.entryId !== assistantEntry.id ||
          !workspaceRef.current.aiHistory?.isValid(redo.token)) return false;
      const restored = workspaceRef.current.aiHistory.restore(redo.token);
      if (!restored) return false;
      checkpoint.current = null;
      await bridgeRef.current!.commit(restored);
      return true;
    }
  });

  const loadConfig = async () => {
    const target = store;
    setLoading(true);
    setLoadError('');
    setConfigError('');
    try {
      let locked = false;
      const next = await target.loadConfig().catch(error => {
        if (!(error instanceof ConfigDecryptionError)) throw error;
        locked = true;
        return error.config;
      });
      if (!mounted.current || storeRef.current !== target) return;
      setConfig(next);
      setKeyError(locked);
    } catch (error) {
      if (mounted.current && storeRef.current === target) setLoadError(error instanceof Error ? error.message : 'Unable to load AI settings.');
    } finally {
      if (mounted.current && storeRef.current === target) setLoading(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void loadConfig();
    return () => {
      mounted.current = false;
      invalidateRegenerate();
    };
  }, [store]);
  useEffect(() => {
    onBusyChange(assistant.busy);
    return () => onBusyChange(false);
  }, [assistant.busy, onBusyChange]);

  const configure = async (next: AiConfig) => {
    if (switching || assistant.busy || assistant.loading || assistant.saving || assistant.loadError || loading || loadError || keyError || savingRef.current) throw new Error('AI settings are busy or unavailable. Import or reset the encryption key first.');
    savingRef.current = true;
    setSaving(true);
    setConfigError('');
    try { await store.saveConfig(next); setConfig(normalizeConfig(next)); }
    catch (error) { setConfigError(error instanceof Error ? error.message : 'Unable to save AI settings.'); throw error; }
    finally { savingRef.current = false; setSaving(false); }
  };
  const send = async (prompt: string, attachments: ImageUpload[] = []) => {
    if (!prompt.trim() && !attachments.length) return;
    if (switching || loading || loadError || keyError || savingRef.current || assistant.loading || assistant.saving || assistant.loadError) throw new Error('AI settings are busy or unavailable.');
    if (attachments.length && !toRequestConfig(config).supportsVision) throw new Error('Select a vision model to attach images.');
    await assistant.send(prompt, attachments);
  };
  const canRegenerate = () => {
    const redo = checkpoint.current;
    return Boolean(redo && redo.storeId === store.id && redo.sessionId === assistant.activeSessionId &&
      redo.entryId === assistant.entries.at(-1)?.id && workspaceRef.current.aiHistory?.isValid(redo.token));
  };
  const newSession = async (options?: StartSessionOptions) => {
    if (switching || loading || loadError || savingRef.current || assistant.loading || assistant.saving || assistant.loadError) throw new Error('AI settings are busy or unavailable.');
    if (keyError && options?.initialPrompt && options.autoSend !== false) throw new Error('AI settings are busy or unavailable.');
    if (!assistant.busy) invalidateRegenerate();
    return assistant.newSession(options);
  };

  const insertImage = async (input: {
    sessionId: string;
    imageId: string;
    name: string;
    category: 'generated' | 'preview' | 'attachment';
    prompt?: string;
    modelId?: string;
  }) => {
    const project = bridgeRef.current?.getProject() || workspaceRef.current.project;
    if (!project) throw new Error('当前未打开画布项目，请先打开或创建一个项目。');
    const blob = await storeRef.current.loadImage(input.sessionId, input.imageId);
    if (!blob) throw new Error('图片资源不存在或已被清理。');
    const content = bridgeRef.current?.registerImage ? await bridgeRef.current.registerImage(blob) : await blobToDataUrl(blob);
    let sourceWidth = 0;
    let sourceHeight = 0;
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(blob);
        sourceWidth = bitmap.width;
        sourceHeight = bitmap.height;
        bitmap.close();
      } catch {
        // Fall back to the default size for unsupported image decoders.
      }
    }
    let width: number;
    let height: number;
    if (sourceWidth > 0 && sourceHeight > 0) {
      if (sourceWidth * sourceHeight > 67108864) throw new Error('图片尺寸超出 6400 万像素限制。');
      const scale = Math.min(1, project.pageInfo.width / sourceWidth, project.pageInfo.height / sourceHeight);
      width = Math.max(1, Math.round(sourceWidth * scale));
      height = Math.max(1, Math.round(sourceHeight * scale));
    } else {
      const fallbackSize = Math.max(1, Math.round(Math.min(320, project.pageInfo.width * 0.6, project.pageInfo.height * 0.6)));
      width = fallbackSize;
      height = fallbackSize;
    }
    const latestProject = bridgeRef.current?.getProject() || workspaceRef.current.project;
    if (!latestProject || latestProject.id !== project.id || latestProject.activePageId !== project.activePageId) throw new Error('当前画布项目或页面已切换，请重试。');
    const layer = {
      id: generateId(), type: 'image' as const,
      name: input.name.replace(/\.[a-z0-9]+$/i, '') || (input.category === 'generated' ? 'AI 生图' : '附件图片'),
      content, width, height,
      imageSource: input.category === 'generated' ? (input.modelId || 'ai-generated') : 'upload',
      imageDescription: input.prompt || input.name,
      x: Math.round((latestProject.pageInfo.width - width) / 2),
      y: Math.round((latestProject.pageInfo.height - height) / 2),
      visible: true, locked: false, rotation: 0, opacity: 1, ratioLocked: true,
      zIndex: Math.max(0, ...latestProject.layers.map(item => item.zIndex)) + 1
    };
    const nextProject: ProjectState = { ...latestProject, updatedAt: Date.now(), layers: [...latestProject.layers, layer], selectedLayerId: layer.id };
    await bridgeRef.current!.commit(nextProject);
    return layer.id;
  };

  return {
    ...assistant, config, configure, insertImage, send,
    loading: loading || assistant.loading,
    saving: switching || saving || assistant.saving,
    loadError: loadError || assistant.loadError,
    keyError,
    configError: configError || assistant.configError,
    confirmation,
    canRegenerate: Boolean(assistant.canRegenerate && !loading && !saving && !loadError && !keyError && canRegenerate()),
    newSession, startSession: newSession,
    selectSession: async id => {
      if (!assistant.busy && id !== assistant.activeSessionId) invalidateRegenerate();
      await assistant.selectSession(id);
    },
    reloadConfig: async () => { invalidateRegenerate(); await Promise.all([loadConfig(), assistant.reloadConfig()]); },
    retry: async () => {
      if (switching || loading || loadError || keyError || savingRef.current) return;
      retrying.current = true;
      try { await assistant.retry(); } finally { retrying.current = false; }
    },
    regenerate: async () => {
      if (switching || loading || loadError || keyError || savingRef.current || !canRegenerate()) return;
      await assistant.regenerate();
    },
    stop: (source: ConversationAbortSource = 'user_stop') => {
      if (source === 'panel_closed') invalidateRegenerate();
      abortSource.current = source;
      assistant.stop(source === 'panel_closed' ? source : 'user_stop');
    },
    flushForSwitch: async () => {
      if (!assistant.loadError) await assistant.flush();
    },
    switchPending: loading || saving || assistant.loading || assistant.saving
  };
}
