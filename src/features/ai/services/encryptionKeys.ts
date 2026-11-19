import { createKeyBackupCodec } from 'sang-ai-kit/encryption';

export { generateEncryptionKey } from 'sang-ai-kit/encryption';
export type { EncryptionManager, EncryptionStatus } from 'sang-ai-kit';

export const { createKeyBackup, readKeyBackup } = createKeyBackupCodec({
  format: 'coverflow-encryption-key',
  context: 'CoverFlow encryption key backup v1'
});