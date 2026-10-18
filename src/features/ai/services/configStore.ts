import type { AiConfig, ChatSession, ChatUiState } from '../types.ts';

export const AI_DATABASE_NAME = 'coverflow-ai';
const SETTINGS = 'settings';
const KEYS = 'encryption-key';
const SECRETS = 'endpoint-secrets';
const SESSIONS = 'sessions';
const IMAGES = 'images';
const UI = 'ui-state';
export interface EncryptedSecret { endpointId: string; iv: ArrayBuffer; ciphertext: ArrayBuffer }

const result = <Value>(request: IDBRequest<Value>) => new Promise<Value>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const done = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error || new Error('AI storage failed.'));
  transaction.onabort = () => reject(transaction.error || new Error('AI storage was aborted.'));
});

let databasePromise: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !crypto.subtle) { reject(new Error('IndexedDB and Web Crypto are required.')); return; }
    const request = indexedDB.open(AI_DATABASE_NAME, 4);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SETTINGS)) request.result.createObjectStore(SETTINGS);
      if (!request.result.objectStoreNames.contains(KEYS)) request.result.createObjectStore(KEYS);
      if (!request.result.objectStoreNames.contains(SECRETS)) request.result.createObjectStore(SECRETS, { keyPath: 'endpointId' });
      if (!request.result.objectStoreNames.contains(SESSIONS)) request.result.createObjectStore(SESSIONS, { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains(IMAGES)) request.result.createObjectStore(IMAGES, { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
      if (!request.result.objectStoreNames.contains(UI)) request.result.createObjectStore(UI);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); databasePromise = undefined; };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other CoverFlow tabs to upgrade AI storage.'));
  }).catch(error => { databasePromise = undefined; throw error; });
  return databasePromise;
}

async function encryptionKey(db: IDBDatabase): Promise<CryptoKey> {
  const read = db.transaction([KEYS, SECRETS], 'readonly');
  const complete = done(read);
  const [existing, secretCount] = await Promise.all([result(read.objectStore(KEYS).get('master')) as Promise<CryptoKey | undefined>, result(read.objectStore(SECRETS).count())]);
  await complete;
  if (existing) return existing;
  if (secretCount) throw new Error('Encryption key is missing. Existing API keys cannot be recovered.');
  const generated = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const write = db.transaction(KEYS, 'readwrite');
  const written = done(write);
  const request = write.objectStore(KEYS).get('master');
  let selected = generated;
  request.onsuccess = () => {
    if (request.result) selected = request.result as CryptoKey;
    else write.objectStore(KEYS).put(generated, 'master');
  };
  await written;
  return selected;
}

let pendingSave = Promise.resolve();
export function saveStoredConfig(config: AiConfig): Promise<void> {
  const snapshot = structuredClone(config);
  const operation = pendingSave.then(async () => {
    const db = await database();
    const key = await encryptionKey(db);
    const encrypted: EncryptedSecret[] = await Promise.all(snapshot.endpoints.filter(endpoint => endpoint.apiKey).map(async endpoint => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(endpoint.id) }, key, new TextEncoder().encode(endpoint.apiKey));
      return { endpointId: endpoint.id, iv: iv.buffer, ciphertext };
    }));
    const transaction = db.transaction([SETTINGS, SECRETS], 'readwrite');
    const committed = done(transaction);
    transaction.objectStore(SETTINGS).put({ ...snapshot, endpoints: snapshot.endpoints.map(endpoint => ({ ...endpoint, apiKey: '' })) }, 'config');
    const store = transaction.objectStore(SECRETS);
    store.clear();
    encrypted.forEach(secret => store.put(secret));
    await committed;
  });
  pendingSave = operation.catch(() => {});
  return operation;
}

export async function loadStoredConfig(): Promise<AiConfig | null> {
  await pendingSave;
  const db = await database();
  const transaction = db.transaction([SETTINGS, KEYS, SECRETS], 'readonly');
  const complete = done(transaction);
  const [config, key, secrets] = await Promise.all([
    result(transaction.objectStore(SETTINGS).get('config')) as Promise<AiConfig | undefined>,
    result(transaction.objectStore(KEYS).get('master')) as Promise<CryptoKey | undefined>,
    result(transaction.objectStore(SECRETS).getAll()) as Promise<EncryptedSecret[]>
  ]);
  await complete;
  if (!config) {
    if (secrets.length) throw new Error('AI settings are missing but encrypted keys remain.');
    return null;
  }
  if (secrets.length && !key) throw new Error('AI encryption key is missing.');
  const entries = await Promise.all(secrets.map(async secret => {
    try {
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: secret.iv, additionalData: new TextEncoder().encode(secret.endpointId) }, key!, secret.ciphertext);
      return [secret.endpointId, new TextDecoder().decode(plaintext)] as const;
    } catch { throw new Error('Unable to decrypt an AI API key. Stored data was not modified.'); }
  }));
  const keys = new Map(entries);
  return { ...config, endpoints: config.endpoints.map(endpoint => ({ ...endpoint, apiKey: keys.get(endpoint.id) || '' })) };
}

export async function listStoredSessions(): Promise<ChatSession[]> {
  const db = await database();
  const transaction = db.transaction(SESSIONS, 'readonly');
  const complete = done(transaction);
  const sessions = await result(transaction.objectStore(SESSIONS).getAll()) as ChatSession[];
  await complete;
  sessions.forEach(validateSession);
  return sessions.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function validateSession(session: ChatSession): void {
  if (!Array.isArray(session.entries) || !Array.isArray(session.responseItems) || !Array.isArray(session.requests)) throw new Error('Invalid chat session structure.');
}

export async function saveStoredSession(session: ChatSession): Promise<void> {
  validateSession(session);
  const db = await database();
  const transaction = db.transaction(SESSIONS, 'readwrite');
  const complete = done(transaction);
  transaction.objectStore(SESSIONS).put(structuredClone(session));
  await complete;
}

export async function saveStoredImage(sessionId: string, imageId: string, blob: Blob): Promise<void> {
  const db = await database();
  const transaction = db.transaction(IMAGES, 'readwrite');
  const complete = done(transaction);
  transaction.objectStore(IMAGES).put({ id: imageId, sessionId, blob });
  await complete;
}

export async function loadStoredImage(sessionId: string, imageId: string): Promise<Blob | null> {
  const db = await database();
  const transaction = db.transaction(IMAGES, 'readonly');
  const complete = done(transaction);
  const image = await result(transaction.objectStore(IMAGES).get(imageId)) as { sessionId: string; blob: Blob } | undefined;
  await complete;
  return image?.sessionId === sessionId ? image.blob : null;
}

export async function pruneStoredImages(sessionId: string, keepIds: string[]): Promise<void> {
  const db = await database();
  const transaction = db.transaction(IMAGES, 'readwrite');
  const complete = done(transaction);
  const request = transaction.objectStore(IMAGES).index('sessionId').openCursor(IDBKeyRange.only(sessionId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    if (!keepIds.includes(cursor.primaryKey as string)) cursor.delete();
    cursor.continue();
  };
  await complete;
}

export async function deleteStoredSession(id: string): Promise<void> {
  const db = await database();
  const transaction = db.transaction([SESSIONS, IMAGES], 'readwrite');
  const complete = done(transaction);
  transaction.objectStore(SESSIONS).delete(id);
  const request = transaction.objectStore(IMAGES).index('sessionId').openCursor(IDBKeyRange.only(id));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
  await complete;
}

export async function encryptEndpointKeys(config: AiConfig): Promise<EncryptedSecret[]> {
  const db = await database();
  const key = await encryptionKey(db);
  return Promise.all(config.endpoints.filter(endpoint => endpoint.apiKey).map(async endpoint => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(endpoint.id) }, key, new TextEncoder().encode(endpoint.apiKey));
    return { endpointId: endpoint.id, iv: iv.buffer, ciphertext };
  }));
}

export async function decryptEndpointKeys(config: AiConfig, secrets: EncryptedSecret[]): Promise<AiConfig> {
  if (!secrets.length) return { ...config, endpoints: config.endpoints.map(endpoint => ({ ...endpoint, apiKey: '' })) };
  const db = await database();
  const transaction = db.transaction(KEYS, 'readonly');
  const complete = done(transaction);
  const key = await result(transaction.objectStore(KEYS).get('master')) as CryptoKey | undefined;
  await complete;
  if (!key) throw new Error('This chat folder belongs to another browser or device. Its API keys cannot be decrypted.');
  const keys = new Map(await Promise.all(secrets.map(async secret => {
    try {
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: secret.iv, additionalData: new TextEncoder().encode(secret.endpointId) }, key, secret.ciphertext);
      return [secret.endpointId, new TextDecoder().decode(plaintext)] as const;
    } catch { throw new Error('Unable to decrypt this chat folder. Stored files were not modified.'); }
  })));
  return { ...config, endpoints: config.endpoints.map(endpoint => ({ ...endpoint, apiKey: keys.get(endpoint.id) || '' })) };
}

export async function loadStoredUiState(): Promise<ChatUiState> {
  const db = await database();
  const transaction = db.transaction(UI, 'readonly');
  const complete = done(transaction);
  const state = await result(transaction.objectStore(UI).get('state')) as ChatUiState | undefined;
  await complete;
  return state || {};
}

export async function saveStoredUiState(patch: Partial<ChatUiState>): Promise<void> {
  const db = await database();
  const transaction = db.transaction(UI, 'readwrite');
  const complete = done(transaction);
  const store = transaction.objectStore(UI);
  const request = store.get('state');
  request.onsuccess = () => store.put({ ...(request.result || {}), ...patch }, 'state');
  await complete;
}