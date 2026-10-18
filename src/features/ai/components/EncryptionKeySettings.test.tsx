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

it('offers creation or import, requires explicit skip acknowledgement and erases one-time bytes', async () => {
  const view = await mount('missing');
  expect(view.container.textContent).toContain('尚未设置加密密钥');
  expect(view.find('导入已有密钥')).toBeDefined();
  await view.click('创建新密钥');
  expect(view.manager.generate).toHaveBeenCalledWith('create');
  expect(view.onBackupPending).toHaveBeenLastCalledWith(true);
  expect(view.onChanged).toHaveBeenCalledOnce();
  expect(view.find('不下载，完成').disabled).toBe(true);
  await view.check();
  await view.click('不下载，完成');
  expect(view.bytes.every(byte => byte === 0)).toBe(true);
  expect(view.onBackupPending).toHaveBeenLastCalledWith(false);
  expect(view.container.textContent).toContain('无法再次下载');
  expect(view.find('下载加密备份')).toBeUndefined();
});

it('does not reset locked credentials until the user explicitly acknowledges data loss', async () => {
  const view = await mount('locked');
  expect(view.container.textContent).toContain('当前 API Key 无法解锁');
  await view.click('重新生成密钥');
  expect(view.find('清空 API Key 并重新生成').disabled).toBe(true);
  await view.click('取消');
  expect(view.manager.generate).not.toHaveBeenCalled();
  await view.click('重新生成密钥');
  await view.check();
  await view.click('清空 API Key 并重新生成');
  expect(view.manager.generate).toHaveBeenCalledWith('reset');
  expect(view.container.textContent).toContain('一次性备份');
  await act(async () => view.root.unmount());
  roots.splice(roots.indexOf(view.root), 1);
  expect(view.bytes.every(byte => byte === 0)).toBe(true);
});

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

it('offers nondestructive key rotation when the current key is available', async () => {
  const view = await mount('ready');
  await view.click('重新生成密钥');
  expect(view.container.textContent).toContain('更换加密密钥，保留 API Key');
  expect(view.container.textContent).toContain('无需重新填写');
  expect(view.find('清空 API Key 并重新生成')).toBeUndefined();
  expect(view.find('保留 API Key 并更换密钥').disabled).toBe(true);
  await view.check();
  await view.click('保留 API Key 并更换密钥');
  expect(view.manager.generate).toHaveBeenCalledWith('rotate');
  expect(view.onChanged).toHaveBeenCalledOnce();
  expect(view.container.textContent).toContain('一次性备份');
});