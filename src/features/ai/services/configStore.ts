import { createAiConfigStore } from 'sang-ai-kit/config-store';
import type { ChatSession } from '../types.ts';

export { ConfigDecryptionError } from 'sang-ai-kit/config-store';
export type { EncryptedSecret } from 'sang-ai-kit/config-store';
export const AI_DATABASE_NAME = 'coverflow-ai';
const shared = createAiConfigStore<ChatSession>(AI_DATABASE_NAME);
export const { readEncryptionKey, saveStoredConfig, listStoredSessions, validateSession, saveStoredSession,
  saveStoredImage, loadStoredImage, pruneStoredImages, deleteStoredSession, encryptEndpointKeys, decryptEndpointKeys,
  replaceEncryptionKey, verifyStoredEncryptionKey, loadStoredUiState, saveStoredUiState } = shared;

export async function loadStoredConfig() {
  try {
    return await shared.loadStoredConfig();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'AI settings are missing but encrypted keys remain.') throw error;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(AI_DATABASE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('AI storage is blocked.'));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(['settings', 'encryption-key', 'endpoint-secrets'], 'readwrite');
        const settings = transaction.objectStore('settings');
        const secrets = transaction.objectStore('endpoint-secrets');
        const configRequest = settings.get('config');
        const keyRequest = transaction.objectStore('encryption-key').get('master');
        const secretsRequest = secrets.getAll();
        secretsRequest.onsuccess = () => {
          if (!configRequest.result && secretsRequest.result.length) {
            settings.put({ orphanedSecrets: true, key: keyRequest.result, secrets: secretsRequest.result }, `orphaned-secrets:${crypto.randomUUID()}`);
            secrets.clear();
          }
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Unable to preserve orphaned AI keys.'));
        transaction.onabort = () => reject(transaction.error || new Error('Unable to preserve orphaned AI keys.'));
      });
    } finally {
      database.close();
    }
    return shared.loadStoredConfig();
  }
}