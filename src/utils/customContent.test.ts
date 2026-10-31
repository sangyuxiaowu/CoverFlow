// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import Canvas from '../components/Canvas.tsx';
import LivePreview from '../components/LivePreview.tsx';
import LayersPanel from '../components/LayersPanel.tsx';
import type { ProjectState } from '../types.ts';
import { readProject, writeProject } from '../storage/projectCompatibility.ts';
import { copyProject } from './projectPages.ts';
import { backgroundCssStyle, detectDecorationFormat, sanitizeBackgroundCss, sanitizeDecorationHtml } from './customContent.ts';
import { PRESET_DECORATIONS } from '../constants.ts';
import { buildDecorationLayerStyle, sanitizeDecorationContent } from './decorationStyles.ts';
import { buildBackgroundStyles } from './backgroundStyles.ts';
import { buildProjectSvg } from './svgExport.ts';

describe('custom backgrounds', () => {
  it('accepts layered gradients and variables without splitting function values', () => {
    const source = '--ink: #123456; background-color: var(--ink); background-image: linear-gradient(45deg, red, blue), radial-gradient(white, transparent); background-size: 20px 20px;';
    expect(sanitizeBackgroundCss(source).issues).toEqual([]);
    expect(backgroundCssStyle(source).backgroundImage).toContain('gradient');
  });
  it.each(['position: fixed;', 'background: url(https://example.com/a.png);', '@import "evil.css";', 'background: red; } body { color: red;'])('rejects unsafe or out-of-scope CSS: %s', (source) => {
    expect(sanitizeBackgroundCss(source).issues.length).toBeGreaterThan(0);
    expect(backgroundCssStyle(source)).toEqual({});
  });
  it('does not apply overlay textures to custom CSS backgrounds', () => {
    const style = buildBackgroundStyles({ type: 'css', value: 'background: linear-gradient(red,blue);', overlayType: 'dots', overlayColor: '#ffffff', overlayOpacity: 0.3, overlayScale: 20 });
    expect(style.background).toBeTruthy();
    expect(style.backgroundImage).not.toContain('radial-gradient');
    expect(style.backgroundImage).toContain('linear-gradient');
  });
});

describe('decoration rendering boundaries', () => {
  const shadow = '0 0 54px 12px rgba(255,216,146,0.32), 0 0 160px 64px rgba(255,180,104,0.15)';
  const project: ProjectState = {
    id: 'shadow-regression', title: 'Moon', updatedAt: 0, selectedLayerId: null,
    canvasConfig: { width: 800, height: 600, ratio: '4:3' },
    background: { type: 'color', value: '#000000', overlayType: 'none', overlayColor: '#ffffff', overlayOpacity: 0, overlayScale: 20 },
    layers: [{
      id: 'moon', name: 'Moon', type: 'decoration',
      content: `background: #fbeec9; border-radius: 50%; box-shadow: ${shadow};`,
      x: 200, y: 100, width: 300, height: 300, rotation: 0, zIndex: 1,
      visible: true, locked: false, opacity: 0.6
    }]
  };
  const renderers = [
    { name: 'canvas', render: (state: ProjectState) => createElement(Canvas, { project: state, lang: 'zh', onSelectLayer: () => {}, updateLayer: () => {}, onCommit: () => {} }) },
    { name: 'live preview', render: (state: ProjectState) => createElement(LivePreview, { project: state }) }
  ];

  it.each([undefined, 0, 3.5, -1.5])('preserves text letter spacing %s in rendering and SVG export', (letterSpacing) => {
    const state: ProjectState = { ...project, layers: [{ ...project.layers[0], type: 'text', content: 'Spacing', letterSpacing }] };
    for (const { render } of renderers) {
      const container = document.createElement('div');
      container.innerHTML = renderToStaticMarkup(render(state));
      const text = Array.from(container.querySelectorAll('div')).find(element => element.textContent === 'Spacing' && element.style.fontSize);
      expect(text?.style.letterSpacing).toBe(`${letterSpacing ?? 0}px`);
    }
    const xml = new DOMParser().parseFromString(buildProjectSvg(state), 'image/svg+xml');
    const text = Array.from(xml.querySelectorAll('div')).find(element => element.textContent === 'Spacing' && element.style.fontSize);
    expect(text?.style.letterSpacing).toBe(`${letterSpacing ?? 0}px`);
  });

  it.each([undefined, 0.5, 1.5, 5])('preserves multiline text and line height %s in every renderer', (lineHeight) => {
    const content = 'First line\n\n  Second line\nThird <line> & text';
    for (const writingMode of ['horizontal', 'vertical'] as const) {
      const state: ProjectState = { ...project, layers: [{ ...project.layers[0], type: 'text', content, lineHeight, writingMode }] };
      const containers = renderers.map(({ render }) => {
        const container = document.createElement('div');
        container.innerHTML = renderToStaticMarkup(render(state));
        return container;
      });
      const xml = new DOMParser().parseFromString(buildProjectSvg(state), 'image/svg+xml');
      expect(xml.querySelector('parsererror')).toBeNull();
      for (const container of [...containers, xml]) {
        const text = Array.from(container.querySelectorAll('div')).find(element => element.textContent === content && element.style.fontSize);
        expect(text).toBeDefined();
        expect(text!.style.whiteSpace).toBe('pre-wrap');
        expect(text!.style.lineHeight).toBe(String(lineHeight ?? 1.1));
        if (writingMode === 'vertical') expect(text!.style.writingMode).toBe('vertical-rl');
      }
    }
  });

  it('preserves multiline text and line height through saving, reopening and copying', () => {
    const state: ProjectState = { ...project, layers: [{ ...project.layers[0], type: 'text', content: 'First\n\nSecond', lineHeight: 1.8 }] };
    const reopened = readProject(JSON.parse(JSON.stringify(writeProject(state))));
    const copied = copyProject(reopened, 'Copied');
    for (const current of [reopened, copied]) {
      expect(current.layers[0].content).toBe('First\n\nSecond');
      expect(current.layers[0].lineHeight).toBe(1.8);
      expect(current.pages![0].layers[0].lineHeight).toBe(1.8);
    }
  });

  it('edits line height with bounded numeric input and fractional scrubbing in the text inspector', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const state: ProjectState = { ...project, selectedLayerId: 'moon', layers: [{ ...project.layers[0], type: 'text', content: 'First\nSecond' }] };
    const update = vi.fn();
    const commit = vi.fn();
    const noop = () => {};
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const renderPanel = (current: ProjectState, lang: 'zh' | 'en' = 'zh') => createElement(LayersPanel, {
      lang, project: current, selectedLayerIds: ['moon'], onUpdateLayer: update, onRemoveBackground: noop,
      onDeleteLayer: noop, onSelectLayer: noop, onReorderLayers: noop, onCloneLayers: noop,
      onDeleteLayers: noop, onMoveLayersTop: noop, onMoveLayersBottom: noop, onGroupLayers: noop,
      onUngroupLayer: noop, onCommit: commit
    });
    try {
      await act(async () => root.render(renderPanel(state)));
      const input = host.querySelector<HTMLInputElement>('#input-line-height')!;
      expect(input.value).toBe('1.1');
      expect(input.min).toBe('0.5');
      expect(input.max).toBe('5');
      expect(input.step).toBe('0.1');
      const label = host.querySelector<HTMLLabelElement>('label[for="input-line-height"]')!;
      expect(label.textContent).toContain('行距（倍）');
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      for (const [value, expected] of [['1.8', 1.8], ['0.1', 0.5], ['8', 5], ['', 1.1]] as const) {
        await act(async () => {
          setValue.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(update).toHaveBeenLastCalledWith('moon', { lineHeight: expected });
      }
      await act(async () => label.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 20 })));
      for (const [clientX, expected] of [[70, 1.6], [-1000, 0.5], [1000, 5]]) {
        await act(async () => window.dispatchEvent(new MouseEvent('mousemove', { clientX })));
        expect(update).toHaveBeenLastCalledWith('moon', { lineHeight: expected }, false);
      }
      await act(async () => window.dispatchEvent(new MouseEvent('mouseup')));
      expect(commit).toHaveBeenCalledOnce();
      await act(async () => root.render(renderPanel({ ...state, layers: [{ ...state.layers[0], lineHeight: 2 }] }, 'en')));
      expect(host.querySelector<HTMLInputElement>('#input-line-height')!.value).toBe('2');
      expect(host.querySelector('label[for="input-line-height"]')!.textContent).toContain('Line Height (x)');
      await act(async () => root.render(renderPanel({ ...state, layers: [{ ...state.layers[0], type: 'svg', content: '<svg />' }] })));
      expect(host.querySelector('#input-line-height')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it('exports complete CSS decorations instead of reducing them to rectangles', () => {
    const svg = buildProjectSvg({ ...project, layers: [{ ...project.layers[0], content: `--moon: #fbeec9; background: radial-gradient(circle, var(--moon), #eed080); border-radius: 50%; box-shadow: ${shadow}; filter: blur(1px);` }] });
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(xml.querySelector('parsererror')).toBeNull();
    const decoration = Array.from(xml.querySelectorAll('div')).find(element => element.getAttribute('style')?.includes('radial-gradient'));
    expect(decoration).toBeDefined();
    expect(decoration!.getAttribute('style')).toContain('box-shadow:');
    expect(decoration!.getAttribute('style')).toMatch(/filter:\s*blur\(1px\)/);
    expect(decoration!.getAttribute('style')).toContain('--moon:');
  });

  it('preserves nested background variable fallbacks for the browser to resolve', () => {
    const svg = buildProjectSvg({ ...project, layers: [], background: { ...project.background, type: 'css', value: '--Moon: #fbeec9; background: radial-gradient(var(--Moon, var(--fallback, #fff)), transparent);' } });
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(xml.querySelector('parsererror')).toBeNull();
    expect(xml.querySelector('foreignObject div')?.getAttribute('style')).toContain('var(--Moon,var(--fallback,#fff))');
  });

  it('exports HTML with matching scoped styles and XML-safe void elements', () => {
    const svg = buildProjectSvg({ ...project, layers: [{ ...project.layers[0], content: '<style>.moon{background:gold} .moon::before{content:"Moon"}</style><div class="moon">Hello<br>World &amp; stars</div>' }] });
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(xml.querySelector('parsererror')).toBeNull();
    const scope = xml.querySelector('[data-cf-fragment]');
    expect(scope).not.toBeNull();
    expect(scope!.querySelector('.moon')?.textContent).toBe('HelloWorld & stars');
    expect(scope!.querySelector('style')?.textContent).toContain(`[data-cf-fragment="${scope!.getAttribute('data-cf-fragment')}"] .moon`);
    expect(scope!.querySelector('br')?.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(xml.documentElement.querySelector('style')?.textContent).toContain('box-sizing:border-box;margin:0;padding:0;');
  });

  it.each(['horizontal', 'vertical'] as const)('exports %s text using the canvas wrapping box', (writingMode) => {
    const svg = buildProjectSvg({ ...project, layers: [{ ...project.layers[0], type: 'text', content: '中秋快乐', width: 72, height: 300, fontSize: 40, writingMode, textGradient: { enabled: true, from: '#ff0', to: '#fa0', angle: 90 }, textShadow: { enabled: true, blur: 8, offsetX: 0, offsetY: 4, color: '#333' } }] });
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(xml.querySelector('parsererror')).toBeNull();
    const text = Array.from(xml.querySelectorAll('div')).find(element => element.textContent === '中秋快乐');
    expect(text).toBeDefined();
    expect(text!.getAttribute('style')).toMatch(/word-break:\s*break-word/);
    expect(text!.getAttribute('style')).toMatch(/line-height:\s*1\.1/);
    expect(text!.getAttribute('style')).toContain('text-shadow:');
    expect(text!.getAttribute('style')).toMatch(/background-clip:\s*text/);
    if (writingMode === 'vertical') expect(text!.getAttribute('style')).toMatch(/writing-mode:\s*vertical-rl/);
  });

  it.each(renderers)('$name lets CSS shadows extend beyond the layer but clips at the canvas', ({ render }) => {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(render(project));
    const decoration = Array.from(container.querySelectorAll('div')).find(element => element.style.boxShadow.includes('160px'));
    expect(decoration).toBeDefined();
    expect(decoration!.style.boxShadow).toBe(shadow);
    expect(decoration!.style.borderRadius).toBe('50%');
    expect(decoration!.parentElement!.style.opacity).toBe('0.6');
    const canvas = Array.from(container.querySelectorAll('div')).find(element => element.style.width === '800px' && element.style.height === '600px');
    expect(canvas).toBeDefined();
    expect(canvas!.contains(decoration!)).toBe(true);
    for (let ancestor = decoration!.parentElement; ancestor && ancestor !== canvas; ancestor = ancestor.parentElement) {
      expect(ancestor.className).not.toMatch(/\boverflow(?:-[xy])?-(?:hidden|clip|auto|scroll)\b/);
      for (const overflow of [ancestor.style.overflow, ancestor.style.overflowX, ancestor.style.overflowY]) {
        expect(overflow).not.toMatch(/hidden|clip|auto|scroll/);
      }
      expect(ancestor.style.contain).not.toMatch(/paint|strict|content/);
    }
    expect(canvas!.classList.contains('overflow-hidden') || canvas!.style.overflow === 'hidden').toBe(true);
  });

  it.each(renderers)('$name preserves HTML fragment clipping and isolation', ({ render }) => {
    const container = document.createElement('div');
    const htmlProject: ProjectState = { ...project, layers: [{ ...project.layers[0], content: `<div style="width:100%;height:100%;box-shadow:${shadow}">Moon</div>` }] };
    container.innerHTML = renderToStaticMarkup(render(htmlProject));
    const boundary = container.querySelector('[data-cf-fragment]')?.parentElement;
    expect(boundary).toBeTruthy();
    expect(boundary!.style.overflow).toBe('hidden');
    expect(boundary!.style.isolation).toBe('isolate');
    expect(boundary!.style.contain).toBe('layout paint style');
    expect(boundary!.style.pointerEvents).toBe('none');
  });
});

describe('HTML decorations', () => {
  it('distinguishes CSS from HTML, including document snippets', () => {
    expect(detectDecorationFormat('background: red;')).toBe('css');
    expect(detectDecorationFormat('<!doctype html><html><head><style>.card {color:red}</style></head><body><div class="card">Hi</div></body></html>')).toBe('html');
  });
  it('scopes all selectors including document roots and pseudo-elements', () => {
    const result = sanitizeDecorationHtml('<style>body {color: red} .card, p::before { content: "hi"; border: 1px solid red; }</style><div class="card">Hello</div>', 'test');
    expect(result.issues).toEqual([]);
    expect(result.source).toContain('[data-cf-fragment="test"] .card');
    expect(result.source).toContain('[data-cf-fragment="test"] p::before');
    expect(result.source).not.toContain('body{');
  });
  it('preserves body styles in full document input without enabling body events', () => {
    const result = sanitizeDecorationHtml('<html><head><style>p{margin:0}</style></head><body style="background:red"><p>Document</p></body></html>', 'full');
    expect(result.issues).toEqual([]);
    expect(result.source).toContain('[data-cf-fragment="full"]{background:red}');
    expect(sanitizeDecorationHtml('<body onload="alert(1)"><p>Hi</p></body>').issues.length).toBeGreaterThan(0);
  });
  it('removes scripts, events and external resources', () => {
    const result = sanitizeDecorationHtml('<script>alert(1)</script><img src="https://example.com/a.png" onerror="alert(1)"><div style="background:url(https://example.com)">Test</div>');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.source).not.toMatch(/<script|onerror|https:/);
  });
  it.each(['position:fixed', 'animation: spin 1s infinite', 'width:100vw', 'background:u\\72l(https://evil.test)', 'background:image-set("https://evil.test/a.png" 1x)', 'pointer-events:auto', 'a\\6e imation:spin 1s infinite'])('rejects unsafe or nondeterministic styles: %s', (style) => {
    expect(sanitizeDecorationHtml(`<div style="${style}">Hello</div>`).issues.length).toBeGreaterThan(0);
  });
  it('rejects at-rules and oversized DOMs', () => {
    expect(sanitizeDecorationHtml('<style>@import "evil.css";</style><div>Hi</div>').issues.length).toBeGreaterThan(0);
    expect(sanitizeDecorationHtml('<div></div>'.repeat(301)).issues.length).toBeGreaterThan(0);
  });
  it('blocks root selectors that could target siblings outside the fragment', () => {
    expect(sanitizeDecorationHtml('<style>:root + div {color:red}</style><p>Safe</p>').issues.length).toBeGreaterThan(0);
  });
  it('preserves HTML source across repeated saves and scopes only during rendering', () => {
    const source = '<style>.badge{color:red}</style><div class="badge">Hello</div>';
    const saved = sanitizeDecorationContent(source);
    expect(saved.cssText).toBe(source);
    expect(sanitizeDecorationContent(saved.cssText).cssText).toBe(source);
    expect(sanitizeDecorationHtml(saved.cssText, 'another').source).toContain('[data-cf-fragment="another"]');
  });
  it('keeps existing CSS presets and custom variables working', () => {
    for (const preset of PRESET_DECORATIONS) {
      expect(preset.cssText).not.toMatch(/currentColor/i);
      expect(sanitizeDecorationContent(preset.cssText).issues).toEqual([]);
    }
    const custom = sanitizeDecorationContent('--accent: #ff0000; background: var(--accent);');
    expect(custom.issues).toEqual([]);
    expect((custom.style as Record<string, string>)['--accent']).toBe('#ff0000');
  });
  it('applies resource restrictions to CSS decorations too', () => {
    expect(sanitizeDecorationContent('background: image-set("https://evil.test/x" 1x);').issues.length).toBeGreaterThan(0);
    expect(sanitizeDecorationContent('background: u\\72l(https://evil.test);').issues.length).toBeGreaterThan(0);
    expect(sanitizeDecorationHtml('<style>.x{background:i\\6d age-set("https://evil.test" 1x)}</style><div class="x"></div>').issues.length).toBeGreaterThan(0);
  });
  it('unwraps a leading root variable block and preserves trailing gradient declarations', () => {
    const source = ':root { --glow: rgba(139,92,246,0.55); --glow2: rgba(56,189,248,0.18); } background: radial-gradient(circle at 79% 34%, var(--glow) 0%, rgba(139,92,246,0) 55%), radial-gradient(circle at 22% 108%, var(--glow2) 0%, rgba(56,189,248,0) 52%);';
    const result = sanitizeDecorationContent(source);
    expect(result.issues).toEqual([]);
    expect(result.cssText).not.toMatch(/:root|[{}]/);
    expect(result.cssText).toContain('--glow:');
    expect(result.style.background).toContain('var(--glow2)');
    expect(sanitizeDecorationContent(result.cssText)).toEqual(result);
    expect(sanitizeDecorationContent(':root { --accent: red; }').issues).toEqual([]);
  });
  it('does not unwrap other selectors, nested rules, unsafe variables or malformed root blocks', () => {
    for (const source of [
      '.card { --accent: red; } background: var(--accent);',
      ':root, .card { --accent: red; }',
      ':root { background: red; }',
      ':root { .card { color: red; } }',
      ':root { --accent: red;',
      ':root { --image: url(https://example.com/a.png); } background: var(--image);',
      ':root { --accent: red; } @import "evil.css";'
    ]) {
      expect(sanitizeDecorationContent(source).issues.length).toBeGreaterThan(0);
    }
  });
  it('uses source variables without injecting a fixed layer color', () => {
    const source = '--accent: #ef476f; background: var(--accent);';
    const style = buildDecorationLayerStyle(source) as Record<string, string>;
    expect(style.color).toBeUndefined();
    expect(style['--accent']).toBe('#ef476f');
    expect(style.background).toBe('var(--accent)');
  });
  it('retains pending shorthand variables when browser enumeration omits the shorthand', () => {
    const createElement = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
      const element = createElement(tagName);
      Object.defineProperty(element.style, Symbol.iterator, { value: function* () {
        for (let index = 0; index < element.style.length; index++) {
          const property = element.style.item(index);
          if (property !== 'background') yield property;
        }
      } });
      return element;
    });
    try {
      const source = '--Accent: #ef476f; background: linear-gradient(var(--Accent), transparent);';
      expect(buildDecorationLayerStyle(source).background).toContain('var(--Accent)');
      expect(backgroundCssStyle(source).background).toContain('var(--Accent)');
      expect((buildDecorationLayerStyle(source) as Record<string, string>)['--Accent']).toBe('#ef476f');
    } finally {
      spy.mockRestore();
    }
  });
});