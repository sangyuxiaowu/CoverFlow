import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Download,
  FileKey2,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Upload,
  X
} from 'lucide-react';
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

export default function EncryptionKeySettings({ manager, english, onStatus, onChanged, onBusy, onBackupPending }: Props) {
  const [status, setStatus] = useState<EncryptionStatus | null>(null);
  const [mode, setMode] = useState<'idle' | 'import' | 'reset' | 'backup'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const backup = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const operation = useRef(false);
  const mounted = useRef(true);
  const label = (zh: string, en: string) => english ? en : zh;
  const errorMessage = (reason: unknown) => {
    if (reason instanceof ConfigDecryptionError) return label('此密钥与当前目录不匹配，原配置未修改。请选择正确的备份文件。', 'This key does not match this folder. Nothing was changed. Choose the correct backup.');
    if (reason instanceof SyntaxError) return label('备份文件格式错误，请选择生成时下载的密钥文件。', 'Invalid backup format. Choose the key file downloaded when it was created.');
    const message = reason instanceof Error ? reason.message : 'Key operation failed. Please retry.';
    const translations: Record<string, string> = {
      'Incorrect backup password or damaged key file.': '备份口令错误或密钥文件已损坏，原数据未修改。',
      'Unsupported encryption key backup.': '不支持此备份格式或版本，请选择 CoverFlow 密钥备份文件。',
      'Invalid encryption key backup.': '密钥备份文件无效，原数据未修改。',
      'This key does not match the encrypted API keys. Nothing was changed.': '此密钥与当前 API Key 不匹配，原数据未修改。',
      'Encryption key status changed. Reload settings before continuing.': '密钥状态已变化，请重新打开设置后继续。',
      'An encryption key already exists. Reload settings before continuing.': '其他页面已创建密钥，请重新打开设置后继续。'
    };
    return english ? message : translations[message] || message;
  };

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void manager.status().then(value => {
      if (!active) return;
      setStatus(value);
      onStatus(value);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to check encryption key.'); });
    return () => {
      active = false;
      mounted.current = false;
      backup.current?.fill(0);
      backup.current = null;
    };
  }, [manager]);

  const changeMode = (next: typeof mode) => {
    setMode(next);
    setError('');
    setNotice('');
    setPassword('');
    setConfirmation('');
    setFile(null);
    setAcknowledged(false);
  };

  const run = async (task: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    try { await task(); }
    catch (reason) {
      if (mounted.current) setError(errorMessage(reason));
    } finally {
      operation.current = false;
      if (mounted.current) { setBusy(false); onBusy(false); }
    }
  };

  const generate = (mode: Parameters<EncryptionManager['generate']>[0]) => run(async () => {
    const bytes = await manager.generate(mode);
    if (!mounted.current) { bytes.fill(0); return; }
    backup.current?.fill(0);
    backup.current = bytes;
    changeMode('backup');
    setDownloaded(false);
    setStatus('ready');
    onStatus('ready');
    onBackupPending(true);
    await onChanged();
  });

  const download = () => run(async () => {
    if (!backup.current) throw new Error('The one-time backup is no longer available.');
    if (password !== confirmation) throw new Error(label('两次输入的备份口令不一致。', 'Backup passwords do not match.'));
    const content = await createKeyBackup(backup.current, password);
    if (!mounted.current) return;
    const { isTauri } = await import('@tauri-apps/api/core');
    if (isTauri()) {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const path = await save({ defaultPath: 'coverflow-encryption-key.json', filters: [{ name: 'JSON', extensions: [{ name: 'JSON', extensions: ['json'] }].map(f => f.extensions[0]) }] });
      if (!path || !mounted.current) return;
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
    setDownloaded(true);
    setPassword('');
    setConfirmation('');
  });

  const finishBackup = () => {
    backup.current?.fill(0);
    backup.current = null;
    changeMode('idle');
    onBackupPending(false);
    setNotice(downloaded ? label('密钥已就绪。请将备份文件与口令分开妥善保管。', 'Key ready. Keep the backup file and its password safe and separate.')
      : label('已跳过备份。本机可正常使用，但以后无法再次下载此密钥。', 'Backup skipped. This client is ready, but this key cannot be downloaded later.'));
  };

  const importKey = () => run(async () => {
    if (!file || file.size > 4096) throw new Error(label('请选择有效的密钥备份文件（不超过 4 KB）。', 'Choose a valid key backup file (up to 4 KB).'));
    const key = await readKeyBackup(await file.text(), password);
    if (!mounted.current) return;
    await manager.import(key);
    if (!mounted.current) return;
    changeMode('idle');
    setStatus('ready');
    onStatus('ready');
    await onChanged();
    setNotice(label('密钥已导入，当前配置中的 API Key 已重新解锁。', 'Key imported. API keys in the current configuration are unlocked.'));
  });

  const protectedKey = status === 'ready';
  const StatusIcon = protectedKey ? ShieldCheck : status === 'locked' ? ShieldAlert : KeyRound;

  return (
    <section aria-label={label('密钥管理', 'Encryption Key Management')} className="space-y-6">
      {/* 旗舰状态卡片 */}
      <div
        role="status"
        className={`p-5 rounded-2xl border backdrop-blur-sm transition-all shadow-sm ${
          protectedKey
            ? 'border-emerald-500/30 bg-gradient-to-r from-emerald-950/20 via-slate-900/60 to-slate-900/80 shadow-emerald-950/10'
            : status === 'locked'
            ? 'border-rose-500/30 bg-gradient-to-r from-rose-950/20 via-slate-900/60 to-slate-900/80 shadow-rose-950/10'
            : 'border-amber-500/30 bg-gradient-to-r from-amber-950/20 via-slate-900/60 to-slate-900/80 shadow-amber-950/10'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0 flex-1">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border shadow-inner ${
                protectedKey
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                  : status === 'locked'
                  ? 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                  : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
              }`}
            >
              <StatusIcon size={20} />
            </div>
            <div className="min-w-0 space-y-1.5 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-bold text-white">
                  {!status
                    ? label('正在检查密钥...', 'Checking encryption key...')
                    : protectedKey
                    ? label('密钥正常 · 本机加密保护中', 'Key ready · Local encryption active')
                    : status === 'locked'
                    ? label('当前 API Key 无法解锁', 'API keys are locked')
                    : label('尚未设置加密密钥', 'No encryption key yet')}
                </p>
                {protectedKey && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                    AES-256-GCM
                  </span>
                )}
              </div>
              <p className="text-xs leading-relaxed text-slate-400">
                {protectedKey
                  ? label(
                      'API Key 使用 AES-256-GCM 加密。本机保存的主密钥不可导出；这不代表设备或页面能免受所有攻击。',
                      'API keys use AES-256-GCM. The locally stored master key is nonextractable; this does not protect against every device or page attack.'
                    )
                  : status === 'locked'
                  ? label(
                      '此目录可能由其他浏览器或桌面端创建。导入对应密钥即可恢复；没有备份时可重新生成，但必须重新填写 API Key。聊天与图片不受影响。',
                      'This folder may come from another browser or desktop client. Import its key to recover, or reset and re-enter your API keys. Chats and images are unaffected.'
                    )
                  : label(
                      '先创建新密钥，或导入已有备份。Web 与桌面端使用同一把密钥后，就能读取同一目录中的 API Key。',
                      'Create a key or import an existing backup. Web and desktop clients using the same key can unlock API keys in the shared folder.'
                    )}
              </p>
            </div>
          </div>
          {protectedKey && <LockKeyhole size={16} className="mt-1 shrink-0 text-emerald-400 hidden sm:block" />}
        </div>

        {mode === 'idle' && status && (
          <div className="flex flex-wrap items-center gap-2.5 pt-4 mt-4 border-t border-slate-800/80">
            {status === 'missing' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void generate('create')}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 text-xs font-semibold shadow-md shadow-blue-900/30 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={15} />
                {label('创建新密钥', 'Create Encryption Key')}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => changeMode('reset')}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-800 hover:bg-slate-750 text-slate-200 hover:text-white px-3.5 py-2 text-xs font-medium shadow-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw size={14} />
                {label('重新生成密钥', 'Regenerate Key')}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => changeMode('import')}
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-800 hover:bg-slate-750 text-slate-200 hover:text-white px-3.5 py-2 text-xs font-medium shadow-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Upload size={15} />
              {label('导入已有密钥', 'Import Existing Key')}
            </button>
          </div>
        )}
      </div>

      {/* 提示与错误 */}
      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium flex items-center gap-2.5 break-words shadow-sm"
        >
          <AlertCircle size={16} className="text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium flex items-center gap-2.5 shadow-sm"
        >
          <Check size={16} className="text-emerald-400 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* 备份模式卡片 */}
      {mode === 'backup' && (
        <div className="p-5 rounded-2xl border border-blue-500/30 bg-slate-900/50 backdrop-blur-sm space-y-4 shadow-lg animate-in fade-in-50 duration-200">
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-300 pb-2 border-b border-slate-800/80">
            <Check size={17} className="text-emerald-400" />
            <span>{label('密钥已生成，是否下载一次性备份？', 'Key created. Download a one-time backup?')}</span>
          </div>
          <p className="text-xs leading-relaxed text-slate-400">
            {label(
              '备份可在其他浏览器或桌面端导入，让它们使用同一把密钥。下载不是必需的；结束此步骤后无法再次导出。请勿与聊天目录一起分享，也不要把文件或口令发送给他人。',
              'Import the backup into another browser or desktop client to share the same key. Download is optional and unavailable after this step. Do not share it with the chat folder or give the file or password to others.'
            )}
          </p>
          {!downloaded ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="ai-key-backup-password" className="text-[11px] font-medium text-slate-400 block mb-1.5">
                    {label('备份口令（至少 12 位）', 'Backup Password (12+ characters)')}
                  </label>
                  <input
                    id="ai-key-backup-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={1024}
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    disabled={busy}
                    placeholder="••••••••••••"
                    className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="ai-key-backup-confirm" className="text-[11px] font-medium text-slate-400 block mb-1.5">
                    {label('确认备份口令', 'Confirm Backup Password')}
                  </label>
                  <input
                    id="ai-key-backup-confirm"
                    type="password"
                    autoComplete="new-password"
                    maxLength={1024}
                    value={confirmation}
                    onChange={event => setConfirmation(event.target.value)}
                    disabled={busy}
                    placeholder="••••••••••••"
                    className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all font-mono"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  disabled={busy || password.length < 12 || password !== confirmation}
                  onClick={() => void download()}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 text-xs font-semibold shadow-md shadow-blue-900/30 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download size={15} />
                  {label('下载加密备份', 'Download Encrypted Backup')}
                </button>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-3">
                <label className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={event => setAcknowledged(event.target.checked)}
                    disabled={busy}
                    className="mt-0.5 rounded border-slate-700 text-blue-500 focus:ring-blue-500/40 accent-blue-600 shrink-0"
                  />
                  <span>
                    {label(
                      '我选择不下载，并了解清除本机数据后将无法恢复密钥，需要重新填写 API Key。',
                      'I choose not to download and understand that clearing local data will require re-entering API keys.'
                    )}
                  </span>
                </label>
                <button
                  type="button"
                  disabled={busy || !acknowledged}
                  onClick={finishBackup}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-slate-700/80 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white px-3.5 py-2 text-xs font-medium shadow-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {label('不下载，完成', 'Finish Without Download')}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs leading-relaxed text-amber-300">
                {label(
                  '已发起下载。请确认文件确实保存成功，并记住备份口令；文件与口令缺一不可。',
                  'Download started. Confirm the file was actually saved and remember its password; both are required.'
                )}
              </p>
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={finishBackup}
                  disabled={busy}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 text-xs font-semibold shadow-md shadow-blue-900/30 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Check size={15} />
                  {label('已保存备份，完成', 'Backup Saved, Finish')}
                </button>
                <button
                  type="button"
                  onClick={() => setDownloaded(false)}
                  disabled={busy}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-slate-700/80 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white px-3.5 py-2 text-xs font-medium shadow-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download size={15} />
                  {label('重新下载', 'Download Again')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 导入模式卡片 */}
      {mode === 'import' && (
        <div className="p-5 rounded-2xl border border-blue-500/30 bg-slate-900/50 backdrop-blur-sm space-y-4 shadow-lg animate-in fade-in-50 duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
            <div className="flex items-center gap-2.5 text-sm font-bold text-slate-100">
              <FileKey2 size={17} className="text-blue-400" />
              <span>{label('导入密钥备份', 'Import Key Backup')}</span>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => changeMode('idle')}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>
          <p className="text-xs leading-relaxed text-slate-400">
            {label(
              '导入前会验证当前目录。文件或口令错误不会覆盖配置。更换本机密钥后，其他使用旧密钥的目录需要对应备份才能重新打开。',
              'The key is verified against this folder before import. Incorrect files or passwords do not overwrite settings. Other folders using your old key will require their matching backup.'
            )}
          </p>
          <div className="space-y-4">
            <div>
              <label htmlFor="ai-key-import-file" className="text-[11px] font-medium text-slate-400 block mb-1.5">
                {label('密钥备份文件', 'Key Backup File')}
              </label>
              <input
                id="ai-key-import-file"
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={event => setFile(event.target.files?.[0] ?? null)}
                className="w-full bg-slate-950/80 border border-slate-800 hover:border-slate-700 rounded-xl p-2.5 text-xs text-slate-300 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-600/20 file:text-blue-300 hover:file:bg-blue-600/30 file:cursor-pointer transition-all"
              />
            </div>
            <div>
              <label htmlFor="ai-key-import-password" className="text-[11px] font-medium text-slate-400 block mb-1.5">
                {label('备份口令', 'Backup Password')}
              </label>
              <input
                id="ai-key-import-password"
                type="password"
                autoComplete="off"
                maxLength={1024}
                value={password}
                onChange={event => setPassword(event.target.value)}
                disabled={busy}
                placeholder="••••••••••••"
                className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all font-mono"
              />
            </div>
            <div className="flex flex-wrap gap-2.5 pt-1">
              <button
                type="button"
                disabled={busy || !file || !password}
                onClick={() => void importKey()}
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 text-xs font-semibold shadow-md shadow-blue-900/30 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Upload size={15} />
                {label('验证并导入', 'Verify and Import')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => changeMode('idle')}
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-slate-700/80 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white px-3.5 py-2 text-xs font-medium shadow-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <X size={14} />
                {label('取消', 'Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 重新生成/轮换模式卡片 */}
      {mode === 'reset' && (
        <div
          className={`p-5 rounded-2xl border bg-slate-900/50 backdrop-blur-sm space-y-4 shadow-lg animate-in fade-in-50 duration-200 ${
            protectedKey ? 'border-emerald-500/30' : 'border-amber-500/30'
          }`}
        >
          <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
            <div
              className={`flex items-center gap-2 text-sm font-bold ${
                protectedKey ? 'text-emerald-300' : 'text-amber-300'
              }`}
            >
              {protectedKey ? <ShieldCheck size={17} /> : <AlertTriangle size={17} />}
              <span>
                {protectedKey
                  ? label('更换加密密钥，保留 API Key', 'Replace Encryption Key, Keep API Keys')
                  : label('重新生成会清空 API Key', 'Regenerating Clears API Keys')}
              </span>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => changeMode('idle')}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>
          <p className="text-xs leading-relaxed text-slate-300">
            {protectedKey
              ? label(
                  '当前密钥可用，已保存的 API Key 会自动使用新密钥重新加密，无需重新填写。聊天、图片和其他设置保持不变。共用此目录的其他客户端需要导入新密钥；其他仍使用旧密钥的目录需要旧备份。',
                  'Your current key works. Saved API keys will be re-encrypted with the new key without re-entry. Chats, images and other settings remain unchanged. Other clients sharing this folder must import the new key; other folders still using the old key require its old backup.'
                )
              : label(
                  '当前目录及当前客户端本地存储中的所有 API Key 将立即清空，需要重新填写。聊天、图片和其他设置保留。共用此目录的其他客户端需要导入新密钥；其他仍使用旧密钥的目录则需要旧备份。旧备份无法解锁此后保存的新凭据。',
                  'All API keys in this folder and local storage on this client will be cleared immediately and must be re-entered. Chats, images and other settings remain. Other clients sharing this folder must import the new key; other folders still using the old key require its old backup. Old backups cannot unlock newly saved credentials.'
                )}
          </p>
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <label className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={busy}
                onChange={event => setAcknowledged(event.target.checked)}
                className={`mt-0.5 rounded border-slate-700 shrink-0 ${
                  protectedKey ? 'accent-emerald-500' : 'accent-amber-500'
                }`}
              />
              <span>
                {protectedKey
                  ? label('我了解其他客户端需要导入新密钥，并同意更换。', 'I understand other clients need the new key and agree to replace it.')
                  : label('我了解 API Key 会被清空，并同意重新生成密钥。', 'I understand API keys will be cleared and agree to regenerate the key.')}
              </span>
            </label>
          </div>
          <div className="flex flex-wrap gap-2.5 pt-1">
            <button
              type="button"
              disabled={busy || !acknowledged}
              onClick={() => void generate(protectedKey ? 'rotate' : 'reset')}
              className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer disabled:opacity-40 px-4 py-2 text-white ${
                protectedKey
                  ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-950/30'
                  : 'bg-amber-600 hover:bg-amber-500 shadow-amber-950/30'
              }`}
            >
              <RefreshCw size={14} />
              {protectedKey
                ? label('保留 API Key 并更换密钥', 'Keep API Keys and Replace Key')
                : label('清空 API Key 并重新生成', 'Clear API Keys and Regenerate')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => changeMode('idle')}
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-slate-700/80 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white px-3.5 py-2 text-xs font-medium shadow-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {label('取消', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      {/* 忙碌状态指示 */}
      {busy && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-300 text-xs flex items-center gap-2.5 shadow-sm"
        >
          <LoaderCircle size={15} className="animate-spin text-blue-400 shrink-0" />
          <span>{label('正在安全处理密钥...', 'Processing encryption key...')}</span>
        </div>
      )}
    </section>
  );
}
