// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import type { AiSkillConfig } from '../types.ts';
import SkillSettings from './SkillSettings.tsx';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let cleanup = () => {};
afterEach(() => cleanup());

function setup(english = false) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let skills: AiSkillConfig[] = [];
  const render = () => root.render(<SkillSettings skills={skills} english={english} onChange={next => { skills = next; render(); }} />);
  act(render);
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  const click = (text: string) => {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === text || item.getAttribute('aria-label') === text);
    expect(button).toBeTruthy();
    act(() => button!.click());
  };
  const fill = (labelText: string, value: string) => {
    const label = [...container.querySelectorAll('label')].find(item => item.textContent === labelText)!;
    const field = document.getElementById(label.htmlFor) as HTMLInputElement | HTMLTextAreaElement;
    act(() => {
      const prototype = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  return { container, click, fill, skills: () => skills };
}

it('starts empty and adds editable examples with unique names, deleting back to empty', () => {
  const view = setup();
  expect(view.container.textContent).toContain('暂无 SKILL');
  expect(view.skills()).toEqual([]);
  view.click('添加示例');
  expect(view.skills()[0]).toMatchObject({ name: 'brand-cover' });
  expect(view.skills()[0].content).toContain('place_asset');
  view.fill('名称', 'my-brand');
  view.fill('适用描述', '品牌任务');
  view.fill('内容', '保持原色');
  expect(view.skills()[0]).toEqual({ name: 'my-brand', description: '品牌任务', content: '保持原色' });
  view.click('添加示例');
  view.click('添加示例');
  expect(view.skills().map(skill => skill.name)).toEqual(['my-brand', 'brand-cover', 'brand-cover-2']);
  view.click('删除当前 SKILL');
  view.click('删除当前 SKILL');
  view.click('删除当前 SKILL');
  expect(view.skills()).toEqual([]);
  expect(view.container.querySelector('textarea')).toBeNull();
});

it('adds blank skills and validates required name, description and content fields', () => {
  const view = setup(true);
  view.click('Add Skill');
  expect(view.skills()).toEqual([{ name: 'new-skill', description: '', content: '' }]);
  const name = view.container.querySelector('input')!;
  expect(name.checkValidity()).toBe(true);
  expect([...view.container.querySelectorAll('textarea')].every(field => !field.checkValidity())).toBe(true);
  view.fill('Name', 'Invalid Name');
  expect(name.checkValidity()).toBe(false);
  view.click('Add Skill');
  view.click('Add Skill');
  expect(view.skills().map(skill => skill.name)).toEqual(['Invalid Name', 'new-skill', 'new-skill-2']);
});