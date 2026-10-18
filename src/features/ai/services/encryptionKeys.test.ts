import { expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { createKeyBackup, generateEncryptionKey, readKeyBackup } from './encryptionKeys.ts';
import { AI_DATABASE_NAME, ConfigDecryptionError, decryptEndpointKeys, encryptEndpointKeys, loadStoredConfig, readEncryptionKey, replaceEncryptionKey, saveStoredConfig, verifyStoredEncryptionKey } from './configStore.ts';
import { defaultConfig } from './config.ts';
import { createBrowserChatStore, createFileChatStore, type ChatFileAccess } from './chatStore.ts';

it('backs up once with a password and imports an equivalent nonextractable key', async () => {
  const { key, bytes } = await generateEncryptionKey();
  expect(key.extractable).toBe(false);
  const backup = await createKeyBackup(bytes, 'correct horse battery staple');
  expect(backup).not.toContain(btoa(String.fromCharCode(...bytes)));
  bytes.fill(0);
  const restored = await readKeyBackup(backup, 'correct horse battery staple');
  expect(restored.extractable).toBe(false);
  await expect(crypto.subtle.exportKey('raw', restored)).rejects.toThrow();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('api-secret'));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, restored, encrypted);
  expect(new TextDecoder().decode(plain)).toBe('api-secret');
  await expect(readKeyBackup(backup, 'incorrect password')).rejects.toThrow(/password/);
  const tampered = JSON.parse(backup);
  tampered.ciphertext = btoa('a'.repeat(48));
  await expect(readKeyBackup(JSON.stringify(tampered), 'correct horse battery staple')).rejects.toThrow();
  await expect(readKeyBackup(JSON.stringify({ ...tampered, iterations: 1 }), 'password')).rejects.toThrow(/Unsupported/);
  await expect(createKeyBackup(new Uint8Array(32), 'short')).rejects.toThrow(/12/);
});

it('requires explicit creation, preserves local credentials on import and clears them on reset', async () => {
  expect(await readEncryptionKey()).toBeUndefined();
  const config = defaultConfig();
  config.endpoints[0].apiKey = 'original-api-key';
  await expect(saveStoredConfig(config)).rejects.toThrow(/Create or import/);
  const original = await generateEncryptionKey();
  await replaceEncryptionKey(original.key, true);
  await saveStoredConfig(config);
  const secrets = await encryptEndpointKeys(config);
  const replacement = await generateEncryptionKey();
  await expect(replaceEncryptionKey(replacement.key, false, true)).rejects.toThrow(/already exists/);
  expect((await loadStoredConfig())?.endpoints[0].apiKey).toBe('original-api-key');
  await expect(verifyStoredEncryptionKey(replacement.key)).rejects.toThrow(/does not match/);
  expect((await loadStoredConfig())?.endpoints[0].apiKey).toBe('original-api-key');
  await replaceEncryptionKey(replacement.key, false);
  expect((await loadStoredConfig())?.endpoints[0].apiKey).toBe('original-api-key');
  await expect(decryptEndpointKeys(config, secrets)).rejects.toBeInstanceOf(ConfigDecryptionError);
  expect((await decryptEndpointKeys(config, secrets, original.key)).endpoints[0].apiKey).toBe('original-api-key');
  await replaceEncryptionKey(original.key, true);
  expect((await loadStoredConfig())?.endpoints[0].apiKey).toBe('');
  original.bytes.fill(0);
  replacement.bytes.fill(0);
});

it('recovers a shared folder with the original key, rejects wrong imports and resets only credentials', async () => {
  const text = new Map<string, string>();
  const files: ChatFileAccess = {
    read: async path => text.get(path) ?? null, write: async (path, value) => { text.set(path, value); },
    readBinary: async () => null, writeBinary: async () => {}, remove: async () => {}, removeDirectory: async () => {}, list: async () => []
  };
  const store = createFileChatStore(files, 'shared-folder');
  const original = await generateEncryptionKey();
  await replaceEncryptionKey(original.key, true);
  const backup = await createKeyBackup(original.bytes, 'shared folder password');
  original.bytes.fill(0);
  const config = defaultConfig();
  config.endpoints[0].apiKey = 'shared-api-key';
  config.systemPrompt = 'Keep this prompt';
  await store.saveConfig(config);
  text.set('chat/sessions/kept.json', 'untouched');
  const ciphertext = text.get('chat/config.json');
  const other = await generateEncryptionKey();
  await replaceEncryptionKey(other.key, true);
  expect(await store.encryption!.status()).toBe('locked');
  await expect(store.saveConfig({ ...config, endpoints: config.endpoints.map(endpoint => ({ ...endpoint, apiKey: '' })) })).rejects.toBeInstanceOf(ConfigDecryptionError);
  await expect(store.encryption!.import(other.key)).rejects.toBeInstanceOf(ConfigDecryptionError);
  expect(text.get('chat/config.json')).toBe(ciphertext);
  await store.encryption!.import(await readKeyBackup(backup, 'shared folder password'));
  expect(await store.encryption!.status()).toBe('ready');
  expect((await store.loadConfig()).endpoints[0].apiKey).toBe('shared-api-key');
  await expect(store.encryption!.generate('create')).rejects.toThrow(/status changed/);
  const rotated = await store.encryption!.generate('rotate');
  const rotatedKey = await crypto.subtle.importKey('raw', rotated, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const afterRotation = JSON.parse(text.get('chat/config.json')!);
  expect((await store.loadConfig()).endpoints[0].apiKey).toBe('shared-api-key');
  expect(text.get('chat/config.json')).not.toBe(ciphertext);
  const encrypted = afterRotation.secrets.map((secret: { endpointId: string; iv: string; ciphertext: string }) => ({
    endpointId: secret.endpointId, iv: Uint8Array.from(atob(secret.iv), value => value.charCodeAt(0)).buffer,
    ciphertext: Uint8Array.from(atob(secret.ciphertext), value => value.charCodeAt(0)).buffer
  }));
  expect((await decryptEndpointKeys(config, encrypted, rotatedKey)).endpoints[0].apiKey).toBe('shared-api-key');
  await expect(decryptEndpointKeys(config, encrypted, await readKeyBackup(backup, 'shared folder password'))).rejects.toBeInstanceOf(ConfigDecryptionError);
  rotated.fill(0);
  await replaceEncryptionKey(other.key, true);
  const replacement = await store.encryption!.generate('reset');
  replacement.fill(0);
  expect((await store.loadConfig()).endpoints[0].apiKey).toBe('');
  expect((await store.loadConfig()).systemPrompt).toBe('Keep this prompt');
  expect(text.get('chat/sessions/kept.json')).toBe('untouched');
  other.bytes.fill(0);
});

it('rotates an available browser key without losing credentials or other settings', async () => {
  const store = createBrowserChatStore();
  const config = defaultConfig();
  config.endpoints[0].apiKey = 'keep-browser-api-key';
  config.systemPrompt = 'Keep browser settings';
  await store.saveConfig(config);
  await expect(store.encryption!.generate('reset')).rejects.toThrow(/status changed/);
  const bytes = await store.encryption!.generate('rotate');
  expect((await store.loadConfig()).endpoints[0].apiKey).toBe('keep-browser-api-key');
  expect((await store.loadConfig()).systemPrompt).toBe('Keep browser settings');
  const restored = await readKeyBackup(await createKeyBackup(bytes, 'rotated browser password'), 'rotated browser password');
  await verifyStoredEncryptionKey(restored);
  bytes.fill(0);
});

it('keeps the old key and ciphertext when a file rotation cannot be saved', async () => {
  const text = new Map<string, string>();
  let failWrite = false;
  const files: ChatFileAccess = {
    read: async path => text.get(path) ?? null,
    write: async (path, value) => { if (failWrite) throw new Error('Disk full'); text.set(path, value); },
    readBinary: async () => null, writeBinary: async () => {}, remove: async () => {}, removeDirectory: async () => {}, list: async () => []
  };
  const store = createFileChatStore(files, 'rotation-write-failure');
  const config = defaultConfig();
  config.endpoints[0].apiKey = 'keep-file-api-key';
  await store.saveConfig(config);
  const original = text.get('chat/config.json');
  failWrite = true;
  await expect(store.encryption!.generate('rotate')).rejects.toThrow('Disk full');
  expect(text.get('chat/config.json')).toBe(original);
  expect((await store.loadConfig()).endpoints[0].apiKey).toBe('keep-file-api-key');
});

it('restores file ciphertext if preserving local credentials prevents the key replacement', async () => {
  const text = new Map<string, string>();
  const files: ChatFileAccess = {
    read: async path => text.get(path) ?? null, write: async (path, value) => { text.set(path, value); },
    readBinary: async () => null, writeBinary: async () => {}, remove: async () => {}, removeDirectory: async () => {}, list: async () => []
  };
  const store = createFileChatStore(files, 'rotation-commit-failure');
  const config = defaultConfig();
  config.endpoints[0].apiKey = 'preserve-on-commit-failure';
  await saveStoredConfig(config);
  await store.saveConfig(config);
  const original = text.get('chat/config.json');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(AI_DATABASE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const secret = await new Promise<{ endpointId: string; iv: ArrayBuffer; ciphertext: ArrayBuffer }>((resolve, reject) => {
    const request = db.transaction('endpoint-secrets', 'readonly').objectStore('endpoint-secrets').get(config.endpoints[0].id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const writeSecret = (ciphertext: ArrayBuffer) => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('endpoint-secrets', 'readwrite');
    transaction.objectStore('endpoint-secrets').put({ ...secret, ciphertext });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  try {
    await writeSecret(new ArrayBuffer(16));
    await expect(store.encryption!.generate('rotate')).rejects.toThrow();
    expect(text.get('chat/config.json')).toBe(original);
    expect((await store.loadConfig()).endpoints[0].apiKey).toBe('preserve-on-commit-failure');
  } finally { await writeSecret(secret.ciphertext); db.close(); }
});