// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { AiSkillConfig } from '../types.ts';
import SkillSettings from './SkillSettings.tsx';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let cleanup = () => {};
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(english = false) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let skills: AiSkillConfig[] = [];
  const render = () => root.render(<SkillSettings skills={skills} english={english} onChange={next => { skills = next; render(); }} />);
  act(render);
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  const click = (text: string) => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent === text || item.getAttribute('aria-label') === text || item.title === text);
    expect(button).toBeTruthy();
    act(() => button!.click());
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

it('starts empty and supports adding presets, saving edits, cloning and deleting', () => {
  const view = setup();
  expect(view.container.textContent).toContain('暂无已配置的 SKILL 规则');
  expect(view.skills()).toEqual([]);
  view.click('加入我的技能');
  expect(view.skills()[0].name).toBe('xiaohongshu-cover');
  expect(view.skills()[0].content).toContain('小红书');
  view.click('编辑');
  view.fill('技能唯一标识', 'my-brand');
  view.fill('触发场景与使用建议', '品牌任务');
  view.fill('完整设计规则内容', '保持原色');
  expect(view.skills()[0].name).toBe('xiaohongshu-cover');
  view.click('保存修改');
  expect(view.skills()[0]).toEqual({ name: 'my-brand', description: '品牌任务', content: '保持原色' });
  view.click('克隆并复制该技能');
  view.click('克隆并复制该技能');
  expect(view.skills().map(skill => skill.name)).toEqual(['my-brand', 'my-brand-copy', 'my-brand-copy-2']);
  view.click('删除此技能');
  expect(view.skills()).toHaveLength(3);
  expect(document.body.textContent).toContain('确定删除技能“my-brand”吗？');
  view.click('取消');
  expect(view.skills()).toHaveLength(3);
  view.click('删除此技能');
  view.click('确认删除');
  view.click('删除此技能');
  view.click('确认删除');
  view.click('删除此技能');
  view.click('确认删除');
  expect(view.skills()).toEqual([]);
  expect(view.container.querySelector('textarea')).toBeNull();
});

it('validates new skills before saving and preserves saved content when editing is cancelled', () => {
  const view = setup(true);
  view.click('New Skill');
  expect(view.skills()).toEqual([]);
  view.click('Add Skill');
  expect(view.container.textContent).toContain('Skill name cannot be empty');
  view.fill('Skill Name', 'new-skill');
  view.click('Add Skill');
  expect(view.container.textContent).toContain('Skill description must contain');
  view.fill('Trigger Context', 'Use for testing');
  view.click('Add Skill');
  expect(view.container.textContent).toContain('Skill content must contain');
  view.fill('Full Skill Content', 'Keep original colors');
  view.fill('Skill Name', 'invalid--name');
  view.click('Add Skill');
  expect(view.container.textContent).toContain('Skill name must use');
  expect(view.skills()).toEqual([]);
  view.fill('Skill Name', 'new-skill');
  view.click('Add Skill');
  expect(view.skills()).toEqual([{ name: 'new-skill', description: 'Use for testing', content: 'Keep original colors' }]);
  view.click('Edit');
  view.fill('Full Skill Content', 'Unsaved draft');
  view.click('Cancel');
  expect(view.skills()[0].content).toBe('Keep original colors');
  view.click('New Skill');
  view.fill('Skill Name', 'new-skill');
  view.click('Add Skill');
  expect(view.container.textContent).toContain('already exists');
  expect(view.skills()).toHaveLength(1);
});

it('reveals and focuses the editor on every edit or create request', () => {
  const scroll = vi.fn();
  const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  try {
    const view = setup();
    view.click('新建技能');
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
    expect(document.activeElement?.id).toMatch(/-name$/);
    view.click('取消');
    view.click('加入我的技能');
    scroll.mockClear();
    view.click('编辑');
    expect(scroll).toHaveBeenCalledTimes(1);
    const name = document.activeElement as HTMLInputElement;
    expect(name.value).toBe('xiaohongshu-cover');
    name.blur();
    view.click('编辑');
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(name);
  } finally {
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});