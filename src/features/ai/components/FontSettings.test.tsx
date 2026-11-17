// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import FontSettings from './FontSettings.tsx';
import type { LocalFontSelection } from 'sang-ai-kit/fonts';
import { GOOGLE_FONTS } from 'sang-ai-kit/fonts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let cleanup = () => {};
afterEach(() => { cleanup(); document.getElementById('coverflow-google-fonts-catalog')?.remove(); vi.unstubAllGlobals(); });

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
  const link = document.querySelector<HTMLLinkElement>('#coverflow-google-fonts-catalog')!;
  expect(link.crossOrigin).toBe('anonymous');
  const url = new URL(link.href);
  expect(url.searchParams.getAll('family')).toHaveLength(9);
  expect(new Set(url.searchParams.get('text'))).toEqual(new Set(GOOGLE_FONTS.map(font => font.name).join('')));
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

it('toggles local and online fonts independently and removes disabled previews', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  await act(async () => { root.render(<FontSettings fonts={[]} onChange={() => {}} english={false} showLocalFonts showOnlineFonts />); });
  expect(document.getElementById('coverflow-google-fonts-catalog')).not.toBeNull();
  await act(async () => { root.render(<FontSettings fonts={[]} onChange={() => {}} english={false} showLocalFonts showOnlineFonts={false} />); });
  expect(document.getElementById('coverflow-google-fonts-catalog')).toBeNull();
  expect(container.textContent).toContain('读取本机字体');
  expect(container.textContent).not.toContain('Google Fonts');
  await act(async () => { root.render(<FontSettings fonts={[]} onChange={() => {}} english={false} showLocalFonts={false} showOnlineFonts />); });
  expect(document.getElementById('coverflow-google-fonts-catalog')).not.toBeNull();
  expect(container.textContent).not.toContain('读取本机字体');
  expect(container.textContent).toContain('Google Fonts');
});