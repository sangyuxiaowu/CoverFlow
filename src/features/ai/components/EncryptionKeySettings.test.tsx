// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import EncryptionKeySettings from './EncryptionKeySettings.tsx';
import type { EncryptionManager, EncryptionStatus } from '../services/encryptionKeys.ts';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: vi.fn() }));
vi.mock('../services/encryptionKeys.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../services/encryptionKeys.ts')>(),
  createKeyBackup: vi.fn(async () => '{"encrypted":true}')
}));

const roots: Root[] = [];
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach(root => root.unmount()); });
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function mount(status: EncryptionStatus) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const bytes = new Uint8Array(32).fill(42);
  const manager: EncryptionManager = { status: async () => status, generate: vi.fn(async () => bytes), import: vi.fn(async () => {}) };
  const onBackupPending = vi.fn();
  const onChanged = vi.fn(async () => {});
  const container = document.createElement('div');
  const root = createRoot(container);
  roots.push(root);
  await act(async () => { root.render(<EncryptionKeySettings manager={manager} english={false} onStatus={() => {}} onChanged={onChanged} onBusy={() => {}} onBackupPending={onBackupPending} />); });
  const find = (text: string) => [...container.querySelectorAll('button')].find(button => button.textContent === text)!;
  const click = async (text: string) => { await act(async () => { find(text).click(); }); };
  const check = async () => { await act(async () => { container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click(); }); };
  return { container, root, manager, bytes, onBackupPending, onChanged, find, click, check };
}

it('keeps the one-time backup available when native save is cancelled or fails', async () => {
  const view = await mount('missing');
  await view.click('创建新密钥');
  for (const id of ['ai-key-backup-password', 'ai-key-backup-confirm']) {
    await act(async () => {
      const field = view.container.querySelector<HTMLInputElement>(`#${id}`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'backup-password-2026');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  vi.mocked(save).mockResolvedValueOnce(null);
  await view.click('下载加密备份');
  expect(writeTextFile).not.toHaveBeenCalled();
  expect(view.find('下载加密备份')).toBeDefined();
  expect(view.bytes.some(byte => byte !== 0)).toBe(true);
  vi.mocked(save).mockResolvedValue('backup.json');
  vi.mocked(writeTextFile).mockRejectedValueOnce(new Error('Disk full'));
  await view.click('下载加密备份');
  expect(view.container.querySelector('[role=alert]')?.textContent).toBe('Disk full');
  expect(view.find('下载加密备份')).toBeDefined();
  vi.mocked(writeTextFile).mockResolvedValueOnce(undefined);
  await view.click('下载加密备份');
  expect(writeTextFile).toHaveBeenLastCalledWith('backup.json', '{"encrypted":true}');
  await view.click('已保存备份，完成');
  expect(view.bytes.every(byte => byte === 0)).toBe(true);
});
