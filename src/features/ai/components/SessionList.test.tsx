// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import SessionList from './SessionList.tsx';
import type { ChatSession } from '../types.ts';

it('selects and inverts only the current category and confirms before deleting', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  const onDeleteImages = vi.fn(async () => true);
  const session: ChatSession = {
    id: 'session', title: 'Test', createdAt: 1, updatedAt: 1, requests: [], responseItems: [],
    entries: [{ id: 'entry', role: 'assistant', content: '', images: [
      { id: 'p1', name: 'canvas-preview-1.webp', type: 'image/webp', size: 100 },
      { id: 'p2', name: 'canvas-preview-2.webp', type: 'image/webp', size: 200 },
      { id: 'gen', name: 'generated-1.png', type: 'image/png', size: 300 }
    ] }]
  };
  const click = async (selector: string) => {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element, selector).not.toBeNull();
    await act(async () => { element!.click(); });
  };
  try {
    await act(async () => { root.render(<SessionList sessions={[session]} activeId="session" disabled={false} english={false} onNew={async () => {}} onSelect={async () => {}} onRename={async () => {}} onDelete={async () => {}} onDeleteImages={onDeleteImages} />); });
    await click('[title="点击打开图片画廊并预览保存"]');
    await click('[title="画布与图层实时预览快照"]');
    await click('[aria-label="批量选择"]');
    await click('[aria-label="全选当前分类"]');
    expect(host.querySelectorAll('input:checked')).toHaveLength(2);
    await click('[aria-label="反选当前分类"]');
    expect(host.querySelectorAll('input:checked')).toHaveLength(0);
    await click('input[type="checkbox"]');
    await click('[aria-label="反选当前分类"]');
    expect(host.querySelector<HTMLInputElement>('input:checked')?.getAttribute('aria-label')).toContain('preview-2');
    await click('[aria-label="删除选中图片"]');
    expect(onDeleteImages).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('1 张图片');
    const confirm = [...host.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === '确认删除')!;
    await act(async () => { confirm.click(); });
    expect(onDeleteImages).toHaveBeenCalledWith([{ sessionId: 'session', imageId: 'p2' }]);
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    await click('[title="显示所有图片素材"]');
    expect(host.querySelectorAll('input:checked')).toHaveLength(0);
  } finally {
    await act(async () => { root.unmount(); });
    vi.unstubAllGlobals();
  }
});