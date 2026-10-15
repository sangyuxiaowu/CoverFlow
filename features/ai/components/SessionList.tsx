import { useState } from 'react';
import { Check, MessageSquare, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { ChatSession } from '../types.ts';

interface Props {
  sessions: ChatSession[];
  activeId: string | null;
  disabled: boolean;
  english: boolean;
  onNew: () => Promise<void>;
  onSelect: (id: string) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export default function SessionList({
  sessions,
  activeId,
  disabled,
  english,
  onNew,
  onSelect,
  onRename,
  onDelete
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const label = (zh: string, en: string) => (english ? en : zh);

  return (
    <section className="cf-ai-session-list" aria-label={label('聊天会话', 'Chat Sessions')}>
      <div className="cf-ai-section-title">
        <h3>{label('历史会话', 'Chat History')}</h3>
        <button
          className="cf-ai-icon"
          disabled={disabled}
          onClick={() => {
            void onNew();
          }}
          title={label('新建会话', 'New Session')}
          aria-label={label('新建会话', 'New Session')}
        >
          <Plus size={16} />
        </button>
      </div>
      {sessions.length === 0 && (
        <div className="text-center py-6 text-slate-500 text-xs">
          {label('暂无历史会话', 'No history sessions')}
        </div>
      )}
      {sessions.map(session => (
        <div
          key={session.id}
          className={`cf-ai-session-row ${session.id === activeId ? 'cf-ai-session-active' : ''}`}
        >
          {editingId === session.id ? (
            <form
              className="cf-ai-session-edit"
              onSubmit={event => {
                event.preventDefault();
                void onRename(session.id, title).then(() => setEditingId(null));
              }}
            >
              <input
                autoFocus
                value={title}
                maxLength={120}
                required
                aria-label={label('会话名称', 'Session Title')}
                onChange={event => setTitle(event.target.value)}
              />
              <button
                className="cf-ai-icon text-emerald-400"
                disabled={disabled || !title.trim()}
                title={label('保存会话名称', 'Save Session Title')}
                aria-label={label('保存会话名称', 'Save Session Title')}
              >
                <Check size={15} />
              </button>
              <button
                type="button"
                className="cf-ai-icon"
                onClick={() => setEditingId(null)}
                title={label('取消', 'Cancel')}
                aria-label={label('取消', 'Cancel')}
              >
                <X size={15} />
              </button>
            </form>
          ) : (
            <>
              <button
                className="cf-ai-session-select"
                disabled={disabled}
                onClick={() => {
                  void onSelect(session.id);
                }}
              >
                <MessageSquare size={15} />
                <span>
                  <strong>{session.title}</strong>
                  <small>
                    {new Date(session.updatedAt).toLocaleDateString(english ? 'en' : 'zh-CN', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}{' '}
                    · {session.entries.length} {label('条对话', 'messages')}
                  </small>
                </span>
              </button>
              <button
                className="cf-ai-icon"
                disabled={disabled}
                onClick={() => {
                  setEditingId(session.id);
                  setTitle(session.title);
                  setDeletingId(null);
                }}
                title={label('重命名会话', 'Rename Session')}
                aria-label={`${label('重命名会话', 'Rename Session')}: ${session.title}`}
              >
                <Pencil size={13} />
              </button>
              <button
                className="cf-ai-icon cf-ai-icon-close"
                disabled={disabled}
                onClick={() => {
                  setDeletingId(session.id);
                  setEditingId(null);
                }}
                title={label('删除会话', 'Delete Session')}
                aria-label={`${label('删除会话', 'Delete Session')}: ${session.title}`}
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
          {deletingId === session.id && (
            <div className="cf-ai-session-delete" role="alert">
              <span>{label('删除此会话及其全部消息？', 'Delete this session and all messages?')}</span>
              <button
                className="cf-ai-icon text-rose-400"
                disabled={disabled}
                onClick={() => {
                  void onDelete(session.id).then(() => setDeletingId(null));
                }}
                title={label('确认删除会话', 'Confirm Delete Session')}
                aria-label={label('确认删除会话', 'Confirm Delete Session')}
              >
                <Check size={14} />
              </button>
              <button
                className="cf-ai-icon"
                onClick={() => setDeletingId(null)}
                title={label('取消', 'Cancel')}
                aria-label={label('取消', 'Cancel')}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}