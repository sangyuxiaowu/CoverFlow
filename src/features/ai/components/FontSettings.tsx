import React, { useState, useMemo, useEffect } from 'react';
import {
  Check,
  Download,
  Plus,
  Search,
  Trash2,
  Type,
  Sparkles,
  RefreshCw,
  Info,
  X,
  FolderPlus
} from 'lucide-react';
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
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [fontFilter, setFontFilter] = useState<'all' | 'chinese' | 'western'>('all');

  const label = (zh: string, en: string) => (english ? en : zh);
  const selected = useMemo(() => new Set(fonts.map(font => font.family.toLowerCase())), [fonts]);

  // 加载 Google Fonts 外部字体文件以确保字体名称以真实字形渲染
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const linkId = 'coverflow-google-fonts-catalog';
    if (document.getElementById(linkId)) return;
    const link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Ma+Shan+Zheng&family=Montserrat:wght@400;700&family=Noto+Sans+SC:wght@400;700&family=Noto+Serif+SC:wght@400;700&family=Playfair+Display:wght@400;700&family=ZCOOL+KuaiLe&family=ZCOOL+QingKe+HuangYou&family=ZCOOL+XiaoWei&display=swap';
    document.head.appendChild(link);
  }, []);

  // 获取本机字体匹配项
  const allMatches = useMemo(() => {
    return fontListItems(installed, query, english ? 'en' : 'zh');
  }, [installed, query, english]);

  // 根据语言过滤中/西文
  const matches = useMemo(() => {
    if (fontFilter === 'all') return allMatches;
    if (fontFilter === 'chinese') return allMatches.filter(item => item.isChinese);
    return allMatches.filter(item => !item.isChinese);
  }, [allMatches, fontFilter]);

  // 读取本机字体并展开添加面板
  const handleToggleFontPanel = async () => {
    setError('');
    // 如果已经加载过，直接切换展开/收起
    if (loaded && installed.length > 0) {
      setIsPanelOpen(prev => !prev);
      return;
    }
    // 首次读取
    setBusy(true);
    try {
      const items = await readInstalledFonts();
      setInstalled(items);
      setLoaded(true);
      setIsPanelOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  // 重新扫描本机字体
  const handleRescan = async () => {
    setBusy(true);
    setError('');
    try {
      const items = await readInstalledFonts();
      setInstalled(items);
      setLoaded(true);
      setIsPanelOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="p-5 sm:p-6 rounded-2xl border border-slate-800/80 bg-slate-900/40 backdrop-blur-sm space-y-6 shadow-sm"
      aria-label={label('字体管理', 'Font Management')}
    >
      {/* 顶部标题与唯一操作按钮 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/10 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0 shadow-inner">
            <Type size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span>{label('字体资源与排版管理', 'Font & Typography Management')}</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/25 font-semibold">
                {fonts.length}/100 {label('已添加', 'Selected')}
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
              {label(
                '管理提供给 AI 封面助手的本地系统字体与开源字体，AI 将在设计时智能挑选最佳字体搭配。',
                'Manage local and open-source fonts for the AI assistant to recommend for article covers.'
              )}
            </p>
          </div>
        </div>

        {/* 唯一的读取/管理本机字体入口 */}
        <button
          type="button"
          onClick={handleToggleFontPanel}
          disabled={busy}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold shadow-md transition-all cursor-pointer shrink-0 ${
            isPanelOpen
              ? 'bg-slate-800 hover:bg-slate-750 text-blue-300 border border-blue-500/30 shadow-blue-950/20'
              : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-900/25'
          } disabled:opacity-50`}
        >
          {busy ? (
            <RefreshCw size={14} className="animate-spin text-blue-200" />
          ) : (
            <Download size={14} className="text-blue-200" />
          )}
          <span>
            {busy
              ? label('读取中…', 'Reading…')
              : isPanelOpen
              ? label('收起字体库', 'Collapse Fonts')
              : label('读取本机字体', 'Read Installed Fonts')}
          </span>
        </button>
      </div>

      {/* 版权与隐私提示卡片 */}
      <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3 text-xs text-amber-200/90 leading-relaxed shadow-sm">
        <Info size={16} className="text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300/90 leading-relaxed">
          {label(
            '加入的本地字体名称会提供给 AI；字体文件不会上传。字体使用及商用版权风险由用户自行承担，换设备后可能不可用。',
            'Selected local font names are shared with AI; font files are not uploaded. You are responsible for usage rights and commercial licensing. Fonts may be unavailable on other devices.'
          )}
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300 break-words flex items-center gap-2"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 内嵌展开式字体选择面板（避免弹窗套弹窗，高度适中控制在卡片内） */}
      {isPanelOpen && (
        <div className="p-4 sm:p-5 rounded-2xl border border-blue-500/35 bg-slate-950/85 shadow-lg space-y-4 animate-in fade-in-50 duration-200">
          {/* 面板头部 */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0">
                <FolderPlus size={16} />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white flex items-center gap-2">
                  <span>{label('选择并添加本机字体', 'Select and Add Installed Fonts')}</span>
                  <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    {matches.length} {label('款匹配', 'matched')}
                  </span>
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {label('从系统扫描到的字体中勾选，即可加入 AI 助手的可选字体列表。', 'Click to add fonts from your local system to the AI assistant catalog.')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleRescan}
                disabled={busy}
                title={label('重新扫描本机字体', 'Rescan installed fonts')}
                className="p-1.5 rounded-lg bg-slate-850 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
              </button>
              <button
                type="button"
                onClick={() => setIsPanelOpen(false)}
                className="p-1.5 rounded-lg bg-slate-850 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title={label('收起', 'Close')}
                aria-label={label('收起', 'Close')}
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* 搜索与分类栏 */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute top-3 left-3 text-slate-500" />
              <input
                id="ai-font-search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={label('按字体名称、拼音或英文搜索...', 'Search by font family name...')}
                className="w-full bg-slate-900/90 border border-slate-800 focus:border-blue-500 rounded-xl py-2 pl-9 pr-8 text-xs text-slate-200 placeholder:text-slate-600 outline-none transition-all shadow-inner"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1 text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-900 border border-slate-800 text-xs shrink-0 self-end sm:self-center">
              <button
                type="button"
                onClick={() => setFontFilter('all')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                  fontFilter === 'all' ? 'bg-blue-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label('全部', 'All')}
              </button>
              <button
                type="button"
                onClick={() => setFontFilter('chinese')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                  fontFilter === 'chinese' ? 'bg-blue-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label('中文字体', 'Chinese')}
              </button>
              <button
                type="button"
                onClick={() => setFontFilter('western')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                  fontFilter === 'western' ? 'bg-blue-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label('西文字体', 'Western')}
              </button>
            </div>
          </div>

          {/* 紧凑高度可滚动的字体列表 */}
          <div className="max-h-56 overflow-y-auto custom-scrollbar rounded-xl border border-slate-800/80 bg-slate-900/40">
            <ul className="divide-y divide-slate-800/70">
              {matches.map(font => {
                const isSelected = selected.has(font.family.toLowerCase());
                return (
                  <li
                    key={font.family}
                    className="p-3 text-xs hover:bg-slate-900/70 transition-colors space-y-1"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className="text-slate-200 break-words min-w-0 font-medium text-xs truncate flex-1"
                        style={{ fontFamily: font.value }}
                        title={font.fullName}
                      >
                        {font.fullName}
                      </span>

                      <button
                        type="button"
                        title={label(`加入 ${font.family}`, `Add ${font.family}`)}
                        aria-label={label(`加入 ${font.family}`, `Add ${font.family}`)}
                        disabled={isSelected || fonts.length >= 100}
                        onClick={() =>
                          onChange([...fonts, { family: font.family, fullName: font.fullName, styles: font.styles }])
                        }
                        className={`p-1.5 rounded-lg flex items-center justify-center transition-all shrink-0 cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 opacity-80 cursor-default'
                            : 'bg-slate-800 hover:bg-blue-600 text-slate-300 hover:text-white border border-slate-700/60'
                        }`}
                      >
                        {isSelected ? <Check size={14} /> : <Plus size={14} />}
                      </button>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                      <span className="truncate">{font.family}</span>
                      {font.styles?.length > 0 && <span>{font.styles.length} {label('种样式', 'styles')}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>

            {!matches.length && (
              <p className="text-xs text-slate-500 text-center py-6 bg-slate-950/20">
                {label('没有匹配的字体', 'No matching fonts')}
              </p>
            )}
          </div>

          {/* 面板底部状态与收起 */}
          <div className="pt-2 flex items-center justify-between border-t border-slate-800/80">
            <span className="text-[11px] font-mono text-slate-400">
              {label(`已选 ${fonts.length} / 100 款字体`, `${fonts.length} / 100 fonts selected`)}
            </span>
            <button
              type="button"
              onClick={() => setIsPanelOpen(false)}
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-750 transition-colors cursor-pointer"
            >
              {label('完成收起', 'Done')}
            </button>
          </div>
        </div>
      )}

      {/* 已选本地字体列表（一行 2 个卡片排列） */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
              <span>{label('已选本地字体', 'Selected Local Fonts')}</span>
              <span className="text-[11px] font-mono font-medium text-slate-400">({fonts.length}/100)</span>
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {label('可为每款字体填写适用风格，辅助 AI 助手在构图排版时做出精准推荐。', 'Add notes describing the ideal design contexts for each font.')}
            </p>
          </div>
        </div>

        {!fonts.length ? (
          /* 空状态：仅展示引导说明，无重复入口按钮 */
          <div className="p-8 rounded-xl border border-dashed border-slate-800 bg-slate-950/30 text-center space-y-2">
            <Type size={22} className="mx-auto text-slate-600" />
            <p className="text-xs text-slate-300 font-medium">
              {label('暂无已选本地字体', 'No local fonts selected')}
            </p>
            <p className="text-[11px] text-slate-500 max-w-sm mx-auto leading-relaxed">
              {label(
                '点击上方“读取本机字体”按钮，在字体库中选择并添加您的系统字体。',
                'Click "Read Installed Fonts" above to scan and select from your system.'
              )}
            </p>
          </div>
        ) : (
          /* 一行 2 个排列 (grid-cols-1 md:grid-cols-2) */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 max-h-[520px] overflow-y-auto custom-scrollbar pr-1">
            {fonts.map(font => (
              <div
                key={font.family}
                className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/90 hover:border-slate-700/80 transition-all space-y-3 group shadow-sm flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-base font-bold text-slate-100 break-words leading-tight" style={{ fontFamily: `${JSON.stringify(font.family)}, sans-serif` }}>
                        {font.fullName}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                          {font.family}
                        </span>
                        {font.styles?.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300/80 border border-blue-500/20 font-mono">
                            {font.styles.length} {label('种样式', 'styles')}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 移除按钮 */}
                    <button
                      type="button"
                      title={label(`移除 ${font.family}`, `Remove ${font.family}`)}
                      aria-label={label(`移除 ${font.family}`, `Remove ${font.family}`)}
                      onClick={() => onChange(fonts.filter(item => item.family !== font.family))}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer shrink-0"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* 字体介绍/使用建议 */}
                <div className="pt-2 border-t border-slate-800/60">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-medium text-slate-400">
                      {label('字体介绍（可选）', 'Description (optional)')}
                    </span>
                    <span className="text-[10px] font-mono text-slate-600">
                      {(font.description ?? '').length}/1000
                    </span>
                  </div>
                  <textarea
                    aria-label={label(`字体介绍 ${font.family}`, `Font description ${font.family}`)}
                    rows={2}
                    maxLength={1000}
                    placeholder={label(
                      '例如：适合科技大标题、国风书法手写感、优雅正文排版...',
                      'e.g. Best suited for high-impact tech titles, minimalist subheadings...'
                    )}
                    value={font.description ?? ''}
                    onChange={event =>
                      onChange(
                        fonts.map(item =>
                          item.family === font.family ? { ...item, description: event.target.value } : item
                        )
                      )
                    }
                    className="block w-full min-w-0 resize-y rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-blue-500 outline-none transition-all custom-scrollbar"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 内置 Google Fonts 专区 */}
      <div className="space-y-3.5 pt-4 border-t border-slate-800/80">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="space-y-0.5">
            <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
              <Sparkles size={15} className="text-blue-400" />
              <span>Google Fonts · {label('内置精选推荐', 'Curated Fonts')}</span>
            </h4>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {label(
                'OFL 开源许可，可商用；首次使用需要连接 Google Fonts。',
                'OFL licensed for commercial use; first use requires access to Google Fonts.'
              )}
            </p>
          </div>
          <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 shrink-0 self-start sm:self-center">
            SIL Open Font License 1.1
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {GOOGLE_FONTS.map(font => (
            <div
              key={font.family}
              className="p-4 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-950/60 hover:bg-slate-900/60 transition-all space-y-3 flex flex-col justify-between shadow-sm"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-base text-slate-100 font-medium truncate"
                    style={{ fontFamily: font.fontFamily }}
                    title={font.name}
                  >
                    {font.name}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-850 text-slate-400 border border-slate-800 shrink-0">
                    OFL-1.1
                  </span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  {english ? font.family : font.description}
                </p>
              </div>

              <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                <span>{font.fontFamily.split(',')[0].replace(/"/g, '')}</span>
                <span>{font.weights?.length || 1} {label('字重', 'weights')}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}