import type { AssistantSession, AssistantStorage } from 'sang-ai-kit';
import type { ChatSession, ResponseItem } from '../types.ts';
import type { ChatStore } from './chatStore.ts';

export function createAssistantStorage(store: ChatStore, getProjectId: () => string | undefined): AssistantStorage & {
  setProject: (sessionId: string, projectId: string | undefined) => void;
} {
  const saved = new Map<string, ChatSession>();
  const projectIds = new Map<string, string | undefined>();
  const serialize = (session: AssistantSession): ChatSession => {
    const previous = saved.get(session.id);
    if (session.responseItems && !session.responseItems.every(item => item !== null && typeof item === 'object' && !Array.isArray(item))) {
      throw new Error('Invalid conversation history.');
    }
    return {
      ...previous,
      ...session,
      createdAt: previous?.createdAt ?? Date.now(),
      projectId: projectIds.has(session.id) ? projectIds.get(session.id) : previous?.projectId ?? getProjectId(),
      responseItems: (session.responseItems ?? []) as ResponseItem[]
    };
  };
  return {
    setProject: (sessionId, projectId) => { projectIds.set(sessionId, projectId); },
    async load() {
      const [sessions, ui] = await Promise.all([store.listSessions(), store.loadUiState()]);
      saved.clear();
      projectIds.clear();
      for (const session of sessions) saved.set(session.id, session);
      if (!sessions.length) return null;
      return { sessions, activeSessionId: sessions.some(session => session.id === ui.activeSessionId) ? ui.activeSessionId! : sessions[0].id };
    },
    async save(snapshot) {
      const next = new Set(snapshot.sessions.map(session => session.id));
      for (const session of snapshot.sessions) {
        const normalized = serialize(session);
        if (JSON.stringify(saved.get(session.id)) !== JSON.stringify(normalized)) {
          await store.saveSession(normalized);
          saved.set(session.id, normalized);
        }
      }
      for (const id of saved.keys()) {
        if (!next.has(id)) {
          await store.deleteSession(id);
          saved.delete(id);
          projectIds.delete(id);
        }
      }
      await store.saveUiState({ activeSessionId: snapshot.activeSessionId });
    },
    images: {
      saveImage: store.saveImage,
      loadImage: store.loadImage,
      deleteImages: store.deleteImages,
      deleteSessionImages: id => store.pruneImages(id, [])
    }
  };
}
