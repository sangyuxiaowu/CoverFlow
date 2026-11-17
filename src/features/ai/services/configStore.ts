import { createAiConfigStore } from 'sang-ai-kit/config-store';
import type { ChatSession } from '../types.ts';

export { ConfigDecryptionError } from 'sang-ai-kit/config-store';
export type { EncryptedSecret } from 'sang-ai-kit/config-store';
export const AI_DATABASE_NAME = 'coverflow-ai';
export const { readEncryptionKey, saveStoredConfig, loadStoredConfig, listStoredSessions, validateSession, saveStoredSession,
  saveStoredImage, loadStoredImage, pruneStoredImages, deleteStoredSession, encryptEndpointKeys, decryptEndpointKeys,
  replaceEncryptionKey, verifyStoredEncryptionKey, loadStoredUiState, saveStoredUiState } = createAiConfigStore<ChatSession>(AI_DATABASE_NAME);