// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import type { AiSkillConfig } from '../types.ts';
import { createBrowserChatStore } from '../services/chatStore.ts';
import { defaultConfig } from '../services/config.ts';
import AiSettings from './AiSettings.tsx';
import SkillSettings from './SkillSettings.tsx';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let cleanup = () => {};
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(english = false, persist: (skills: AiSkillConfig[]) => Promise<void> = async () => {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let skills: AiSkillConfig[] = [];
  const render = () => root.render(<SkillSettings skills={skills} english={english} onChange={async next => { await persist(next); skills = next; render(); }} />);
  act(render);
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  const click = async (text: string) => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent === text || item.getAttribute('aria-label') === text || item.title === text);
    expect(button).toBeTruthy();
    await act(async () => button!.click());
  };
  const fill = (labelText: string, value: string) => {
    const label = [...container.querySelectorAll('label')].find(item => item.textContent?.includes(labelText))!;
    const field = document.getElementById(label.htmlFor) as HTMLInputElement | HTMLTextAreaElement;
    act(() => {
      const prototype = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  return { container, click, fill, skills: () => skills };
}

it('starts empty and supports adding presets, saving edits, cloning and deleting', async () => {
  const view = setup();
  expect(view.container.textContent).toContain('暂无已配置的 SKILL 规则');
  expect(view.skills()).toEqual([]);
  await view.click('加入我的技能');
  expect(view.skills()[0].name).toBe('xiaohongshu-cover');
  expect(view.skills()[0].content).toContain('小红书');
  await view.click('编辑');
  view.fill('技能唯一标识', 'my-brand');
  view.fill('触发场景与使用建议', '品牌任务');
  view.fill('完整设计规则内容', '保持原色');
  expect(view.skills()[0].name).toBe('xiaohongshu-cover');
  await view.click('保存修改');
  expect(view.skills()[0]).toEqual({ name: 'my-brand', description: '品牌任务', content: '保持原色' });
  await view.click('克隆并复制该技能');
  await view.click('克隆并复制该技能');
  expect(view.skills().map(skill => skill.name)).toEqual(['my-brand', 'my-brand-copy', 'my-brand-copy-2']);
  await view.click('删除此技能');
  expect(view.skills()).toHaveLength(3);
  expect(document.body.textContent).toContain('确定删除技能“my-brand”吗？');
  await view.click('取消');
  expect(view.skills()).toHaveLength(3);
  await view.click('删除此技能');
  await view.click('确认删除');
  await view.click('删除此技能');
  await view.click('确认删除');
  await view.click('删除此技能');
  await view.click('确认删除');
  expect(view.skills()).toEqual([]);
  expect(view.container.querySelector('textarea')).toBeNull();
});

it('validates new skills before saving and preserves saved content when editing is cancelled', async () => {
  const view = setup(true);
  await view.click('New Skill');
  expect(view.skills()).toEqual([]);
  await view.click('Add Skill');
  expect(view.container.textContent).toContain('Skill name cannot be empty');
  view.fill('Skill Name', 'new-skill');
  await view.click('Add Skill');
  expect(view.container.textContent).toContain('Skill description must contain');
  view.fill('Trigger Context', 'Use for testing');
  await view.click('Add Skill');
  expect(view.container.textContent).toContain('Skill content must contain');
  view.fill('Full Skill Content', 'Keep original colors');
  view.fill('Skill Name', 'invalid--name');
  await view.click('Add Skill');
  expect(view.container.textContent).toContain('Skill name must use');
  expect(view.skills()).toEqual([]);
  view.fill('Skill Name', 'new-skill');
  await view.click('Add Skill');
  expect(view.skills()).toEqual([{ name: 'new-skill', description: 'Use for testing', content: 'Keep original colors' }]);
  await view.click('Edit');
  view.fill('Full Skill Content', 'Unsaved draft');
  await view.click('Cancel');
  expect(view.skills()[0].content).toBe('Keep original colors');
  await view.click('New Skill');
  view.fill('Skill Name', 'new-skill');
  await view.click('Add Skill');
  expect(view.container.textContent).toContain('already exists');
  expect(view.skills()).toHaveLength(1);
});

it('reveals and focuses the editor on every edit or create request', async () => {
  const scroll = vi.fn();
  const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  try {
    const view = setup();
    await view.click('新建技能');
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
    expect(document.activeElement?.id).toMatch(/-name$/);
    await view.click('取消');
    await view.click('加入我的技能');
    scroll.mockClear();
    await view.click('编辑');
    expect(scroll).toHaveBeenCalledTimes(1);
    const name = document.activeElement as HTMLInputElement;
    expect(name.value).toBe('xiaohongshu-cover');
    name.blur();
    await view.click('编辑');
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(name);
  } finally {
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});

it('keeps the editor content until the skill has actually been persisted', async () => {
  let finishSave!: () => void;
  const pendingSave = new Promise<void>(resolve => { finishSave = resolve; });
  const persist = vi.fn(() => pendingSave);
  const view = setup(true, persist);
  await view.click('New Skill');
  view.fill('Skill Name', 'persisted-skill');
  view.fill('Trigger Context', 'Use for testing');
  view.fill('Full Skill Content', 'Do not lose this content');
  await view.click('Add Skill');
  expect(persist).toHaveBeenCalledOnce();
  expect(view.skills()).toEqual([]);
  expect(view.container.querySelector('textarea')?.value).toBe('Do not lose this content');
  expect([...view.container.querySelectorAll('button')].find(button => button.textContent === 'Saving...')?.disabled).toBe(true);
  await view.click('Saving...');
  expect(persist).toHaveBeenCalledOnce();
  await act(async () => { finishSave(); await pendingSave; });
  expect(view.container.querySelector('textarea')).toBeNull();
  expect(view.container.querySelector('[role="status"]')?.textContent).toBe('Saved');
  expect(view.skills()[0].content).toBe('Do not lose this content');
});

it('preserves the form on persistence failure and allows retrying', async () => {
  const persist = vi.fn<(skills: AiSkillConfig[]) => Promise<void>>()
    .mockRejectedValueOnce(new Error('Disk is full'))
    .mockResolvedValue(undefined);
  const view = setup(true, persist);
  await view.click('New Skill');
  view.fill('Skill Name', 'retry-skill');
  view.fill('Trigger Context', 'Use for testing');
  view.fill('Full Skill Content', 'Keep this draft');
  await view.click('Add Skill');
  expect(view.container.querySelector('[role="alert"]')?.textContent).toBe('Disk is full');
  expect(view.container.querySelector('textarea')?.value).toBe('Keep this draft');
  expect(view.skills()).toEqual([]);
  expect(view.container.querySelector('[role="status"]')).toBeNull();
  await view.click('Add Skill');
  expect(persist).toHaveBeenCalledTimes(2);
  expect(view.container.querySelector('textarea')).toBeNull();
  expect(view.skills()[0].content).toBe('Keep this draft');
});

it('persists skills without applying other settings and reloads them after closing', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  cleanup = () => {
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  };
  const store = createBrowserChatStore();
  const keyBytes = await store.encryption!.generate('create');
  keyBytes.fill(0);
  let config = defaultConfig();
  await store.saveConfig(config);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const restoreScroll = cleanup;
  cleanup = () => { act(() => root.unmount()); container.remove(); restoreScroll(); };
  const onBack = vi.fn();
  const onSave = vi.fn(async (next: typeof config) => {
    await store.saveConfig(next);
    config = await store.loadConfig();
    render();
  });
  const render = (key = 'initial') => root.render(<AiSettings key={key} config={config} onSave={onSave}
    onBack={onBack} english store={store} onKeyChanged={async () => {}} />);
  await act(async () => { render(); await store.encryption!.status(); });
  const click = async (selector: string) => {
    const button = container.querySelector(selector) as HTMLButtonElement;
    expect(button).toBeTruthy();
    await act(async () => button.click());
  };
  const fill = (selector: string, value: string) => {
    const field = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
    act(() => {
      const prototype = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  await click('#ai-settings-tab-prompt');
  fill('textarea', 'Unconfirmed system prompt');
  await click('#ai-settings-tab-skills');
  const newSkillButton = [...container.querySelectorAll('button')].find(button => button.textContent === 'New Skill')!;
  await act(async () => newSkillButton.click());
  fill('[id$="-name"]', 'saved-without-apply');
  fill('[id$="-description"]', 'Use for regression testing');
  fill('[id$="-content"]', 'My skill must survive closing settings');
  const addButton = [...container.querySelectorAll('button')].find(button => button.textContent === 'Add Skill')!;
  await act(async () => {
    addButton.click();
    await onSave.mock.results[0].value;
  });
  expect(onSave).toHaveBeenCalledOnce();
  expect(onBack).not.toHaveBeenCalled();
  const stored = await store.loadConfig();
  expect(stored.skills?.[0].name).toBe('saved-without-apply');
  expect(stored.systemPrompt).not.toBe('Unconfirmed system prompt');
  await click('#ai-settings-tab-prompt');
  expect(container.querySelector('textarea')?.value).toBe('Unconfirmed system prompt');
  await click('[aria-label="Close"]');
  expect(onBack).toHaveBeenCalledOnce();
  config = await store.loadConfig();
  await act(async () => { render('reopened'); });
  await click('#ai-settings-tab-skills');
  expect(container.textContent).toContain('saved-without-apply');
});