import DOMPurify from 'dompurify';
import * as csstree from 'css-tree';
import type { CSSProperties } from 'react';

export type DecorationFormat = 'css' | 'html';
export interface CustomContentResult {
  source: string;
  issues: string[];
}

const BACKGROUND_PROPERTIES = new Set([
  'background', 'background-color', 'background-image', 'background-position',
  'background-position-x', 'background-position-y', 'background-size',
  'background-repeat', 'background-origin', 'background-clip', 'background-blend-mode'
]);

const parseCss = (source: string, context: 'declarationList' | 'stylesheet') => csstree.parse(source, {
  context,
  parseCustomProperty: true,
  onParseError: (error) => { throw error; }
});

export const detectDecorationFormat = (source: string): DecorationFormat => {
  if (!/<[a-z!][\s\S]*?>/i.test(source)) return 'css';
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  return parsed.head.children.length || parsed.body.children.length ? 'html' : 'css';
};

const cleanDeclarations = (source: string, backgroundOnly: boolean): CustomContentResult => {
  const issues: string[] = [];
  try {
    const tree = parseCss(source, 'declarationList');
    csstree.walk(tree, (node) => {
      if (node.type === 'Atrule' || node.type === 'Rule') {
        throw new Error('At-rules are not supported.');
      }
      if (node.type === 'Raw' || node.type === 'Url') throw new Error('External resources or invalid CSS.');
      if (node.type === 'Function' && /^(?:-webkit-)?image-set$|^(image|src|paint|element|-moz-element|expression)$/i.test(csstree.ident.decode(node.name))) {
        throw new Error('External or dynamic images are not supported.');
      }
      if (node.type !== 'Declaration') return;
      const property = csstree.ident.decode(node.property).toLowerCase();
      const value = csstree.generate(node.value);
      if (backgroundOnly && !BACKGROUND_PROPERTIES.has(property) && !property.startsWith('--')) {
        throw new Error(`Unsupported background property: ${property}`);
      }
      if (/expression\s*\(|javascript:|[<>]|-moz-binding|behavior\s*:/i.test(value)) {
        throw new Error(`Unsafe CSS: ${property}`);
      }
      if (/^(animation|transition)(-|$)/.test(property) || ['behavior', '-moz-binding', 'pointer-events'].includes(property)) {
        throw new Error(`Unsupported CSS: ${property}`);
      }
      if (property === 'position' && /fixed|sticky/i.test(value)) throw new Error('Use relative or absolute positioning.');
      if (property === 'background-attachment') throw new Error('Fixed backgrounds are not supported.');
      csstree.walk(node.value, (valueNode) => {
        if (valueNode.type === 'Dimension' && /^(?:[sld]?v[whib]|vmin|vmax)$/i.test(csstree.ident.decode(valueNode.unit))) {
          throw new Error('Use percentages or pixels instead of viewport units.');
        }
      });
    });
    return { source: csstree.generate(tree), issues };
  } catch (error) {
    return { source: '', issues: [error instanceof Error ? error.message : 'Invalid CSS.'] };
  }
};

export const sanitizeStaticCss = (source: string) => cleanDeclarations(source, false);

export const sanitizeBackgroundCss = (source: string): CustomContentResult => {
  if (!source.trim()) return { source: '', issues: ['CSS is empty.'] };
  if (source.length > 6000) return { source: '', issues: ['CSS exceeds 6000 characters.'] };
  return cleanDeclarations(source, true);
};

export const backgroundCssStyle = (source: string): CSSProperties => {
  const result = sanitizeBackgroundCss(source);
  if (result.issues.length || typeof document === 'undefined') return {};
  const style = document.createElement('div').style;
  style.cssText = result.source;
  const output: Record<string, string> = {};
  for (const property of new Set([...BACKGROUND_PROPERTIES, ...Array.from(style)])) {
    const value = style.getPropertyValue(property);
    if (!value) continue;
    output[property.startsWith('--') ? property : property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())] = value;
  }
  return output as CSSProperties;
};

const scopeStylesheet = (source: string, scope: string): string => {
  const tree = parseCss(source, 'stylesheet');
  csstree.walk(tree, (node) => {
    if (node.type === 'Atrule') throw new Error('At-rules are not supported.');
    if (node.type !== 'Rule') return;
    if (node.prelude?.type !== 'SelectorList') throw new Error('Invalid selector.');
    const declarations = cleanDeclarations(node.block.children.toArray().map((child) => csstree.generate(child)).join(';'), false);
    if (declarations.issues.length) throw new Error(declarations.issues[0]);
    const selectors = node.prelude.children.toArray().map((selector) => {
      csstree.walk(selector, (part, item) => {
        if ((part.type === 'TypeSelector' && /^(html|body)$/i.test(part.name)) ||
          (part.type === 'PseudoClassSelector' && part.name === 'root')) {
          item.data = { type: 'PseudoClassSelector', name: 'scope', children: null };
        }
      });
      const text = csstree.generate(selector);
      if (/:host|::slotted|&/.test(text)) throw new Error('Unsupported selector.');
      if (text.startsWith(':scope') && /[+~]/.test(text)) throw new Error('Root sibling selectors are not supported.');
      return text.startsWith(':scope') ? text.replace(/:scope/g, scope) : `${scope} ${text.replace(/:scope/g, scope)}`;
    });
    node.prelude = csstree.parse(selectors.join(','), { context: 'selectorList' }) as csstree.SelectorList;
  });
  return csstree.generate(tree);
};

export const sanitizeDecorationHtml = (source: string, scopeId = 'preview'): CustomContentResult => {
  if (!source.trim()) return { source: '', issues: ['HTML is empty.'] };
  if (source.length > 24000) return { source: '', issues: ['HTML exceeds 24000 characters.'] };
  const issues: string[] = [];
  const scope = `[data-cf-fragment="${scopeId.replace(/[^a-z0-9-]/gi, '')}"]`;
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  const styles = Array.from(parsed.querySelectorAll('style')).map((style) => style.textContent || '');
  const bodyStyle = parsed.body.getAttribute('style');
  if (bodyStyle) styles.push(`:root{${bodyStyle}}`);
  for (const attribute of Array.from(parsed.body.attributes)) {
    if (attribute.name.toLowerCase().startsWith('on')) issues.push('Unsafe body event attributes were removed.');
  }
  parsed.querySelectorAll('style').forEach((style) => style.remove());
  const purified = DOMPurify.sanitize(`${parsed.head.innerHTML}${parsed.body.innerHTML}`, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'canvas', 'marquee', 'blink'],
    FORBID_ATTR: ['srcset', 'href', 'action', 'formaction', 'is', 'contenteditable', 'tabindex', 'draggable', 'autofocus', 'background', 'poster', 'lowsrc', 'dynsrc'],
    ALLOW_DATA_ATTR: false
  });
  if (DOMPurify.removed.length) issues.push('Unsafe HTML tags or attributes were removed.');
  const container = document.createElement('div');
  container.innerHTML = purified;
  if (container.querySelectorAll('*').length > 300) return { source: '', issues: ['HTML exceeds 300 elements.'] };
  container.querySelectorAll('*').forEach((element) => {
    const inline = element.getAttribute('style');
    if (inline) {
      const result = cleanDeclarations(inline, false);
      issues.push(...result.issues);
      element.setAttribute('style', result.source);
    }
    if (element.hasAttribute('src') && !/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(element.getAttribute('src') || '')) {
      element.removeAttribute('src');
      issues.push('Only embedded bitmap images are supported.');
    }
  });
  try {
    const css = styles.map((style) => scopeStylesheet(style, scope)).join('\n').replace(/</g, '\\3c ');
    return { source: `${css ? `<style>${css}</style>` : ''}${container.innerHTML}`, issues: [...new Set(issues)] };
  } catch (error) {
    return { source: container.innerHTML, issues: [...new Set([...issues, error instanceof Error ? error.message : 'Invalid stylesheet.'])] };
  }
};