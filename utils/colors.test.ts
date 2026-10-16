import { describe, expect, it } from 'vitest';
import { detectColorFormat, formatColor, getColorChannels, parseColor, updateColorChannel } from './colors.ts';

describe('CSS color values', () => {
  it.each(['#16a3df', '#abc', '#1234', '#12345678', 'rgba(255,255,255,0.24)', 'rgb(30 80 120 / 40%)', 'hsl(210 50% 40% / 0.5)', 'oklch(0.6 0.12 230 / 0.7)', 'rebeccapurple', 'transparent'])('recognizes %s', (source) => {
    expect(parseColor(source)).not.toBeNull();
  });
  it.each(['24px', 'var(--accent)', 'linear-gradient(red,blue)', 'not-a-color', 'currentColor', ''])('leaves non-literal colors unchanged: %s', (source) => {
    expect(parseColor(source)).toBeNull();
    expect(formatColor(source, 'hex')).toBe('');
  });
  it('retains transparency across all supported formats', () => {
    const source = 'rgba(255,255,255,0.24)';
    for (const format of ['hex', 'rgb', 'hsl', 'oklch'] as const) {
      expect(parseColor(formatColor(source, format))!.a).toBeCloseTo(0.24, 2);
    }
    expect(formatColor(source, 'hex')).toBe('#ffffff3d');
  });
  it('recognizes format without rewriting its input', () => {
    expect(detectColorFormat('rgba(1,2,3,.5)')).toBe('rgb');
    expect(detectColorFormat('hsla(30,50%,50%,.5)')).toBe('hsl');
    expect(detectColorFormat('oklch(0.6 0.2 30)')).toBe('oklch');
    expect(detectColorFormat('#11223344')).toBe('hex');
  });
  it('keeps OKLCH coordinates when switching directly to OKLCH', () => {
    const source = 'oklch(0.7 0.3 30 / 0.5)';
    expect(formatColor(source, 'oklch')).toContain('0.3');
    expect(parseColor(formatColor(source, 'oklch'))!.a).toBe(0.5);
  });
  it('serializes picker channel changes with alpha', () => {
    expect(formatColor({ r: 255, g: 0, b: 128, a: 0.5 }, 'rgb')).toBe('rgba(255, 0, 128, 0.5)');
  });
  it('edits individual RGB, HSL, OKLCH and alpha channels', () => {
    expect(parseColor(updateColorChannel('rgba(255,0,0,.24)', 'rgb', 1, 128))!.g).toBe(128);
    expect(parseColor(updateColorChannel('#ffffff', 'hex', 0, 0.5))!.a).toBeCloseTo(0.5, 2);
    expect(getColorChannels(updateColorChannel('hsl(30 50% 50% / .3)', 'hsl', 0, 120), 'hsl')[0].value).toBeCloseTo(120);
    expect(getColorChannels(updateColorChannel('oklch(.6 .1 230 / .4)', 'oklch', 1, 0.2), 'oklch')[1].value).toBeCloseTo(0.2);
    expect(parseColor(updateColorChannel('oklch(.6 .1 230 / .4)', 'oklch', 3, 0.7))!.a).toBeCloseTo(0.7);
  });
  it('clamps numeric channels and ignores invalid updates', () => {
    expect(parseColor(updateColorChannel('#fff', 'rgb', 0, -30))!.r).toBe(0);
    expect(updateColorChannel('#fff', 'rgb', 0, Number.NaN)).toBe('#fff');
    expect(updateColorChannel('var(--x)', 'hex', 0, 1)).toBe('var(--x)');
  });
});