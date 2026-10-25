import type { CSSProperties } from 'react';
import { detectDecorationFormat, sanitizeDecorationHtml, sanitizeStaticCss } from './customContent.ts';

export const MAX_DECORATION_CSS_LENGTH = 6000;
export const MIN_DECORATION_SIZE = 24;
export const MAX_DECORATION_SIZE = 640;

const ALLOWED_PROPERTIES = [
  'background',
  'background-color',
  'background-image',
  'background-position',
  'background-repeat',
  'background-size',
  'border',
  'border-color',
  'border-radius',
  'border-style',
  'border-width',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-image',
  'border-image-source',
  'border-image-slice',
  'border-image-width',
  'border-image-outset',
  'border-image-repeat',
  'transform',
  'transform-origin',
  'color',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'box-shadow',
  'clip-path',
  'filter',
  'mix-blend-mode',
  'opacity',
  'outline',
  'outline-offset',
  'backdrop-filter'
] as const;

const BLOCKED_VALUE_PATTERNS = [
  /expression\s*\(/i,
  /javascript:/i,
  /url\s*\(/i,
  /@import/i,
  /[<>]/
];

const ALLOWED_SET = new Set<string>(ALLOWED_PROPERTIES);
const IGNORED_PROPERTIES = new Set([
  'font-family', 'font-size', 'line-height', 'text-align', 'content',
  'display', 'align-items', 'justify-content'
]);

export type DecorationIssueCode =
  | 'empty'
  | 'tooLong'
  | 'invalidSyntax'
  | 'unsupportedProperty'
  | 'unsafeValue'
  | 'noDeclarations';

export interface DecorationIssue {
  code: DecorationIssueCode;
  detail?: string;
}

export interface DecorationSanitizeResult {
  cssText: string;
  style: CSSProperties;
  issues: DecorationIssue[];
}

export const sanitizeDecorationContent = (source: string): DecorationSanitizeResult => {
  if (detectDecorationFormat(source) === 'css') return sanitizeDecorationCss(source);
  const result = sanitizeDecorationHtml(source);
  return {
    cssText: source.trim(),
    style: {},
    issues: result.issues.map((detail) => ({ code: 'unsafeValue', detail }))
  };
};

const toCamelCase = (value: string) => value.startsWith('--') ? value : value.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());

const clampPxValues = (value: string) => value.replace(/(-?\d+(?:\.\d+)?)px/gi, (_match, numberValue: string) => {
  const parsed = Number.parseFloat(numberValue);
  if (!Number.isFinite(parsed)) return '0px';
  const clamped = Math.min(240, Math.max(-240, parsed));
  return `${clamped}px`;
});

const sanitizeValue = (property: string, rawValue: string) => {
  const value = clampPxValues(rawValue.trim().replace(/\s+/g, ' '));
  if (!value) return null;
  if (BLOCKED_VALUE_PATTERNS.some((pattern) => pattern.test(value))) return null;

  if (property === 'opacity') {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return null;
    return `${Math.min(1, Math.max(0, parsed))}`;
  }

  return value;
};

export const clampDecorationSize = (value: number, fallback = 160) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_DECORATION_SIZE, Math.max(MIN_DECORATION_SIZE, Math.round(value)));
};

export const compactDecorationCssForStorage = (cssText: string) => {
  const normalized = cssText
    .replace(/\r/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return '';

  const declarations = normalized
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);

  if (declarations.length === 0) return normalized;

  const hasTrailingSemicolon = /;\s*$/.test(normalized);
  return declarations
    .map((declaration, index) => {
      if (!hasTrailingSemicolon && index === declarations.length - 1) {
        return declaration;
      }
      return `${declaration};`;
    })
    .join(' ')
    .trim();
};

export const formatDecorationCssForEditor = (cssText: string) => {
  const compact = compactDecorationCssForStorage(cssText);
  if (!compact) return '';

  const declarations = compact
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);

  if (declarations.length === 0) return compact;

  const hasTrailingSemicolon = /;\s*$/.test(compact);
  return declarations
    .map((declaration, index) => {
      if (!hasTrailingSemicolon && index === declarations.length - 1) {
        return declaration;
      }
      return `${declaration};`;
    })
    .join('\n');
};

export const sanitizeDecorationCss = (cssText: string): DecorationSanitizeResult => {
  let trimmed = compactDecorationCssForStorage(cssText).trim();
  const issues: DecorationIssue[] = [];

  if (!trimmed) {
    issues.push({ code: 'empty' });
    return { cssText: '', style: {}, issues };
  }

  const parsed = sanitizeStaticCss(cssText);
  if (parsed.issues.length) {
    return { cssText: '', style: {}, issues: parsed.issues.map((detail) => ({ code: 'unsafeValue', detail })) };
  }

  if (trimmed.length > MAX_DECORATION_CSS_LENGTH) {
    issues.push({ code: 'tooLong' });
  }

  trimmed = compactDecorationCssForStorage(parsed.source).trim();

  if (/[{}]/.test(trimmed)) {
    issues.push({ code: 'invalidSyntax' });
  }

  const declarations = trimmed
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 24);

  if (declarations.length === 0) {
    issues.push({ code: 'noDeclarations' });
    return { cssText: '', style: {}, issues };
  }

  const style = typeof document !== 'undefined' ? document.createElement('div').style : null;
  const safeDeclarations: string[] = [];
  let ignoredDeclarations = 0;

  declarations.forEach((declaration) => {
    const separatorIndex = declaration.indexOf(':');
    if (separatorIndex === -1) {
      issues.push({ code: 'invalidSyntax', detail: declaration });
      return;
    }

    const rawProperty = declaration.slice(0, separatorIndex).trim();
    const property = rawProperty.startsWith('--') ? rawProperty : rawProperty.toLowerCase();
    const value = declaration.slice(separatorIndex + 1).trim();

    if (IGNORED_PROPERTIES.has(property) ||
      (property === 'height' && value === '100%') ||
      (property === 'margin' && /^(?:0(?:px|%)?\s*){1,4}$/i.test(value)) ||
      (property === 'box-sizing' && value.toLowerCase() === 'border-box')) {
      ignoredDeclarations++;
      return;
    }

    if (!ALLOWED_SET.has(property) && !/^--[a-z0-9-]+$/i.test(property)) {
      issues.push({ code: 'unsupportedProperty', detail: property });
      return;
    }

    const safeValue = sanitizeValue(property, value);
    if (!safeValue) {
      issues.push({ code: 'unsafeValue', detail: property });
      return;
    }

    safeDeclarations.push(`${property}: ${safeValue}`);
    style?.setProperty(property, safeValue);
  });

  if (safeDeclarations.length === 0 && ignoredDeclarations === 0) {
    issues.push({ code: 'noDeclarations' });
  }

  const nextStyle: CSSProperties = {};
  if (style) {
    [...ALLOWED_PROPERTIES, ...Array.from(style).filter((property) => property.startsWith('--'))].forEach((property) => {
      const value = style.getPropertyValue(property);
      if (!value) return;
      (nextStyle as Record<string, string>)[toCamelCase(property)] = value;
    });
  }

  return {
    cssText: safeDeclarations.length > 0 ? `${safeDeclarations.join('; ')};` : '',
    style: nextStyle,
    issues
  };
};

export const hasBlockingDecorationIssues = (issues: DecorationIssue[]) => {
  return issues.length > 0;
};

export const buildDecorationLayerStyle = (cssText: string): CSSProperties => {
  const { style } = sanitizeDecorationCss(cssText);
  return {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    ...style
  };
};