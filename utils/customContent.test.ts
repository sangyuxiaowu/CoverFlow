// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { backgroundCssStyle, detectDecorationFormat, sanitizeBackgroundCss, sanitizeDecorationHtml } from './customContent.ts';
import { PRESET_DECORATIONS } from '../constants.ts';
import { buildDecorationLayerStyle, sanitizeDecorationContent } from './decorationStyles.ts';
import { buildBackgroundStyles } from './backgroundStyles.ts';

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
    const saved = sanitizeDecorationContent(source, 'html');
    expect(saved.cssText).toBe(source);
    expect(sanitizeDecorationContent(saved.cssText, saved.format).cssText).toBe(source);
    expect(sanitizeDecorationHtml(saved.cssText, 'another').source).toContain('[data-cf-fragment="another"]');
  });
  it('keeps existing CSS presets and custom variables working', () => {
    for (const preset of PRESET_DECORATIONS) {
      expect(preset.cssText).not.toMatch(/currentColor/i);
      expect(sanitizeDecorationContent(preset.cssText).issues).toEqual([]);
    }
    const custom = sanitizeDecorationContent('--accent: #ff0000; background: var(--accent);', 'css');
    expect(custom.issues).toEqual([]);
    expect((custom.style as Record<string, string>)['--accent']).toBe('#ff0000');
  });
  it('applies resource restrictions to CSS decorations too', () => {
    expect(sanitizeDecorationContent('background: image-set("https://evil.test/x" 1x);', 'css').issues.length).toBeGreaterThan(0);
    expect(sanitizeDecorationContent('background: u\\72l(https://evil.test);', 'css').issues.length).toBeGreaterThan(0);
    expect(sanitizeDecorationHtml('<style>.x{background:i\\6d age-set("https://evil.test" 1x)}</style><div class="x"></div>').issues.length).toBeGreaterThan(0);
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