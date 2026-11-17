import EncryptionKeySettingsView from 'sang-ai-kit/encryption-settings';
import { createKeyBackup, readKeyBackup, type EncryptionManager, type EncryptionStatus } from '../services/encryptionKeys.ts';
import { ConfigDecryptionError } from '../services/configStore.ts';

interface Props {
  manager: EncryptionManager;
  english: boolean;
  onStatus: (status: EncryptionStatus) => void;
  onChanged: () => Promise<void>;
  onBusy: (busy: boolean) => void;
  onBackupPending: (pending: boolean) => void;
}

async function saveBackup(content: string, isActive: () => boolean): Promise<boolean> {
  const { isTauri } = await import('@tauri-apps/api/core');
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: 'coverflow-encryption-key.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!path || !isActive()) return false;
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, content);
  } else {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'coverflow-encryption-key.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return true;
}

export default function EncryptionKeySettings(props: Props) {
  return <EncryptionKeySettingsView {...props} createKeyBackup={createKeyBackup} readKeyBackup={readKeyBackup}
    saveBackup={saveBackup} isDecryptionError={error => error instanceof ConfigDecryptionError} />;
}