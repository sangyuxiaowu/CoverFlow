import { describe, expect, it } from 'vitest';
import { fontListItems, GOOGLE_FONTS, listFonts, normalizeFontDisplayName, normalizeLocalFonts } from './fonts.ts';
import { executeTool } from '../tools/execute.ts';
import type { WorkspaceBridge } from '../types.ts';

describe('managed font catalog', () => {
  it('normalizes display names and prioritizes local fonts by interface language', () => {
    expect(normalizeFontDisplayName('Example Sans 400 SemiBold Italic')).toBe('Example Sans');
    const fonts = [{ family: 'English Sans', fullName: 'English Sans Regular', styles: ['Regular'] },
      { family: 'Chinese Sans', fullName: '中文字体', styles: ['Regular'] }];
    expect(fontListItems(fonts).map(font => font.fullName)).toEqual(['中文字体', 'English Sans']);
    expect(fontListItems(fonts, '', 'en').map(font => font.fullName)).toEqual(['English Sans', '中文字体']);
    expect(fontListItems(fonts, '中文').map(font => font.family)).toEqual(['Chinese Sans']);
    expect(fontListItems(fonts, 'CHINESE').map(font => font.fullName)).toEqual(['中文字体']);
  });

  it('pins Google fonts before local fonts, deduplicates installed Google families and filters both sources', () => {
    const fonts = [{ family: 'Noto Sans SC', fullName: 'Noto Sans SC Regular', styles: ['Regular'] },
      { family: 'Demo', fullName: 'Demo', styles: ['Regular'] }];
    const items = fontListItems(fonts, '', 'zh', true);
    expect(items.slice(0, GOOGLE_FONTS.length).map(font => font.family)).toEqual(GOOGLE_FONTS.map(font => font.family));
    expect(items).toHaveLength(GOOGLE_FONTS.length + 1);
    expect(items[GOOGLE_FONTS.length].family).toBe('Demo');
    expect(fontListItems(fonts, '站酷', 'zh', true)).toHaveLength(3);
    expect(fontListItems(fonts, 'noto', 'en', true).map(font => font.fullName)).toEqual(['Noto Sans SC', 'Noto Serif SC']);
  });
  it('lists both sources without a project or local font permissions and rejects extra parameters', async () => {
    const bridge: WorkspaceBridge = { getProject: () => null, getSelection: () => [], commit: async () => {}, manageProjects: async () => {} };
    const selected = [{ family: 'Demo', fullName: 'Demo', styles: ['Regular'] }];
    const result = await executeTool('list_fonts', {}, bridge, new AbortController().signal, false, selected);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(listFonts(selected));
    await expect(executeTool('list_fonts', { path: 'C:/' }, bridge, new AbortController().signal)).rejects.toThrow('does not accept parameters');
    const controller = new AbortController();
    controller.abort();
    await expect(executeTool('list_fonts', {}, bridge, controller.signal)).rejects.toThrow();
  });
  it('returns the curated catalog and only explicitly selected local fonts', () => {
    const selected = [{ family: 'Example Font', fullName: '示例字体', styles: ['Regular', 'Bold'] }];
    const fonts = listFonts(selected);
    expect(fonts.filter(font => font.source === 'google')).toHaveLength(9);
    expect(fonts.filter(font => font.source === 'local')).toEqual([{
      family: 'Example Font', name: '示例字体', source: 'local', description: ''
    }]);
    for (const font of fonts) {
      expect(Object.keys(font).sort()).toEqual(['family', 'name', 'source', 'description'].sort());
    }
    expect(listFonts().every(font => font.source === 'google')).toBe(true);
    expect(GOOGLE_FONTS.every(font => font.license === 'OFL-1.1' && font.weights?.includes(400))).toBe(true);
  });

  it('offers three English display fonts without classifying them as Chinese or exposing internal weights', () => {
    const families = ['Bebas Neue', 'Montserrat', 'Playfair Display'];
    const items = fontListItems([], '', 'zh', true).filter(font => families.includes(font.family));
    expect(items.map(font => font.family)).toEqual(families);
    expect(items.every(font => !font.isChinese)).toBe(true);
    expect(fontListItems([], 'montserrat', 'en', true).map(font => font.family)).toEqual(['Montserrat']);
    const entries = listFonts().filter(font => families.includes(font.family));
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(entry.description).toContain('不含中文字形');
      expect(Object.keys(entry).sort()).toEqual(['family', 'name', 'source', 'description'].sort());
    }
  });

  it('normalizes selected metadata without retaining font binaries or extra fields', () => {
    expect(normalizeLocalFonts([{ family: ' Demo ', fullName: ' Demo ', styles: ['Regular', 'Regular'], blob: 'private' }]))
      .toEqual([{ family: 'Demo', fullName: 'Demo', styles: ['Regular'] }]);
    expect(normalizeLocalFonts(undefined)).toEqual([]);
  });

  it('returns only user-provided local descriptions and preserves curated descriptions', () => {
    const font = { family: 'Demo', fullName: 'Demo', styles: ['Regular'], description: '  适合科技标题  ' };
    expect(normalizeLocalFonts([font])[0].description).toBe('适合科技标题');
    expect(listFonts([font])[0].description).toBe('适合科技标题');
    expect(listFonts([{ ...font, description: '   ' }])[0].description).toBe('');
    expect(listFonts().map(item => item.description)).toEqual(GOOGLE_FONTS.map(item => item.description));
    expect(() => normalizeLocalFonts([{ ...font, description: 42 }])).toThrow('Font description');
    expect(() => normalizeLocalFonts([{ ...font, description: 'a'.repeat(1001) }])).toThrow('Font description');
  });

  it('rejects invalid, duplicate and oversized selections', () => {
    const font = { family: 'Demo', fullName: 'Demo', styles: ['Regular'] };
    for (const value of [null, {}, [null], [{ ...font, family: '\nDemo' }], [{ ...font, styles: [1] }], [font, { ...font, family: 'demo' }], Array(101).fill(font)]) {
      expect(() => normalizeLocalFonts(value)).toThrow();
    }
  });
});