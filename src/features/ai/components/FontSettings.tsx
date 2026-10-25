import React, { useState } from 'react';
import { Check, Download, Plus, Search, Trash2, Type } from 'lucide-react';
import { fontListItems, GOOGLE_FONTS, readInstalledFonts, type LocalFontSelection } from '../services/fonts.ts';

interface Props {
  fonts: LocalFontSelection[];
  onChange: (fonts: LocalFontSelection[]) => void;
  english: boolean;
}

export default function FontSettings({ fonts, onChange, english }: Props) {
  const [installed, setInstalled] = useState<LocalFontSelection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const label = (zh: string, en: string) => english ? en : zh;
  const selected = new Set(fonts.map(font => font.family.toLowerCase()));
  const matches = fontListItems(installed, query, english ? 'en' : 'zh');
  const iconButton = 'p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed shrink-0';

  const read = async () => {
    setBusy(true);
    setError('');
    try {
      setInstalled(await readInstalledFonts());
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  return <section className="space-y-4 border-t border-slate-800 pt-5" aria-label={label('字体管理', 'Font Management')}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-100"><Type size={16} className="text-blue-400" />{label('字体管理', 'Font Management')}</h3>
      <button type="button" onClick={read} disabled={busy} className="flex items-center gap-2 rounded px-3 py-1.5 text-xs bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-50">
        <Download size={14} />{busy ? label('读取中…', 'Reading…') : label('读取本机字体', 'Read Installed Fonts')}
      </button>
    </div>
    <p className="text-xs text-amber-300/90 leading-relaxed">{label(
      '加入的本地字体名称会提供给 AI；字体文件不会上传。字体使用及商用版权风险由用户自行承担，换设备后可能不可用。',
      'Selected local font names are shared with AI; font files are not uploaded. You are responsible for usage rights and commercial licensing. Fonts may be unavailable on other devices.'
    )}</p>
    {error && <p role="alert" className="text-xs text-rose-300 break-words">{error}</p>}
    <div>
      <h4 className="text-xs font-semibold text-slate-300 mb-2">{label('已选本地字体', 'Selected Local Fonts')} ({fonts.length}/100)</h4>
      {!fonts.length && <p className="text-xs text-slate-500 py-2">{label('暂无已选本地字体', 'No local fonts selected')}</p>}
      <ul className="divide-y divide-slate-800 max-h-48 overflow-y-auto">
        {fonts.map(font => <li key={font.family} className="flex items-center justify-between gap-2 py-2 text-xs">
          <div className="min-w-0 flex-1">
            <span className="text-slate-200 break-words">{font.fullName}</span><span className="block text-slate-500 break-words">{font.family}</span>
            <label className="block mt-2 space-y-1">
              <span className="text-slate-500">{label('字体介绍（可选）', 'Description (optional)')}</span>
              <textarea aria-label={label(`字体介绍 ${font.family}`, `Font description ${font.family}`)} rows={2} maxLength={1000}
                value={font.description ?? ''} onChange={event => onChange(fonts.map(item => item.family === font.family ? { ...item, description: event.target.value } : item))}
                className="block w-full min-w-0 max-h-32 resize-y rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:border-blue-500 outline-none" />
            </label>
          </div>
          <button type="button" title={label(`移除 ${font.family}`, `Remove ${font.family}`)} aria-label={label(`移除 ${font.family}`, `Remove ${font.family}`)} className={`${iconButton} self-start`}
            onClick={() => onChange(fonts.filter(item => item.family !== font.family))}><Trash2 size={14} /></button>
        </li>)}
      </ul>
    </div>
    {loaded && <div className="space-y-2">
      <label htmlFor="ai-font-search" className="text-xs text-slate-300">{label('搜索本机字体', 'Search Installed Fonts')}</label>
      <div className="relative"><Search size={14} className="absolute top-2.5 left-2.5 text-slate-500" />
        <input id="ai-font-search" value={query} onChange={event => setQuery(event.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded py-2 pl-8 pr-3 text-xs text-slate-200" />
      </div>
      <ul className="max-h-56 overflow-y-auto divide-y divide-slate-800">
        {matches.map(font => <li key={font.family} className="flex items-center justify-between gap-2 py-2 text-xs">
          <span className="text-slate-300 break-words min-w-0" style={{ fontFamily: font.value }}>{font.fullName}</span>
          <button type="button" title={label(`加入 ${font.family}`, `Add ${font.family}`)} aria-label={label(`加入 ${font.family}`, `Add ${font.family}`)}
            disabled={selected.has(font.family.toLowerCase()) || fonts.length >= 100} className={iconButton}
            onClick={() => onChange([...fonts, { family: font.family, fullName: font.fullName, styles: font.styles }])}>
            {selected.has(font.family.toLowerCase()) ? <Check size={14} /> : <Plus size={14} />}
          </button>
        </li>)}
      </ul>
      {!matches.length && <p className="text-xs text-slate-500">{label('没有匹配的字体', 'No matching fonts')}</p>}
    </div>}
    <div>
      <h4 className="text-xs font-semibold text-slate-300 mb-2">Google Fonts · {label('内置精选', 'Curated Fonts')}</h4>
      <p className="text-xs text-slate-500 mb-2">{label('OFL 开源许可，可商用；首次使用需要连接 Google Fonts。', 'OFL licensed for commercial use; first use requires access to Google Fonts.')}</p>
      <ul className="divide-y divide-slate-800">
        {GOOGLE_FONTS.map(font => <li key={font.family} className="py-2 text-xs">
          <div className="flex flex-wrap justify-between gap-1"><span className="text-slate-200">{font.name}</span><span className="text-slate-500">OFL-1.1</span></div>
          <p className="text-slate-500 mt-1">{english ? font.family : font.description}</p>
        </li>)}
      </ul>
    </div>
  </section>;
}