// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useAiAssistant } from './useAiAssistant.ts';
import { ConversationAbortError, runConversation } from '../services/conversation.ts';
import { defaultConfig, toRequestConfig } from '../services/config.ts';
import type { ChatStore } from '../services/chatStore.ts';
import type { WorkspaceOptions } from '../services/workspace.ts';
import type { StorageAdapter } from '../../../storage/StorageAdapter.ts';
import type { ChatSession } from '../types.ts';
import { ConfigDecryptionError } from '../services/configStore.ts';
import { useProjectHistory } from '../../../hooks/useProjectHistory.ts';
import { syncProjectPages } from '../../../storage/projectCompatibility.ts';
import type { ProjectState } from '../../../types.ts';

vi.mock('../services/conversation.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../services/conversation.ts')>(),
  runConversation: vi.fn()
}));

const roots = new Set<Root>();
const workspace: WorkspaceOptions = {
  project: null, selectedLayerIds: [], storage: {} as StorageAdapter, localProjects: [], activeLocalPath: null,
  onCommit: () => {}, onOpen: async () => {}, onUpsert: () => {}, onDelete: () => {}, onSearch: () => {}, saveLocal: async () => {}
};

function memoryStore(id = 'test'): ChatStore {
  return {
    id, loadConfig: async () => defaultConfig(), saveConfig: async () => {}, listSessions: async () => [],
    saveSession: vi.fn(async () => {}), saveImage: async () => {}, loadImage: async () => null,
    pruneImages: async () => {}, deleteSession: async () => {}, loadUiState: async () => ({}), saveUiState: async () => {}
  };
}

async function mount(store = memoryStore()) {
  let assistant: ReturnType<typeof useAiAssistant>;
  const onBusyChange = vi.fn();
  const root = createRoot(document.createElement('div'));
  roots.add(root);
  function Harness({ target }: { target: ChatStore }) {
    assistant = useAiAssistant(workspace, onBusyChange, target);
    return null;
  }
  const render = async (target = store) => { await act(async () => { root.render(<Harness target={target} />); }); };
  await render();
  return { getAssistant: () => assistant!, render, root, store };
}

function waitForAbort() {
  let signal: AbortSignal;
  vi.mocked(runConversation).mockImplementation(async options => {
    signal = options.signal;
    return new Promise<string>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  return () => signal!;
}

async function mountEditor(store = memoryStore(), saveProject = async (_project: ProjectState) => {}) {
  const initial = syncProjectPages({ id: 'editor', title: 'Before AI', layers: [], selectedLayerId: null, updatedAt: 1, pageInfo: { ...({ width: 100, height: 100 }), background: { type: 'color', value: '#fff', overlayType: 'none', overlayColor: '#fff', overlayOpacity: 0, overlayScale: 20 } } });
  let state: { assistant: ReturnType<typeof useAiAssistant>; history: ReturnType<typeof useProjectHistory>; project: ProjectState | null };
  function Harness() {
    const [project, setProject] = useState<ProjectState | null>(initial);
    const history = useProjectHistory(project, setProject);
    const assistant = useAiAssistant({ ...workspace, project, aiHistory: history.aiHistory,
      storage: { ...workspace.storage, ensureReady: async () => true, saveProject },
      onCommit: history.aiHistory.commit }, () => {}, store);
    state = { assistant, history, project };
    return null;
  }
  const root = createRoot(document.createElement('div'));
  roots.add(root);
  await act(async () => root.render(<Harness />));
  return { getState: () => state!, store, root };
}

it('regenerates only from the immediate editor checkpoint and never persists project or duplicate response snapshots', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const starts: string[] = [];
  vi.mocked(runConversation).mockImplementation(async options => {
    const project = options.bridge.getProject()!;
    starts.push(project.title);
    await options.bridge.commit({ ...project, title: 'AI result' });
    options.onHistory?.([...options.input, { role: 'assistant', content: 'Done' }]);
    return 'Done';
  });
  const harness = await mountEditor();
  await act(async () => { await harness.getState().assistant.send('Change the title'); });
  expect(harness.getState().assistant.canRegenerate).toBe(true);
  const saved = vi.mocked(harness.store.saveSession).mock.calls.at(-1)![0];
  expect(JSON.stringify(saved)).not.toContain('projectSnapshot');
  expect(JSON.stringify(saved)).not.toContain('previousResponseItems');
  await act(async () => { await harness.getState().assistant.regenerate(); });
  expect(starts).toEqual(['Before AI', 'Before AI']);
  expect(harness.getState().assistant.entries).toHaveLength(2);
  expect(vi.mocked(runConversation).mock.calls[1][0].input).toHaveLength(1);
  expect(harness.getState().assistant.canRegenerate).toBe(true);
  await act(async () => harness.getState().history.modifyProject(current => ({ ...current, title: 'Manual edit' })));
  expect(harness.getState().assistant.canRegenerate).toBe(false);
  await act(async () => { await harness.getState().assistant.regenerate(); });
  expect(runConversation).toHaveBeenCalledTimes(2);
  expect(harness.getState().project!.title).toBe('Manual edit');
});

it('invalidates immediate chat redo on panel close, session switch and reload', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(runConversation).mockResolvedValue('Done');
  const harness = await mountEditor();
  await act(async () => { await harness.getState().assistant.send('First'); });
  expect(harness.getState().assistant.canRegenerate).toBe(true);
  await act(async () => harness.getState().assistant.stop('panel_closed'));
  expect(harness.getState().assistant.canRegenerate).toBe(false);
  await act(async () => { await harness.getState().assistant.send('Second'); });
  expect(harness.getState().assistant.canRegenerate).toBe(true);
  await act(async () => { await harness.getState().assistant.newSession(); });
  expect(harness.getState().assistant.canRegenerate).toBe(false);
  await act(async () => { await harness.getState().assistant.send('Third'); });
  expect(harness.getState().assistant.canRegenerate).toBe(true);
  await act(async () => { await harness.getState().assistant.reloadConfig(); });
  expect(harness.getState().assistant.canRegenerate).toBe(false);
});

it('does not rerun the model when restoring the immediate project cannot be saved', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(runConversation).mockImplementation(async options => {
    await options.bridge.commit({ ...options.bridge.getProject()!, title: 'AI result' });
    return 'Done';
  });
  let fail = false;
  const harness = await mountEditor(memoryStore(), async () => { if (fail) throw new Error('Disk full'); });
  await act(async () => { await harness.getState().assistant.send('First'); });
  expect(harness.getState().assistant.canRegenerate).toBe(true);
  fail = true;
  await act(async () => { await harness.getState().assistant.regenerate(); });
  expect(runConversation).toHaveBeenCalledOnce();
  expect(harness.getState().assistant.configError).toBe('Disk full');
  expect(harness.getState().assistant.canRegenerate).toBe(false);
  expect(harness.getState().assistant.entries).toHaveLength(2);
});

it('does not resurrect chat redo after a manual edit during an active AI turn', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  vi.mocked(runConversation).mockImplementation(async options => {
    await options.bridge.commit({ ...options.bridge.getProject()!, title: 'AI first step' });
    await gate;
    await options.bridge.commit({ ...options.bridge.getProject()!, title: 'AI last step' });
    return 'Done';
  });
  const harness = await mountEditor();
  let pending: Promise<void>;
  await act(async () => { pending = harness.getState().assistant.send('Edit'); });
  await act(async () => harness.getState().history.modifyProject(current => ({ ...current, title: 'Manual during AI' })));
  await act(async () => { resume(); await pending!; });
  expect(harness.getState().assistant.canRegenerate).toBe(false);
  await act(async () => harness.getState().history.handleUndo());
  expect(harness.getState().project!.title).toBe('Manual during AI');
});

afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount(); });
  roots.clear();
  vi.mocked(runConversation).mockReset();
  vi.unstubAllGlobals();
});

it('merges all queued messages and attachments into the next turn', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(runConversation).mockImplementationOnce(async () => { await gate; return 'First answer'; })
    .mockResolvedValue('Next answer');
  const store = memoryStore();
  const config = defaultConfig();
  config.endpoints[0].models[0].supportsVision = true;
  store.loadConfig = async () => config;
  store.saveImage = vi.fn(async () => {});
  const harness = await mount(store);
  const attachment = { image: { id: 'queued-image', name: 'image.webp', type: 'image/webp' as const, size: 3 }, blob: new Blob(['img']) };
  const secondAttachment = { image: { id: 'second-image', name: 'other.webp', type: 'image/webp' as const, size: 3 }, blob: new Blob(['img']) };
  let first!: Promise<void>;
  await act(async () => { first = harness.getAssistant().send('First'); });
  await act(async () => {
    await harness.getAssistant().send('Second', [attachment]);
    await harness.getAssistant().send('Third', [secondAttachment]);
  });
  expect(harness.getAssistant().queuedMessages.map(item => item.prompt)).toEqual(['Second', 'Third']);
  expect(runConversation).toHaveBeenCalledTimes(1);
  expect(vi.mocked(runConversation).mock.calls[0][0].shouldYield?.()).toBe(true);
  await act(async () => { release(); await first; });
  expect(runConversation).toHaveBeenCalledTimes(2);
  expect(harness.getAssistant().entries.filter(entry => entry.role === 'user').map(entry => entry.content)).toEqual(['First', 'Second\nThird']);
  expect(harness.getAssistant().entries.filter(entry => entry.role === 'user')[1].images?.map(image => image.id)).toEqual(['queued-image', 'second-image']);
  expect(store.saveImage).toHaveBeenCalledWith(expect.any(String), 'queued-image', attachment.blob);
  expect(store.saveImage).toHaveBeenCalledWith(expect.any(String), 'second-image', secondAttachment.blob);
  expect(harness.getAssistant().queuedMessages).toEqual([]);
  expect(harness.getAssistant().busy).toBe(false);
});

it('returns a reserved batch on stop while its attachments are being saved', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let releaseFirst!: () => void;
  let releaseImage!: () => void;
  let imageStarted!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const imageGate = new Promise<void>(resolve => { releaseImage = resolve; });
  const imageSaving = new Promise<void>(resolve => { imageStarted = resolve; });
  vi.mocked(runConversation).mockImplementationOnce(async () => { await firstGate; return 'Done'; });
  const store = memoryStore();
  const config = defaultConfig();
  config.endpoints[0].models[0].supportsVision = true;
  store.loadConfig = async () => config;
  store.saveImage = async () => { imageStarted(); await imageGate; };
  const harness = await mount(store);
  const attachment = { image: { id: 'queued-image', name: 'image.webp', type: 'image/webp' as const, size: 3 }, blob: new Blob(['img']) };
  let first!: Promise<void>;
  await act(async () => { first = harness.getAssistant().send('First'); });
  await act(async () => { await harness.getAssistant().send('One', [attachment]); await harness.getAssistant().send('Two'); releaseFirst(); await imageSaving; });
  let recovered: ReturnType<typeof harness.getAssistant>['queuedMessages'] = [];
  await act(async () => { recovered = harness.getAssistant().takeQueuedMessages(); harness.getAssistant().stop(); releaseImage(); await first; });
  expect(recovered.map(item => item.prompt)).toEqual(['One', 'Two']);
  expect(recovered[0].attachments).toEqual([attachment]);
  expect(harness.getAssistant().entries.filter(entry => entry.role === 'user').map(entry => entry.content)).toEqual(['First']);
  expect(runConversation).toHaveBeenCalledTimes(1);
});

it('preserves a batch when attachment storage fails and merges it with a later message', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(runConversation).mockImplementationOnce(async () => { await gate; return 'Done'; }).mockResolvedValue('Done');
  const store = memoryStore();
  const config = defaultConfig();
  config.endpoints[0].models[0].supportsVision = true;
  store.loadConfig = async () => config;
  store.saveImage = vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined);
  const harness = await mount(store);
  const attachment = { image: { id: 'queued-image', name: 'image.webp', type: 'image/webp' as const, size: 3 }, blob: new Blob(['img']) };
  let first!: Promise<void>;
  await act(async () => { first = harness.getAssistant().send('First'); });
  await act(async () => { await harness.getAssistant().send('One', [attachment]); await harness.getAssistant().send('Two'); release(); await first; });
  expect(harness.getAssistant().queuedMessages.map(item => item.prompt)).toEqual(['One', 'Two']);
  expect(harness.getAssistant().configError).toContain('Disk full');
  expect(runConversation).toHaveBeenCalledTimes(1);
  await act(async () => { await harness.getAssistant().send('Three'); });
  expect(harness.getAssistant().entries.filter(entry => entry.role === 'user').map(entry => entry.content)).toEqual(['First', 'One\nTwo\nThree']);
  expect(harness.getAssistant().queuedMessages).toEqual([]);
  expect(harness.getAssistant().configError).toBe('');
  expect(runConversation).toHaveBeenCalledTimes(2);
});

it('rolls back a reserved batch stopped while the session is being saved', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let releaseFirst!: () => void;
  let releaseSave!: () => void;
  let saveStarted!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  const saving = new Promise<void>(resolve => { saveStarted = resolve; });
  vi.mocked(runConversation).mockImplementationOnce(async () => { await firstGate; return 'Done'; });
  const store = memoryStore();
  const saved: ChatSession[] = [];
  store.saveSession = vi.fn(async session => {
    if (session.entries.some(entry => entry.role === 'user' && entry.content === 'One\nTwo')) { saveStarted(); await saveGate; }
    saved.push(structuredClone(session));
  });
  const harness = await mount(store);
  let first!: Promise<void>;
  await act(async () => { first = harness.getAssistant().send('First'); });
  await act(async () => { await harness.getAssistant().send('One'); await harness.getAssistant().send('Two'); releaseFirst(); await saving; });
  let recovered: ReturnType<typeof harness.getAssistant>['queuedMessages'] = [];
  await act(async () => { recovered = harness.getAssistant().takeQueuedMessages(); harness.getAssistant().stop(); releaseSave(); await first; });
  expect(recovered.map(item => item.prompt)).toEqual(['One', 'Two']);
  expect(saved.at(-1)?.entries.filter(entry => entry.role === 'user').map(entry => entry.content)).toEqual(['First']);
  expect(harness.getAssistant().entries.filter(entry => entry.role === 'user').map(entry => entry.content)).toEqual(['First']);
  expect(runConversation).toHaveBeenCalledTimes(1);
});

it('sends a merged queue with completed message history while the original stream remains open', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const { runConversation: realRunConversation } = await vi.importActual<typeof import('../services/conversation.ts')>('../services/conversation.ts');
  vi.mocked(runConversation).mockImplementation(realRunConversation);
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const requests: { input: Array<{ role?: string; content?: unknown }> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    if (requests.length === 1) return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; started(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
    const response = { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Next' }] }] };
    return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }));
  const harness = await mount();
  let first!: Promise<void>;
  await act(async () => { first = harness.getAssistant().send('First'); await ready; });
  await act(async () => { await harness.getAssistant().send('One'); await harness.getAssistant().send('Two'); });
  const message = { type: 'message', id: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Partial', annotations: [] }] };
  const events = [{ type: 'response.output_text.delta', delta: 'Partial' }, { type: 'response.output_item.done', output_index: 0, item: message }];
  await act(async () => { stream.enqueue(new TextEncoder().encode(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))); await first; });
  expect(requests).toHaveLength(2);
  expect(requests[1].input.map(item => item.role)).toEqual(['user', 'assistant', 'user']);
  expect(requests[1].input.at(-1)?.content).toBe('One\nTwo');
  expect(harness.getAssistant().entries.map(entry => entry.content)).toEqual(['First', 'Partial', 'One\nTwo', 'Next']);
  expect(harness.getAssistant().sessions[0].requests[0].status).toBe('aborted');
});

it('keeps queued messages after an error and resumes them only after a successful retry', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(runConversation).mockImplementationOnce(async () => { await gate; throw new Error('Connection failed'); })
    .mockResolvedValue('Done');
  const harness = await mount();
  let first!: Promise<void>;
  await act(async () => { first = harness.getAssistant().send('First'); });
  await act(async () => { await harness.getAssistant().send('Queued'); });
  await act(async () => { release(); await first; });
  expect(runConversation).toHaveBeenCalledTimes(1);
  expect(harness.getAssistant().queuedMessages.map(item => item.prompt)).toEqual(['Queued']);
  expect(harness.getAssistant().executionError?.message).toBe('Connection failed');
  await act(async () => { await harness.getAssistant().retry(); });
  expect(runConversation).toHaveBeenCalledTimes(3);
  expect(harness.getAssistant().queuedMessages).toEqual([]);
  expect(harness.getAssistant().entries.filter(entry => entry.role === 'user').map(entry => entry.content)).toEqual(['First', 'Queued']);
});

it('retains the queue on panel close, isolates sessions, and permits restoring or removing queued messages', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  waitForAbort();
  const sessions = new Map<string, ChatSession>();
  const store = memoryStore();
  store.saveSession = vi.fn(async session => { sessions.set(session.id, structuredClone(session)); });
  store.listSessions = async () => [...sessions.values()].map(session => structuredClone(session));
  const harness = await mount(store);
  const firstSession = harness.getAssistant().activeSessionId!;
  let first!: Promise<void>;
  await act(async () => { first = harness.getAssistant().send('First'); });
  await act(async () => {
    await harness.getAssistant().send('Keep');
    await harness.getAssistant().send('Remove');
    harness.getAssistant().stop('panel_closed');
    await first;
  });
  const removeId = harness.getAssistant().queuedMessages[1].id;
  await act(async () => { harness.getAssistant().removeQueuedMessage(removeId); await harness.getAssistant().newSession(); });
  expect(harness.getAssistant().queuedMessages).toEqual([]);
  await act(async () => { await harness.getAssistant().selectSession(firstSession); });
  expect(harness.getAssistant().queuedMessages.map(item => item.prompt)).toEqual(['Keep']);
  let restored: ReturnType<typeof harness.getAssistant>['queuedMessages'] = [];
  await act(async () => { restored = harness.getAssistant().takeQueuedMessages(); });
  expect(restored.map(item => item.prompt)).toEqual(['Keep']);
  expect(harness.getAssistant().queuedMessages).toEqual([]);
});

it('keeps queued messages scoped to their chat store when storage changes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  waitForAbort();
  const sessions = new Map<string, ChatSession>();
  const store = memoryStore('first-store');
  store.saveSession = vi.fn(async session => { sessions.set(session.id, structuredClone(session)); });
  store.listSessions = async () => [...sessions.values()].map(session => structuredClone(session));
  const harness = await mount(store);
  let first!: Promise<void>;
  await act(async () => { first = harness.getAssistant().send('First'); });
  await act(async () => { await harness.getAssistant().send('Queued'); });
  await harness.render(memoryStore('other-store'));
  await act(async () => { await first; });
  expect(harness.getAssistant().queuedMessages).toEqual([]);
  expect(runConversation).toHaveBeenCalledTimes(1);
  await harness.render(store);
  expect(harness.getAssistant().queuedMessages.map(item => item.prompt)).toEqual(['Queued']);
});

it('drains queued messages after continuing a failed tool turn', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(runConversation).mockImplementationOnce(async options => {
    options.onTool({ id: 'tool', name: 'read', arguments: '{}', status: 'error' });
    await gate;
    throw new Error('Interrupted');
  }).mockResolvedValue('Done');
  const harness = await mount();
  let first!: Promise<void>;
  await act(async () => { first = harness.getAssistant().send('First'); });
  await act(async () => { await harness.getAssistant().send('Queued'); });
  await act(async () => { release(); await first; });
  expect(harness.getAssistant().queuedMessages).toHaveLength(1);
  await act(async () => { await harness.getAssistant().retry(); });
  expect(runConversation).toHaveBeenCalledTimes(3);
  expect(harness.getAssistant().queuedMessages).toEqual([]);
  expect(harness.getAssistant().entries.filter(entry => entry.role === 'user').map(entry => entry.content)).toEqual(['First', 'Queued']);
});

it('preserves ordered reasoning, tool and text activity across a continued turn', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(runConversation).mockImplementationOnce(async options => {
    options.onReasoning?.('Plan', 'reason-1');
    options.onReasoning?.(' first', 'reason-1');
    options.onTool({ id: 'tool-1', name: 'read', arguments: '{}', status: 'running' });
    options.onTool({ id: 'tool-1', name: 'read', arguments: '{}', status: 'success' });
    options.onReasoning?.('Then', 'reason-2');
    options.onText('Answer');
    options.onHistory?.([...options.input, { role: 'assistant', content: 'Answer' }]);
    throw new Error('Interrupted');
  }).mockImplementationOnce(async options => {
    options.onReasoning?.('Continue', 'reason-3');
    options.onText(' done');
    return ' done';
  });
  const harness = await mount();
  await act(async () => { await harness.getAssistant().send('Question'); });
  const assistantEntry = harness.getAssistant().entries[1];
  expect(assistantEntry.activity).toEqual([
    { id: 'reason-1', type: 'reasoning', text: 'Plan first' },
    { id: 'tool-1', type: 'tool', toolId: 'tool-1' },
    { id: 'reason-2', type: 'reasoning', text: 'Then' },
    expect.objectContaining({ type: 'text', text: 'Answer' })
  ]);
  expect(assistantEntry).not.toHaveProperty('reasoning');
  await act(async () => { await harness.getAssistant().retry(); });
  const continued = harness.getAssistant().entries[1];
  expect(continued.activity?.slice(-2)).toEqual([
    { id: 'reason-3', type: 'reasoning', text: 'Continue' },
    expect.objectContaining({ type: 'text', text: ' done' })
  ]);
  expect(vi.mocked(harness.store.saveSession).mock.calls.at(-1)![0].entries[1].activity).toEqual(continued.activity);
});

it('orders activity by native response history instead of tool execution callbacks', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(runConversation).mockImplementation(async options => {
    options.onReasoning?.('Plan', 'rs-1');
    options.onText('Answer');
    options.onTool({ id: 'call-1', name: 'read', arguments: '{}', status: 'running' });
    options.onTool({ id: 'call-1', name: 'read', arguments: '{}', status: 'success' });
    options.onHistory?.([...options.input,
      { type: 'reasoning', id: 'rs-1', summary: [] },
      { type: 'function_call', call_id: 'call-1', name: 'read', arguments: '{}' },
      { type: 'message', id: 'msg-1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Answer', annotations: [] }] },
      { type: 'function_call_output', call_id: 'call-1', output: 'ok' }
    ]);
    return 'Answer';
  });
  const harness = await mount();
  await act(async () => { await harness.getAssistant().send('Question'); });
  expect(harness.getAssistant().entries[1].activity).toEqual([
    { id: 'rs-1', type: 'reasoning', text: 'Plan' },
    { id: 'call-1', type: 'tool', toolId: 'call-1' },
    { id: 'msg-1', type: 'text', text: 'Answer' }
  ]);
});

it('retries a reasoning-only failure without merging the next reasoning into the previous item', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(runConversation).mockImplementationOnce(async options => {
    options.onReasoning?.('First');
    throw new Error('Interrupted');
  }).mockImplementationOnce(async options => {
    options.onReasoning?.('Second');
    options.onText('Done');
    options.onHistory?.([...options.input, { type: 'reasoning', id: 'rs-2', summary: [] }, { role: 'assistant', content: 'Done' }]);
    return 'Done';
  });
  const harness = await mount();
  await act(async () => { await harness.getAssistant().send('Question'); });
  await act(async () => { await harness.getAssistant().retry(); });
  expect(harness.getAssistant().entries).toHaveLength(2);
  expect(harness.getAssistant().entries[1].activity).toEqual([
    expect.objectContaining({ type: 'reasoning', text: 'First' }),
    { id: 'rs-2', type: 'reasoning', text: 'Second' },
    expect.objectContaining({ type: 'text', text: 'Done' })
  ]);
});

it('does not duplicate a non-streamed limit message already in response history', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(runConversation).mockImplementation(async options => {
    options.onLimit?.();
    options.onHistory?.([...options.input, { role: 'assistant', content: 'Limit reached' }]);
    return 'Limit reached';
  });
  const harness = await mount();
  await act(async () => { await harness.getAssistant().send('Question'); });
  expect(harness.getAssistant().entries[1].content).toBe('Limit reached');
  expect(harness.getAssistant().entries[1].activity).toEqual([
    expect.objectContaining({ type: 'text', text: 'Limit reached' })
  ]);
});

it('keeps chat accessible when API keys cannot be decrypted without overwriting configuration', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const store = memoryStore();
  const config = defaultConfig();
  config.endpoints[0].apiKey = 'must-not-leak';
  store.loadConfig = async () => { throw new ConfigDecryptionError(config); };
  store.saveConfig = vi.fn();
  const harness = await mount(store);
  expect(harness.getAssistant().loadError).toBe('');
  expect(harness.getAssistant().keyError).toBe(true);
  expect(harness.getAssistant().config.endpoints[0].apiKey).toBe('');
  expect(harness.getAssistant().sessions).toHaveLength(1);
  expect(harness.getAssistant().sessions[0].id).toMatch(/^[0-9a-z]{9}$/);
  await act(async () => { await harness.getAssistant().newSession(); });
  expect(harness.getAssistant().sessions).toHaveLength(2);
  expect(harness.getAssistant().activeSessionId).toMatch(/^[0-9a-z]{9}$/);
  expect(store.saveConfig).not.toHaveBeenCalled();
  await act(async () => { await expect(harness.getAssistant().send('Do not send while locked')).rejects.toThrow('busy or unavailable'); });
  expect(runConversation).not.toHaveBeenCalled();
  await expect(harness.getAssistant().configure(config)).rejects.toThrow(/Import or reset/);
  store.loadConfig = async () => config;
  await act(async () => { await harness.getAssistant().reloadConfig(); });
  expect(harness.getAssistant().keyError).toBe(false);
  expect(harness.getAssistant().config.endpoints[0].apiKey).toBe('must-not-leak');
});

it('rejects new attachments for a text-only model even when image generation is enabled', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const store = memoryStore();
  const config = defaultConfig();
  config.endpoints[0].models.forEach(model => { model.supportsVision = false; });
  config.imageModels![0].enabled = true;
  config.imageModels![0].endpointId = config.endpoints[0].id;
  expect(toRequestConfig(config).imageToolsEnabled).toBe(true);
  const saveImage = vi.fn(async () => {});
  store.saveImage = saveImage;
  store.loadConfig = async () => config;
  const harness = await mount(store);
  const entries = harness.getAssistant().entries;
  await act(async () => {
    await expect(harness.getAssistant().send('Analyze', [{
      image: { id: 'upload', name: 'test.webp', type: 'image/webp', size: 10 },
      blob: new Blob(['image'], { type: 'image/webp' })
    }])).rejects.toThrow(/vision model/i);
  });
  expect(saveImage).not.toHaveBeenCalled();
  expect(runConversation).not.toHaveBeenCalled();
  expect(harness.getAssistant().entries).toEqual(entries);
});

it('deletes selected images and history references before pruning, preserving other assets', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const image = { id: 'preview', name: 'canvas-preview.webp', type: 'image/webp' as const, size: 100 };
  const keep = { ...image, id: 'generated', name: 'generated.png' };
  const history: ChatSession['responseItems'] = [
    { role: 'user', content: [{ type: 'input_image', image_url: 'attachment://preview', detail: 'auto' }, { type: 'input_text', text: 'Keep text' }] },
    { type: 'function_call_output', call_id: 'call', output: [{ type: 'input_image', image_url: 'attachment://preview' }] }
  ];
  const session: ChatSession = {
    id: 'session', title: 'Test', createdAt: 1, updatedAt: 2, requests: [], responseItems: history,
    entries: [{ id: 'entry', role: 'assistant', content: 'Kept', images: [image, keep], tools: [
      { id: 'tool', name: 'get_canvas_preview', arguments: '{}', status: 'success', image },
      { id: 'other', name: 'generate_image', arguments: '{}', status: 'success', image: keep }
    ] }]
  };
  const store = memoryStore();
  store.listSessions = async () => [structuredClone(session)];
  store.pruneImages = vi.fn(async () => {});
  const harness = await mount(store);
  await act(async () => { expect(await harness.getAssistant().deleteImages([{ sessionId: 'session', imageId: 'preview' }])).toBe(true); });
  const next = harness.getAssistant().sessions[0];
  expect(next.entries[0].images).toEqual([keep]);
  expect(next.entries[0].tools?.[0].image).toBeUndefined();
  expect(next.entries[0].tools?.[1].image).toEqual(keep);
  expect(JSON.stringify(next)).not.toContain('attachment://preview');
  expect(JSON.stringify(next.responseItems)).toContain('Keep text');
  expect(next.updatedAt).toBe(2);
  expect(harness.getAssistant().entries).toEqual(next.entries);
  expect(store.pruneImages).toHaveBeenCalledWith('session', ['generated', 'generated']);
  expect(vi.mocked(store.saveSession).mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(store.pruneImages).mock.invocationCallOrder[0]);
});

it.each(['user_stop', 'panel_closed'] as const)('records %s without confusing it with missing retry approval', async source => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const getSignal = waitForAbort();
  const harness = await mount();
  let pending: Promise<void>;
  await act(async () => { pending = harness.getAssistant().send('Generate'); });
  expect(getSignal().aborted).toBe(false);
  await act(async () => { harness.getAssistant().stop(source); await pending!; });
  expect(getSignal().reason).toBeInstanceOf(ConversationAbortError);
  expect(getSignal().reason.source).toBe(source);
  const content = harness.getAssistant().entries.at(-1)!.content;
  expect(content).toContain(source === 'user_stop' ? '已停止' : '面板已关闭');
  expect(content).not.toContain('approval');
  expect(harness.getAssistant().busy).toBe(false);
});

it('does not abort an active turn on an ordinary rerender', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const getSignal = waitForAbort();
  const harness = await mount();
  let pending: Promise<void>;
  await act(async () => { pending = harness.getAssistant().send('Generate'); });
  await harness.render();
  expect(getSignal().aborted).toBe(false);
  await act(async () => { harness.getAssistant().stop(); await pending!; });
});

it('distinguishes a real storage switch from assistant disposal', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const getSignal = waitForAbort();
  const harness = await mount();
  let pending: Promise<void>;
  await act(async () => { pending = harness.getAssistant().send('Generate'); });
  await harness.render(memoryStore('other-directory'));
  await act(async () => { await pending!; });
  expect(getSignal().reason.source).toBe('storage_changed');
  const saved = vi.mocked(harness.store.saveSession).mock.calls.at(-1)![0];
  expect(saved.entries.at(-1)!.content).toContain('存储位置已切换');
});

it('records disposal when an active assistant is unmounted', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const getSignal = waitForAbort();
  const harness = await mount();
  let pending: Promise<void>;
  await act(async () => { pending = harness.getAssistant().send('Generate'); });
  await act(async () => { harness.root.unmount(); roots.delete(harness.root); await pending!; });
  expect(getSignal().reason.source).toBe('assistant_disposed');
  const saved = vi.mocked(harness.store.saveSession).mock.calls.at(-1)![0];
  expect(saved.entries.at(-1)!.content).toContain('卸载或重新加载');
});

it('passes explicit user approval and a fresh signal when the retry button resumes progress', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(runConversation).mockImplementationOnce(async options => {
    options.onTool({ id: 'failed-tool', name: 'generate_image', arguments: '{}', status: 'error', result: '{"error":"Provider failed"}' });
    options.onHistory?.([...options.input, { type: 'function_call', call_id: 'failed-tool', name: 'generate_image', arguments: '{}' }, { type: 'function_call_output', call_id: 'failed-tool', output: '{"error":"Provider failed"}' }]);
    throw new Error('Response disconnected');
  }).mockResolvedValueOnce('Done');
  const harness = await mount();
  await act(async () => { await harness.getAssistant().send('Generate'); });
  expect(harness.getAssistant().executionError).not.toBeNull();
  await act(async () => { await harness.getAssistant().retry(); });
  const [first, second] = vi.mocked(runConversation).mock.calls.map(call => call[0]);
  expect(second.signal).not.toBe(first.signal);
  expect(second.signal.aborted).toBe(false);
  expect(second.input.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('明确批准重试') });
  expect(JSON.stringify(second.input)).toContain('Provider failed');
  expect(harness.getAssistant().executionError).toBeNull();
});