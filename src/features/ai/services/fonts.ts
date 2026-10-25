export interface LocalFontSelection {
  family: string;
  fullName: string;
  styles: string[];
  description?: string;
}

export interface FontListItem extends LocalFontSelection {
  value: string;
  isChinese: boolean;
  source: 'local' | 'google';
}

export function normalizeFontDisplayName(fullName: string): string {
  const weightTokens = new Set(['bold', 'heavy', 'light', 'regular', 'medium', 'black', 'thin', 'semibold',
    'demibold', 'extrabold', 'extralight', 'ultralight', 'book', 'italic', 'oblique']);
  const tokens = fullName.split(' ').filter(token => token && !/^\d+$/.test(token));
  while (tokens.length > 0 && weightTokens.has(tokens[tokens.length - 1].toLowerCase())) tokens.pop();
  return tokens.join(' ').trim() || fullName;
}

export function fontListItems(localFonts: LocalFontSelection[], query = '', language: 'zh' | 'en' = 'zh', includeGoogle = false): FontListItem[] {
  const isChinese = (value: string) => /[\u4e00-\u9fa5]/.test(value);
  const search = query.trim().toLowerCase();
  const matches = (font: FontListItem) => font.fullName.toLowerCase().includes(search) || font.family.toLowerCase().includes(search);
  const google: FontListItem[] = includeGoogle ? GOOGLE_FONTS.map(font => ({ family: font.family,
    fullName: language === 'zh' ? font.name : font.family, styles: [], value: font.fontFamily, isChinese: isChinese(font.name), source: 'google' })) : [];
  const googleFamilies = new Set(google.map(font => font.family.toLowerCase()));
  const local: FontListItem[] = localFonts.filter(font => !googleFamilies.has(font.family.toLowerCase())).map<FontListItem>(font => ({ ...font,
    fullName: normalizeFontDisplayName(font.fullName), value: `${JSON.stringify(font.family)}, sans-serif`,
    isChinese: isChinese(font.fullName) || isChinese(font.family), source: 'local' })).filter(matches);
  const chinese = local.filter(font => font.isChinese).sort((left, right) => left.fullName.localeCompare(right.fullName, 'zh'));
  const western = local.filter(font => !font.isChinese).sort((left, right) => left.fullName.localeCompare(right.fullName, 'en'));
  return [...google.filter(matches), ...(language === 'zh' ? [...chinese, ...western] : [...western, ...chinese])];
}

export interface ManagedFont {
  family: string;
  name: string;
  source: 'local' | 'google';
  fontFamily: string;
  styles?: string[];
  weights?: number[];
  description: string;
  license: string;
}

export type FontToolEntry = Pick<ManagedFont, 'family' | 'name' | 'source' | 'description'>;

export const GOOGLE_FONTS: ManagedFont[] = [
  { family: 'Noto Sans SC', name: '思源黑体 · Noto Sans SC', weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], description: '简体中文，通用、科技、商务标题', source: 'google', fontFamily: '"Noto Sans SC", sans-serif', license: 'OFL-1.1' },
  { family: 'Noto Serif SC', name: '思源宋体 · Noto Serif SC', weights: [200, 300, 400, 500, 600, 700, 800, 900], description: '简体中文，文化、出版、正式专题', source: 'google', fontFamily: '"Noto Serif SC", serif', license: 'OFL-1.1' },
  { family: 'ZCOOL KuaiLe', name: '站酷快乐体', weights: [400], description: '简体中文，趣味、活动、年轻化标题', source: 'google', fontFamily: '"ZCOOL KuaiLe", sans-serif', license: 'OFL-1.1' },
  { family: 'ZCOOL QingKe HuangYou', name: '站酷庆科黄油体', weights: [400], description: '简体中文，醒目、促销标题', source: 'google', fontFamily: '"ZCOOL QingKe HuangYou", sans-serif', license: 'OFL-1.1' },
  { family: 'ZCOOL XiaoWei', name: '站酷小薇体', weights: [400], description: '简体中文，文艺、复古标题', source: 'google', fontFamily: '"ZCOOL XiaoWei", serif', license: 'OFL-1.1' },
  { family: 'Ma Shan Zheng', name: '马善政楷书', weights: [400], description: '简体中文，国风、书法标题', source: 'google', fontFamily: '"Ma Shan Zheng", cursive', license: 'OFL-1.1' },
  { family: 'Bebas Neue', name: 'Bebas Neue', weights: [400], description: '英文，窄体大写展示字，适合海报、运动、醒目大标题，不含中文字形', source: 'google', fontFamily: '"Bebas Neue", sans-serif', license: 'OFL-1.1' },
  { family: 'Montserrat', name: 'Montserrat', weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], description: '英文，几何无衬线，适合品牌、科技、商务标题，不含中文字形', source: 'google', fontFamily: '"Montserrat", sans-serif', license: 'OFL-1.1' },
  { family: 'Playfair Display', name: 'Playfair Display', weights: [400, 500, 600, 700, 800, 900], description: '英文，高对比衬线，适合杂志、时尚、文化专题标题，不含中文字形', source: 'google', fontFamily: '"Playfair Display", serif', license: 'OFL-1.1' }
];

export function normalizeLocalFonts(value: unknown): LocalFontSelection[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error('Select at most 100 local fonts.');
  const seen = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Invalid local font.');
    const { family, fullName, styles, description } = item as LocalFontSelection;
    if (typeof family !== 'string' || !family.trim() || family.length > 200 || /[\u0000-\u001f\u007f]/.test(family)) throw new Error('Invalid font family.');
    if (typeof fullName !== 'string' || !fullName.trim() || fullName.length > 200) throw new Error('Invalid font name.');
    if (!Array.isArray(styles) || styles.length > 100 || styles.some(style => typeof style !== 'string' || style.length > 100)) throw new Error('Invalid font styles.');
    if (description !== undefined && (typeof description !== 'string' || description.length > 1000)) throw new Error('Font description must contain at most 1000 characters.');
    const key = family.trim().toLowerCase();
    if (seen.has(key)) throw new Error('Duplicate local font: ' + family);
    seen.add(key);
    return { family: family.trim(), fullName: fullName.trim(), styles: [...new Set(styles)],
      ...(description !== undefined ? { description: description.trim() } : {}) };
  });
}

export function listFonts(selected: LocalFontSelection[] = []): FontToolEntry[] {
  return [
    ...normalizeLocalFonts(selected).map(font => ({ family: font.family, name: font.fullName,
      source: 'local' as const, description: font.description ?? '' })),
    ...GOOGLE_FONTS.map(font => ({ family: font.family, name: font.name, source: font.source,
      description: font.description }))
  ];
}

export async function readInstalledFonts(): Promise<LocalFontSelection[]> {
  const api = window as Window & { queryLocalFonts?: () => Promise<Array<{ family: string; fullName: string; style: string }>> };
  if (!api.queryLocalFonts) throw new Error('当前环境不支持读取本地字体，请使用桌面版 Chrome / Edge。');
  const faces = await api.queryLocalFonts();
  const families = new Map<string, LocalFontSelection>();
  for (const face of faces) {
    const font = families.get(face.family) ?? { family: face.family, fullName: normalizeFontDisplayName(face.fullName), styles: [] };
    if (!font.styles.includes(face.style)) font.styles.push(face.style);
    families.set(face.family, font);
  }
  return [...families.values()].sort((left, right) => left.family.localeCompare(right.family));
}