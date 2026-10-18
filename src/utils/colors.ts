import { converter, formatCss, formatHex, formatHex8, formatHsl, formatRgb, parse } from 'culori';
import type { RgbaColor } from 'react-colorful';

export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'oklch';

const toRgb = converter('rgb');
const toHsl = converter('hsl');
const toOklch = converter('oklch');
const clamp = (value: number, maximum = 1) => Math.max(0, Math.min(maximum, value));

export const parseColor = (source: string): RgbaColor | null => {
  const parsed = parse(source.trim());
  if (!parsed) return null;
  const rgb = toRgb(parsed);
  if (![rgb.r, rgb.g, rgb.b, rgb.alpha ?? 1].every(Number.isFinite)) return null;
  return {
    r: Math.round(clamp(rgb.r) * 255),
    g: Math.round(clamp(rgb.g) * 255),
    b: Math.round(clamp(rgb.b) * 255),
    a: clamp(rgb.alpha ?? 1)
  };
};

export const detectColorFormat = (source: string): ColorFormat => {
  const value = source.trim().toLowerCase();
  if (value.startsWith('oklch(')) return 'oklch';
  if (/^hsla?\(/.test(value)) return 'hsl';
  if (/^rgba?\(/.test(value)) return 'rgb';
  return 'hex';
};

export const formatColor = (source: string | RgbaColor, format: ColorFormat): string => {
  const parsed = typeof source === 'string' ? parse(source.trim()) : {
    mode: 'rgb' as const,
    r: clamp(source.r, 255) / 255,
    g: clamp(source.g, 255) / 255,
    b: clamp(source.b, 255) / 255,
    alpha: clamp(source.a)
  };
  if (!parsed) return '';
  if (format === 'oklch') return formatCss(toOklch(parsed));
  if (format === 'hsl') return formatHsl(parsed);
  if (format === 'rgb') return formatRgb(parsed);
  return (parsed.alpha ?? 1) < 1 ? formatHex8(parsed) : formatHex(parsed);
};

export interface ColorChannel {
  label: string;
  value: number;
  max: number;
  step: number;
}

export const getColorChannels = (source: string, format: ColorFormat): ColorChannel[] => {
  const parsed = parse(source);
  if (!parsed) return [];
  const alpha = { label: 'A', value: parsed.alpha ?? 1, max: 1, step: 0.01 };
  if (format === 'hex') return [alpha];
  if (format === 'rgb') {
    const rgb = toRgb(parsed);
    return [rgb.r, rgb.g, rgb.b].map((value, index) => ({ label: ['R', 'G', 'B'][index], value: Math.round(clamp(value) * 255), max: 255, step: 1 })).concat(alpha);
  }
  if (format === 'hsl') {
    const hsl = toHsl(parsed);
    return [
      { label: 'H', value: hsl.h ?? 0, max: 360, step: 1 },
      { label: 'S', value: hsl.s * 100, max: 100, step: 0.1 },
      { label: 'L', value: hsl.l * 100, max: 100, step: 0.1 }, alpha
    ];
  }
  const oklch = toOklch(parsed);
  return [
    { label: 'L', value: oklch.l, max: 1, step: 0.001 },
    { label: 'C', value: oklch.c, max: 1, step: 0.001 },
    { label: 'H', value: oklch.h ?? 0, max: 360, step: 1 }, alpha
  ];
};

export const updateColorChannel = (source: string, format: ColorFormat, index: number, value: number): string => {
  const parsed = parse(source);
  const channel = getColorChannels(source, format)[index];
  if (!parsed || !channel || !Number.isFinite(value)) return source;
  const next = clamp(value, channel.max);
  if (channel.label === 'A') return formatColor(formatCss({ ...parsed, alpha: next }), format);
  if (format === 'rgb') {
    const rgb = toRgb(parsed);
    return formatColor(formatCss({ ...rgb, [['r', 'g', 'b'][index]]: next / 255 }), format);
  }
  if (format === 'hsl') {
    return formatColor(formatCss({ ...toHsl(parsed), [['h', 's', 'l'][index]]: index === 0 ? next : next / 100 }), format);
  }
  return formatColor(formatCss({ ...toOklch(parsed), [['l', 'c', 'h'][index]]: next }), format);
};