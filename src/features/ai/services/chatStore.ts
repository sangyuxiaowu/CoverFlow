import type { AiConfig, ChatSession, ChatUiState } from '../types.ts';
import { defaultConfig, loadConfig, normalizeConfig, validateConfig } from './config.ts';
import { IMAGE_FORMATS, imageMimeType } from './imageAttachments.ts';
import { ConfigDecryptionError, decryptEndpointKeys, deleteStoredSession, encryptEndpointKeys, listStoredSessions, loadStoredImage, loadStoredUiState, pruneStoredImages, readEncryptionKey, replaceEncryptionKey, saveStoredConfig, saveStoredImage, saveStoredSession, saveStoredUiState, validateSession, verifyStoredEncryptionKey } from './configStore.ts';
import { generateEncryptionKey, type EncryptionManager } from './encryptionKeys.ts';

export interface ChatFileAccess {
  read: (relativePath: string) => Promise<string | null>;
  write: (relativePath: string, content: string) => Promise<void>;
  readBinary: (relativePath: string) => Promise<Blob | null>;
  writeBinary: (relativePath: string, content: Blob) => Promise<void>;
  remove: (relativePath: string) => Promise<void>;
  removeDirectory: (relativePath: string) => Promise<void>;
  list: (relativeDirectory: string) => Promise<string[]>;
}

export interface ChatStore {
  id: string;
  encryption?: EncryptionManager;
  loadConfig: () => Promise<AiConfig>;
  saveConfig: (config: AiConfig) => Promise<void>;
  listSessions: () => Promise<ChatSession[]>;
  saveSession: (session: ChatSession) => Promise<void>;
  saveImage: (sessionId: string, imageId: string, blob: Blob) => Promise<void>;
  loadImage: (sessionId: string, imageId: string) => Promise<Blob | null>;
  pruneImages: (sessionId: string, keepIds: string[]) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  loadUiState: () => Promise<ChatUiState>;
  saveUiState: (patch: Partial<ChatUiState>) => Promise<void>;
}

export function removeSessionImages(session: ChatSession, imageIds: Set<string>): ChatSession {
  const cleanHistory = (items: ChatSession['responseItems']) => items.map(item => {
    const cleanParts = (parts: unknown[]) => parts.map(part => {
      if (!part || typeof part !== 'object') return part;
      const image = part as { type?: string; image_url?: string };
      return image.type === 'input_image' && image.image_url?.startsWith('attachment://') && imageIds.has(image.image_url.slice('attachment://'.length))
        ? { type: 'input_text', text: '[Chat image deleted by user]' }
        : part;
    });
    return {
      ...item,
      ...('content' in item && Array.isArray(item.content) ? { content: cleanParts(item.content) } : {}),
      ...('type' in item && item.type === 'function_call_output' && Array.isArray(item.output) ? { output: cleanParts(item.output) } : {})
    } as typeof item;
  });
  return {
    ...session,
    entries: session.entries.map(entry => ({
      ...entry,
      images: entry.images?.filter(image => !imageIds.has(image.id)),
      tools: entry.tools?.map(tool => tool.image && imageIds.has(tool.image.id) ? { ...tool, image: undefined } : tool),
      previousResponseItems: entry.previousResponseItems ? cleanHistory(entry.previousResponseItems) : undefined
    })),
    responseItems: cleanHistory(session.responseItems)
  };
}

export function createBrowserChatStore(): ChatStore {
  const store: ChatStore = { id: 'indexeddb', loadConfig, saveConfig: async config => { validateConfig(config); await loadConfig(); await saveStoredConfig(config); }, listSessions: listStoredSessions, saveSession: saveStoredSession, saveImage: saveStoredImage, loadImage: loadStoredImage, pruneImages: pruneStoredImages, deleteSession: deleteStoredSession, loadUiState: loadStoredUiState, saveUiState: saveStoredUiState };
  store.encryption = encryptionManager(store, verifyStoredEncryptionKey, (key, preserve) => replaceEncryptionKey(key, !preserve));
  return store;
}

function encryptionManager(store: ChatStore, verify: (key: CryptoKey) => Promise<void>, regenerate: (key: CryptoKey, preserve: boolean) => Promise<void>): EncryptionManager {
  const status: EncryptionManager['status'] = async () => {
    try { await store.loadConfig(); }
    catch (error) { if (error instanceof ConfigDecryptionError) return 'locked'; throw error; }
    return await readEncryptionKey() ? 'ready' : 'missing';
  };
  return {
    status,
    generate: async mode => {
      const current = await status();
      if ((mode === 'create' && current !== 'missing') || (mode === 'rotate' && current !== 'ready') || (mode === 'reset' && current !== 'locked')) {
        throw new Error('Encryption key status changed. Reload settings before continuing.');
      }
      const generated = await generateEncryptionKey();
      try {
        if (mode === 'create') await replaceEncryptionKey(generated.key, false, true);
        else await regenerate(generated.key, mode === 'rotate');
        return generated.bytes;
      } catch (error) { generated.bytes.fill(0); throw error; }
    },
    import: async key => {
      if (key.extractable || key.algorithm.name !== 'AES-GCM' || (key.algorithm as AesKeyAlgorithm).length !== 256) throw new Error('Invalid encryption key.');
      await verify(key);
      await replaceEncryptionKey(key, false);
    }
  };
}

function sessionPath(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid session ID.');
  return `chat/sessions/${id}.json`;
}
function imageDirectory(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid session ID.');
  return `chat/images/${id}`;
}
function base64(buffer: ArrayBuffer): string { return btoa(String.fromCharCode(...new Uint8Array(buffer))); }
function buffer(encoded: string): ArrayBuffer { return Uint8Array.from(atob(encoded), character => character.charCodeAt(0)).buffer; }

export function createFileChatStore(files: ChatFileAccess, id: string): ChatStore {
  let pending = Promise.resolve();
  const enqueue = (operation: () => Promise<void>) => {
    const task = pending.then(operation);
    pending = task.catch(() => {});
    return task;
  };
  const readConfig = async () => {
    const raw = await files.read('chat/config.json');
    if (!raw) return null;
    const stored = JSON.parse(raw) as { version: number; config: AiConfig; secrets: { endpointId: string; iv: string; ciphertext: string }[] };
    if (stored.version !== 1 || !Array.isArray(stored.secrets)) throw new Error('Unsupported chat configuration file.');
    const config = normalizeConfig(stored.config);
    validateConfig(config);
    return { config, secrets: stored.secrets.map(secret => ({ endpointId: secret.endpointId, iv: buffer(secret.iv), ciphertext: buffer(secret.ciphertext) })) };
  };
  const store: ChatStore = {
    id,
    loadConfig: async () => {
      await pending;
      const stored = await readConfig();
      return stored ? decryptEndpointKeys(stored.config, stored.secrets) : defaultConfig();
    },
    saveConfig: config => {
      validateConfig(config);
      const snapshot = structuredClone(config);
      return enqueue(async () => {
        const current = await readConfig();
        if (current) await decryptEndpointKeys(current.config, current.secrets);
        const secrets = await encryptEndpointKeys(snapshot);
        const sanitized = { ...snapshot, endpoints: snapshot.endpoints.map(endpoint => ({ ...endpoint, apiKey: '' })) };
        await files.write('chat/config.json', JSON.stringify({ version: 1, config: sanitized, secrets: secrets.map(secret => ({ endpointId: secret.endpointId, iv: base64(secret.iv), ciphertext: base64(secret.ciphertext) })) }, null, 2));
      });
    },
    listSessions: async () => {
      await pending;
      const names = await files.list('chat/sessions');
      const sessions: ChatSession[] = [];
      for (const name of names.filter(name => /^[a-zA-Z0-9_-]+\.json$/.test(name))) {
        const raw = await files.read(`chat/sessions/${name}`);
        if (!raw) continue;
        const session = JSON.parse(raw) as ChatSession;
        if (sessionPath(session.id) !== `chat/sessions/${name}`) throw new Error('Invalid chat session file: ' + name);
        validateSession(session);
        sessions.push(session);
      }
      return sessions.sort((left, right) => right.updatedAt - left.updatedAt);
    },
    saveSession: session => {
      validateSession(session);
      const snapshot = structuredClone(session);
      const path = sessionPath(snapshot.id);
      return enqueue(() => files.write(path, JSON.stringify(snapshot, null, 2)));
    },
    saveImage: (sessionId, imageId, blob) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(imageId)) throw new Error('Invalid image ID.');
      const extension = IMAGE_FORMATS[imageMimeType(blob.type)];
      const prefix = `${imageDirectory(sessionId)}/${imageId}`;
      return enqueue(async () => {
        await files.writeBinary(`${prefix}.${extension}`, blob);
        for (const other of Object.values(IMAGE_FORMATS)) if (other !== extension) await files.remove(`${prefix}.${other}`);
      });
    },
    loadImage: async (sessionId, imageId) => {
      await pending;
      if (!/^[a-zA-Z0-9_-]+$/.test(imageId)) throw new Error('Invalid image ID.');
      const prefix = `${imageDirectory(sessionId)}/${imageId}`;
      for (const [type, extension] of Object.entries(IMAGE_FORMATS)) {
        const blob = await files.readBinary(`${prefix}.${extension}`);
        if (blob) return blob.slice(0, blob.size, type);
      }
      return null;
    },
    pruneImages: async (sessionId, keepIds) => {
      await enqueue(async () => {
        const keep = new Set(keepIds);
        for (const name of await files.list(imageDirectory(sessionId))) {
          const match = /^([a-zA-Z0-9_-]+)\.(png|jpg|webp)$/.exec(name);
          if (match && !keep.has(match[1])) await files.remove(`${imageDirectory(sessionId)}/${name}`);
        }
      });
    },
    deleteSession: sessionId => enqueue(async () => {
      await files.removeDirectory(imageDirectory(sessionId));
      await files.remove(sessionPath(sessionId));
    }),
    loadUiState: async () => { await pending; return JSON.parse(await files.read('chat/ui.json') || '{}') as ChatUiState; },
    saveUiState: patch => enqueue(async () => { const previous = JSON.parse(await files.read('chat/ui.json') || '{}'); await files.write('chat/ui.json', JSON.stringify({ ...previous, ...patch }, null, 2)); })
  };
  store.encryption = encryptionManager(store, async key => {
    await pending;
    const stored = await readConfig();
    if (stored) await decryptEndpointKeys(stored.config, stored.secrets, key);
  }, (key, preserve) => enqueue(async () => {
    const original = await files.read('chat/config.json');
    const stored = await readConfig();
    if (stored) {
      const config = preserve ? await decryptEndpointKeys(stored.config, stored.secrets) : stored.config;
      const secrets = preserve ? await encryptEndpointKeys(config, key) : [];
      await files.write('chat/config.json', JSON.stringify({ version: 1,
        config: { ...config, endpoints: config.endpoints.map(endpoint => ({ ...endpoint, apiKey: '' })) },
        secrets: secrets.map(secret => ({ endpointId: secret.endpointId, iv: base64(secret.iv), ciphertext: base64(secret.ciphertext) })) }, null, 2));
    }
    try { await replaceEncryptionKey(key, !preserve); }
    catch (error) {
      if (original !== null && stored) await files.write('chat/config.json', original);
      throw error;
    }
  }));
  return store;
}