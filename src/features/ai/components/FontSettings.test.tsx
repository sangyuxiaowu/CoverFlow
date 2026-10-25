// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import FontSettings from './FontSettings.tsx';
import type { LocalFontSelection } from '../services/fonts.ts';
import { listFonts } from '../services/fonts.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let cleanup = () => {};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let fonts: LocalFontSelection[] = [];
  const render = () => root.render(<FontSettings fonts={fonts} english={false} onChange={next => { fonts = next; render(); }} />);
  act(render);
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  const click = async (name: string) => {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === name || item.getAttribute('aria-label') === name);
    expect(button).toBeTruthy();
    await act(async () => button!.click());
  };
  return { container, click, fonts: () => fonts };
}

it('reads fonts only on click and adds or removes selected families without uploading binaries', async () => {
  const query = vi.fn().mockResolvedValue([
    { family: 'Demo', fullName: 'Demo Regular', style: 'Regular' },
    { family: 'Demo', fullName: 'Demo Bold', style: 'Bold' }
  ]);
  vi.stubGlobal('queryLocalFonts', query);
  const view = setup();
  expect(query).not.toHaveBeenCalled();
  expect(view.container.textContent).toContain('版权风险由用户自行承担');
  expect(view.container.textContent).toContain('站酷快乐体');
  await view.click('读取本机字体');
  expect(query).toHaveBeenCalledTimes(1);
  expect(view.fonts()).toEqual([]);
  await view.click('加入 Demo');
  expect(view.fonts()).toEqual([{ family: 'Demo', fullName: 'Demo', styles: ['Regular', 'Bold'] }]);
  expect(view.container.querySelector<HTMLButtonElement>('[aria-label="加入 Demo"]')!.disabled).toBe(true);
  await view.click('移除 Demo');
  expect(view.fonts()).toEqual([]);
});

it('quotes local preview family names containing decimal versions in both lists', async () => {
  const faces = [
    { family: 'Alibaba PuHuiTi 2.0', fullName: '阿里巴巴普惠体', style: 'Regular' },
    { family: 'HuXiaoBo-NanShenTi2.0', fullName: '胡晓波男神体2.0', style: 'Regular' }
  ];
  vi.stubGlobal('queryLocalFonts', vi.fn().mockResolvedValue(faces));
  const view = setup();
  await view.click('读取本机字体');
  for (const face of faces) {
    await view.click(`加入 ${face.family}`);
    const previews = [...view.container.querySelectorAll<HTMLElement>('[style]')]
      .filter(node => node.textContent === face.fullName);
    expect(previews).toHaveLength(2);
    for (const preview of previews) {
      expect(preview.style.fontFamily).toBe(`${JSON.stringify(face.family)}, sans-serif`);
    }
  }
});

it('reports permission failures without changing the selection', async () => {
  vi.stubGlobal('queryLocalFonts', vi.fn().mockRejectedValue(new Error('Permission denied')));
  const view = setup();
  await view.click('读取本机字体');
  expect(view.container.querySelector('[role="alert"]')!.textContent).toContain('Permission denied');
  expect(view.fonts()).toEqual([]);
});

it('keeps local descriptions blank unless edited and allows clearing them', async () => {
  vi.stubGlobal('queryLocalFonts', vi.fn().mockResolvedValue([{ family: 'Demo', fullName: 'Demo Regular', style: 'Regular' }]));
  const view = setup();
  await view.click('读取本机字体');
  await view.click('加入 Demo');
  const field = view.container.querySelector<HTMLTextAreaElement>('[aria-label="字体介绍 Demo"]')!;
  expect(field.value).toBe('');
  expect(field.maxLength).toBe(1000);
  expect(listFonts(view.fonts())[0].description).toBe('');
  const fill = (value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  fill('适合科技标题');
  expect(view.fonts()[0].description).toBe('适合科技标题');
  expect(listFonts(view.fonts())[0].description).toBe('适合科技标题');
  fill('');
  expect(listFonts(view.fonts())[0].description).toBe('');
});

it('uses inspector display names, family grouping, Chinese-first ordering and bilingual search', async () => {
  vi.stubGlobal('queryLocalFonts', vi.fn().mockResolvedValue([
    { family: 'Western Sans', fullName: 'Western Sans 400 Regular', style: 'Regular' },
    { family: 'Chinese Sans', fullName: '中文字体 Regular', style: 'Regular' },
    { family: 'Chinese Sans', fullName: '中文字体 Bold', style: 'Bold' }
  ]));
  const view = setup();
  await view.click('读取本机字体');
  const rows = () => [...view.container.querySelectorAll<HTMLButtonElement>('button[aria-label^="加入 "]')];
  expect(rows().map(button => button.getAttribute('aria-label'))).toEqual(['加入 Chinese Sans', '加入 Western Sans']);
  expect(rows()[0].parentElement!.textContent).toBe('中文字体');
  expect(rows()[1].parentElement!.textContent).toBe('Western Sans');
  const search = view.container.querySelector<HTMLInputElement>('#ai-font-search')!;
  const fill = (value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, value);
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  fill('中文');
  expect(rows()).toHaveLength(1);
  expect(rows()[0].getAttribute('aria-label')).toBe('加入 Chinese Sans');
  fill('CHINESE');
  expect(rows()).toHaveLength(1);
  await view.click('加入 Chinese Sans');
  expect(view.fonts()).toEqual([{ family: 'Chinese Sans', fullName: '中文字体', styles: ['Regular', 'Bold'] }]);
});