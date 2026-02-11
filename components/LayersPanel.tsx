
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Layer, ProjectState } from '../types.ts';
import { translations, Language } from '../translations.ts';
import { TEXT_GRADIENT_PRESETS } from '../constants.ts';
import { 
  Eye, EyeOff, Lock, Unlock, Trash2, Hash, RotateCw, Maximize2, 
  Type as TextIcon, Image as ImageIcon, GripVertical, Link as LinkIcon, Link2Off, MoveHorizontal, MoveVertical,
  Palette, Sliders, AlignLeft, AlignCenter, AlignRight, Type, Search, ChevronDown, Check
} from 'lucide-react';

interface LayersPanelProps {
  lang: Language;
  project: ProjectState;
  onUpdateLayer: (id: string, updates: Partial<Layer>, record?: boolean) => void;
  onDeleteLayer: (id: string) => void;
  onSelectLayer: (id: string | null) => void;
  onReorderLayers: (newLayers: Layer[]) => void;
  onCommit: () => void;
}

interface LocalFont {
  fullName: string;
  family: string;
  isChinese: boolean;
  value: string;
}

const COMMON_FONTS = [
  { name: 'Inter', value: 'Inter, sans-serif' },
  { name: 'System UI', value: 'system-ui, sans-serif' },
  { name: 'PingFang SC', value: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif' },
  { name: 'Microsoft YaHei', value: '"Microsoft YaHei", sans-serif' },
  { name: 'Noto Sans SC', value: '"Noto Sans SC", sans-serif' },
  { name: 'Serif', value: 'serif' },
  { name: 'Monospace', value: 'monospace' },
  { name: 'Arial', value: 'Arial, sans-serif' },
  { name: 'Georgia', value: 'Georgia, serif' },
  { name: 'Impact', value: 'Impact, sans-serif' }
];

const FONT_WEIGHTS = [
  { label: 'Thin', value: 100 },
  { label: 'Light', value: 300 },
  { label: 'Regular', value: 400 },
  { label: 'Medium', value: 500 },
  { label: 'SemiBold', value: 600 },
  { label: 'Bold', value: 700 },
  { label: 'Black', value: 900 }
];

const isChineseText = (text: string) => /[\u4e00-\u9fa5]/.test(text);

const LayersPanel: React.FC<LayersPanelProps> = ({ lang, project, onUpdateLayer, onDeleteLayer, onSelectLayer, onReorderLayers, onCommit }) => {
  const selectedLayer = project.layers.find(l => l.id === project.selectedLayerId);
  const t = translations[lang];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  
  // Font related states
  const [localFonts, setLocalFonts] = useState<LocalFont[]>([]);
  const [fontSearch, setFontSearch] = useState("");
  const [isFontPickerOpen, setIsFontPickerOpen] = useState(false);
  const fontPickerRef = useRef<HTMLDivElement>(null);

  const latestSelectedLayerRef = useRef(selectedLayer);
  const onUpdateLayerRef = useRef(onUpdateLayer);
  const scrubbingRef = useRef<{ prop: string, startValue: number, startX: number } | null>(null);

  useEffect(() => {
    latestSelectedLayerRef.current = selectedLayer;
    onUpdateLayerRef.current = onUpdateLayer;
  }, [selectedLayer, onUpdateLayer]);

  // Load Local Fonts
  useEffect(() => {
    const fetchLocalFonts = async () => {
      if ('queryLocalFonts' in window) {
        try {
          // @ts-ignore
          const fonts: any[] = await (window as any).queryLocalFonts();
          
          // Deduplicate and group
          // Usually we want to show unique full names for selection, 
          // but apply the family name for CSS to handle weights/styles separately via other props
          const seenFullNames = new Set<string>();
          const processed: LocalFont[] = [];

          for (const f of fonts) {
            if (!seenFullNames.has(f.fullName)) {
              seenFullNames.add(f.fullName);
              const isChinese = isChineseText(f.fullName) || isChineseText(f.family);
              processed.push({
                fullName: f.fullName,
                family: f.family,
                isChinese,
                value: `"${f.family}", sans-serif`
              });
            }
          }
          setLocalFonts(processed);
        } catch (e) {
          console.warn("Failed to fetch local fonts", e);
        }
      }
    };
    fetchLocalFonts();
  }, []);

  // Close font picker on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (fontPickerRef.current && !fontPickerRef.current.contains(event.target as Node)) {
        setIsFontPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleScrubMove = useCallback((e: MouseEvent) => {
    if (!scrubbingRef.current || !latestSelectedLayerRef.current) return;
    const delta = (e.clientX - scrubbingRef.current.startX);
    const sensitivity = scrubbingRef.current.prop === 'rotation' ? 0.5 : 1;
    const multiplier = scrubbingRef.current.prop === 'opacity' ? 0.01 : 1;
    const newValue = scrubbingRef.current.startValue + (delta * sensitivity * multiplier);
    
    let finalValue = Math.round(newValue);
    if (scrubbingRef.current.prop === 'opacity') {
      finalValue = Math.min(Math.max(0, newValue), 1);
      onUpdateLayerRef.current(latestSelectedLayerRef.current.id, { opacity: finalValue }, false);
    } else {
      onUpdateLayerRef.current(latestSelectedLayerRef.current.id, { [scrubbingRef.current.prop]: finalValue }, false);
    }
  }, []);

  const handleScrubMouseUp = useCallback(() => {
    scrubbingRef.current = null;
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', handleScrubMove);
    window.removeEventListener('mouseup', handleScrubMouseUp);
    onCommit(); 
  }, [handleScrubMove, onCommit]);

  const handleScrubMouseDown = (e: React.MouseEvent, prop: string, startValue: number) => {
    e.preventDefault();
    scrubbingRef.current = { prop, startValue, startX: e.clientX };
    document.body.style.cursor = 'ew-resize';
    window.addEventListener('mousemove', handleScrubMove);
    window.addEventListener('mouseup', handleScrubMouseUp);
  };

  const handleDelete = (e: React.MouseEvent | React.TouchEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    onDeleteLayer(id);
  };

  const preventDragInterference = (e: React.PointerEvent | React.MouseEvent) => {
    e.stopPropagation();
  };

  const sortedLayers = [...project.layers].sort((a, b) => b.zIndex - a.zIndex);

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setEditValue(name);
  };

  const commitRename = (id: string) => {
    if (editValue.trim()) onUpdateLayer(id, { name: editValue.trim() }, true);
    setEditingId(null);
  };

  const handleToggleGradient = () => {
    if (!selectedLayer || selectedLayer.type !== 'text') return;
    const current = selectedLayer.textGradient || { enabled: false, from: '#3b82f6', to: '#8b5cf6', angle: 90 };
    onUpdateLayer(selectedLayer.id, {
      textGradient: { ...current, enabled: !current.enabled }
    });
  };

  const handleUpdateTextGradient = (updates: any) => {
    if (!selectedLayer || selectedLayer.type !== 'text') return;
    const current = selectedLayer.textGradient || { enabled: false, from: '#3b82f6', to: '#8b5cf6', angle: 90 };
    onUpdateLayer(selectedLayer.id, {
      textGradient: { ...current, ...updates }
    });
  };

  const availableFonts = useMemo(() => {
    const baseList = localFonts.length > 0 
      ? localFonts 
      : COMMON_FONTS.map(f => ({ fullName: f.name, family: f.name, isChinese: isChineseText(f.name), value: f.value }));
    
    const filtered = fontSearch 
      ? baseList.filter(f => f.fullName.toLowerCase().includes(fontSearch.toLowerCase()) || f.family.toLowerCase().includes(fontSearch.toLowerCase())) 
      : baseList;

    const chinese = filtered.filter(f => f.isChinese).sort((a, b) => a.fullName.localeCompare(b.fullName, 'zh'));
    const western = filtered.filter(f => !f.isChinese).sort((a, b) => a.fullName.localeCompare(b.fullName, 'en'));

    // Adjust display priority based on current language
    return lang === 'zh' ? [...chinese, ...western] : [...western, ...chinese];
  }, [localFonts, fontSearch, lang]);

  const currentFontDisplayName = useMemo(() => {
    if (!selectedLayer || selectedLayer.type !== 'text') return '';
    const val = selectedLayer.fontFamily || 'Inter, sans-serif';
    // Try to find in local fonts by value (family name wrapper)
    const foundLocal = localFonts.find(f => f.value === val);
    if (foundLocal) return foundLocal.fullName;
    
    // Try to find in common fonts
    const foundCommon = COMMON_FONTS.find(f => f.value === val);
    if (foundCommon) return foundCommon.name;

    // Fallback: clean the string
    return val.replace(/"/g, '').split(',')[0];
  }, [selectedLayer, localFonts]);

  return (
    <div className="w-72 bg-slate-900 border-l border-slate-800 flex flex-col flex-shrink-0 shadow-2xl relative z-20 h-full">
      {/* Property Inspector Section */}
      <div className="h-[65%] flex flex-col border-b border-slate-800">
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800/50 bg-slate-900 flex-shrink-0">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t.inspector}</h3>
          {selectedLayer && (
            <button 
              type="button"
              onClick={(e) => handleDelete(e, selectedLayer.id)} 
              className="p-1.5 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide">
          {selectedLayer ? (
            <div className="space-y-6">
              {/* Row 1: X & Y */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <label onMouseDown={(e) => handleScrubMouseDown(e, 'x', selectedLayer.x)} className="flex items-center gap-1 w-7 flex-shrink-0 text-[10px] text-slate-500 font-bold cursor-ew-resize hover:text-blue-400 select-none">
                    <MoveHorizontal className="w-3 h-3"/> X
                  </label>
                  <input type="number" value={Math.round(selectedLayer.x)} onChange={(e) => onUpdateLayer(selectedLayer.id, { x: parseInt(e.target.value)||0 })} className="bg-slate-800/50 rounded-md px-2 py-1.5 w-full text-[11px] text-slate-200 border border-slate-700/50 focus:border-blue-500 outline-none transition-colors" />
                </div>
                <div className="flex items-center gap-2">
                  <label onMouseDown={(e) => handleScrubMouseDown(e, 'y', selectedLayer.y)} className="flex items-center gap-1 w-7 flex-shrink-0 text-[10px] text-slate-500 font-bold cursor-ew-resize hover:text-blue-400 select-none">
                    <MoveVertical className="w-3 h-3"/> Y
                  </label>
                  <input type="number" value={Math.round(selectedLayer.y)} onChange={(e) => onUpdateLayer(selectedLayer.id, { y: parseInt(e.target.value)||0 })} className="bg-slate-800/50 rounded-md px-2 py-1.5 w-full text-[11px] text-slate-200 border border-slate-700/50 focus:border-blue-500 outline-none transition-colors" />
                </div>
              </div>

              {/* Row 2: W & H */}
              <div className="relative pb-4">
                <div className="grid grid-cols-2 gap-3 relative z-10">
                   <div className="flex items-center gap-2">
                    <label onMouseDown={(e) => handleScrubMouseDown(e, 'width', selectedLayer.width)} className="flex items-center gap-1 w-7 flex-shrink-0 text-[10px] text-slate-500 font-bold cursor-ew-resize hover:text-blue-400 select-none">
                      <Maximize2 className="w-3 h-3"/> W
                    </label>
                    <input type="number" id="input-width" value={Math.round(selectedLayer.width)} onChange={(e) => onUpdateLayer(selectedLayer.id, { width: parseInt(e.target.value)||0 })} className="bg-slate-800/50 rounded-md px-2 py-1.5 w-full text-[11px] text-slate-200 border border-slate-700/50 focus:border-blue-500 outline-none transition-colors" />
                  </div>
                  <div className="flex items-center gap-2">
                    <label onMouseDown={(e) => handleScrubMouseDown(e, 'height', selectedLayer.height)} className="flex items-center gap-1 w-7 flex-shrink-0 text-[10px] text-slate-500 font-bold cursor-ew-resize hover:text-blue-400 select-none">
                      <Maximize2 className="w-3 h-3"/> H
                    </label>
                    <input type="number" id="input-height" value={Math.round(selectedLayer.height)} onChange={(e) => onUpdateLayer(selectedLayer.id, { height: parseInt(e.target.value)||0 })} className="bg-slate-800/50 rounded-md px-2 py-1.5 w-full text-[11px] text-slate-200 border border-slate-700/50 focus:border-blue-500 outline-none transition-colors" />
                  </div>
                </div>
                <div className="absolute left-[38px] right-[10px] top-[26px] bottom-[-2px] pointer-events-none border-l border-r border-b border-slate-700/60 rounded-b-lg">
                  <div className="absolute left-1/2 bottom-[-8px] -translate-x-1/2 pointer-events-auto">
                    <button 
                      onClick={() => onUpdateLayer(selectedLayer.id, { ratioLocked: !selectedLayer.ratioLocked }, true)}
                      className={`p-1 rounded bg-slate-900 border transition-all hover:scale-110 active:scale-95 ${selectedLayer.ratioLocked ? 'border-blue-500 text-blue-500' : 'border-slate-700 text-slate-600'}`}
                      title="Proportional Scaling"
                    >
                       {selectedLayer.ratioLocked ? <LinkIcon className="w-2.5 h-2.5" /> : <Link2Off className="w-2.5 h-2.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Row 3: Rotation, Size, and Opacity */}
              <div className={`grid ${selectedLayer.type === 'text' ? 'grid-cols-3' : 'grid-cols-2'} gap-3`}>
                <div className="space-y-1.5">
                  <label onMouseDown={(e) => handleScrubMouseDown(e, 'rotation', selectedLayer.rotation)} className="flex items-center gap-1 text-[9px] text-slate-500 font-black uppercase cursor-ew-resize hover:text-blue-400 select-none truncate">
                    <RotateCw className="w-2.5 h-2.5"/> {lang === 'zh' ? '旋转' : 'Rot'}
                  </label>
                  <input type="number" value={selectedLayer.rotation} onChange={(e) => onUpdateLayer(selectedLayer.id, { rotation: parseInt(e.target.value)||0 })} className="bg-slate-800/50 rounded-md px-2 py-1.5 w-full text-[11px] text-slate-200 border border-slate-700/50 focus:border-blue-500 outline-none transition-colors" />
                </div>
                {selectedLayer.type === 'text' && (
                  <div className="space-y-1.5">
                    <label onMouseDown={(e) => handleScrubMouseDown(e, 'fontSize', selectedLayer.fontSize || 48)} className="flex items-center gap-1 text-[9px] text-slate-500 font-black uppercase cursor-ew-resize hover:text-blue-400 select-none truncate">
                      <Type className="w-2.5 h-2.5"/> {lang === 'zh' ? '字号' : 'Size'}
                    </label>
                    <input type="number" value={selectedLayer.fontSize || 48} onChange={(e) => onUpdateLayer(selectedLayer.id, { fontSize: parseInt(e.target.value)||0 })} className="bg-slate-800/50 rounded-md px-2 py-1.5 w-full text-[11px] text-slate-200 border border-slate-700/50 focus:border-blue-500 outline-none transition-colors" />
                  </div>
                )}
                <div className="space-y-1.5">
                  <label onMouseDown={(e) => handleScrubMouseDown(e, 'opacity', selectedLayer.opacity)} className="flex items-center gap-1 text-[9px] text-slate-500 font-black uppercase cursor-ew-resize hover:text-blue-400 select-none truncate">
                    <Sliders className="w-2.5 h-2.5"/> {lang === 'zh' ? '透明' : 'Opac'}
                  </label>
                  <input type="number" value={Math.round(selectedLayer.opacity * 100)} onChange={(e) => onUpdateLayer(selectedLayer.id, { opacity: Math.min(Math.max(0, parseInt(e.target.value)||0), 100) / 100 })} className="bg-slate-800/50 rounded-md px-2 py-1.5 w-full text-[11px] text-slate-200 border border-slate-700/50 focus:border-blue-500 outline-none transition-colors" />
                </div>
              </div>

              {/* Text Specific Property Group */}
              {selectedLayer.type === 'text' && (
                <div className="space-y-5 pt-4 border-t border-slate-800/80">
                  {/* Font Family (Searchable Dropdown) & Weight Row */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{t.fontFamily}</label>
                      <div className="relative" ref={fontPickerRef}>
                        <button 
                          onClick={() => setIsFontPickerOpen(!isFontPickerOpen)}
                          className="w-full bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-[11px] text-slate-200 focus:border-blue-500 outline-none transition-colors text-left flex items-center justify-between"
                        >
                          <span className="truncate">{currentFontDisplayName}</span>
                          <ChevronDown className="w-3 h-3 opacity-50" />
                        </button>
                        
                        {isFontPickerOpen && (
                          <div className="absolute top-full left-0 w-64 mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-[100] flex flex-col max-h-80 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                            <div className="p-2 border-b border-slate-800 flex items-center gap-2">
                              <Search className="w-3.5 h-3.5 text-slate-500" />
                              <input 
                                autoFocus
                                type="text"
                                placeholder={lang === 'zh' ? "搜索字体..." : "Search fonts..."}
                                value={fontSearch}
                                onChange={(e) => setFontSearch(e.target.value)}
                                className="bg-transparent border-none outline-none text-[11px] w-full text-slate-200 placeholder-slate-600"
                              />
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-1">
                              {availableFonts.length > 0 ? (
                                availableFonts.map(f => (
                                  <button
                                    key={`${f.value}-${f.fullName}`}
                                    onClick={() => {
                                      onUpdateLayer(selectedLayer.id, { fontFamily: f.value });
                                      setIsFontPickerOpen(false);
                                      setFontSearch("");
                                    }}
                                    className={`w-full text-left px-3 py-2 rounded-md flex items-center justify-between text-[11px] hover:bg-slate-800 transition-colors ${selectedLayer.fontFamily === f.value ? 'bg-blue-600/20 text-blue-400' : 'text-slate-400'}`}
                                  >
                                    <span style={{ fontFamily: f.value }}>{f.fullName}</span>
                                    {selectedLayer.fontFamily === f.value && <Check className="w-3 h-3" />}
                                  </button>
                                ))
                              ) : (
                                <div className="p-4 text-center text-[10px] text-slate-600 uppercase font-bold italic">{lang === 'zh' ? '未找到字体' : 'No fonts found'}</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{t.fontWeight}</label>
                      <select 
                        value={selectedLayer.fontWeight || 700} 
                        onChange={(e) => onUpdateLayer(selectedLayer.id, { fontWeight: parseInt(e.target.value) || e.target.value })}
                        className="w-full bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-[11px] text-slate-200 focus:border-blue-500 outline-none transition-colors"
                      >
                        {FONT_WEIGHTS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Text Direction Row */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{t.textDirection}</label>
                    <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700 gap-1">
                      <button 
                        onClick={() => onUpdateLayer(selectedLayer.id, { writingMode: 'horizontal' })}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded text-[10px] font-bold transition-all ${selectedLayer.writingMode !== 'vertical' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        <MoveHorizontal className="w-3 h-3" /> {t.horizontal}
                      </button>
                      <button 
                        onClick={() => onUpdateLayer(selectedLayer.id, { writingMode: 'vertical' })}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded text-[10px] font-bold transition-all ${selectedLayer.writingMode === 'vertical' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        <MoveVertical className="w-3 h-3" /> {t.vertical}
                      </button>
                    </div>
                  </div>

                  {/* Text Content */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{t.textContent}</label>
                    <textarea 
                      value={selectedLayer.content} 
                      onChange={(e) => onUpdateLayer(selectedLayer.id, { content: e.target.value })} 
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-xs min-h-[60px] text-slate-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none transition-all shadow-inner"
                    />
                  </div>

                  {/* Gradient Settings */}
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5"><Palette className="w-3 h-3" /> {t.textGradient}</h4>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" checked={selectedLayer.textGradient?.enabled || false} onChange={handleToggleGradient} />
                        <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>

                    {selectedLayer.textGradient?.enabled ? (
                      <div className="space-y-3 animate-in fade-in duration-200">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <label className="text-[8px] text-slate-500 uppercase font-bold">{t.startColor}</label>
                            <input type="color" value={selectedLayer.textGradient.from} onChange={(e) => handleUpdateTextGradient({ from: e.target.value })} className="w-full h-8 rounded-lg bg-slate-900 border border-slate-700 cursor-pointer p-0.5" />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[8px] text-slate-500 uppercase font-bold">{t.endColor}</label>
                            <input type="color" value={selectedLayer.textGradient.to} onChange={(e) => handleUpdateTextGradient({ to: e.target.value })} className="w-full h-8 rounded-lg bg-slate-900 border border-slate-700 cursor-pointer p-0.5" />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-[8px] text-slate-500 uppercase font-bold"><span>{t.angle}</span><span>{selectedLayer.textGradient.angle}°</span></div>
                          <input type="range" min="0" max="360" value={selectedLayer.textGradient.angle} onChange={(e) => handleUpdateTextGradient({ angle: parseInt(e.target.value) })} onMouseUp={onCommit} className="w-full accent-blue-600 h-3" />
                        </div>
                        <div className="grid grid-cols-5 gap-1 pt-1">
                          {TEXT_GRADIENT_PRESETS.slice(0, 10).map((p, idx) => (
                            <button key={idx} onClick={() => handleUpdateTextGradient({ from: p.from, to: p.to, angle: p.angle })} className="h-5 rounded-sm border border-slate-700 hover:border-blue-500 transition-transform hover:scale-110" style={{ background: `linear-gradient(${p.angle}deg, ${p.from}, ${p.to})` }} />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5 animate-in fade-in duration-200">
                        <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{t.primaryColor}</label>
                        <div className="flex gap-2">
                          <input type="color" value={selectedLayer.color || '#3b82f6'} onChange={(e) => onUpdateLayer(selectedLayer.id, { color: e.target.value })} className="h-8 w-8 bg-slate-900 border border-slate-700 cursor-pointer rounded-md p-1" />
                          <input type="text" value={selectedLayer.color || '#3b82f6'} onChange={(e) => onUpdateLayer(selectedLayer.id, { color: e.target.value })} className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-[11px] text-slate-200 font-mono focus:border-blue-500 outline-none" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Shared Primary Color Picker for SVG only */}
              {selectedLayer.type === 'svg' && (
                <div className="space-y-2 pt-3 border-t border-slate-800">
                  <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{t.primaryColor}</label>
                  <div className="flex gap-2">
                    <input type="color" value={selectedLayer.color || '#3b82f6'} onChange={(e) => onUpdateLayer(selectedLayer.id, { color: e.target.value })} className="h-8 w-8 bg-slate-900 border border-slate-700 cursor-pointer rounded-md p-1" />
                    <input type="text" value={selectedLayer.color || '#3b82f6'} onChange={(e) => onUpdateLayer(selectedLayer.id, { color: e.target.value })} className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-[11px] text-slate-200 font-mono focus:border-blue-500 outline-none" />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-600 text-center gap-3">
               <Hash className="w-10 h-10 opacity-20" />
               <p className="text-[10px] px-8 leading-relaxed font-bold uppercase tracking-widest">{t.emptyInspector}</p>
            </div>
          )}
        </div>
      </div>

      {/* Layers Section */}
      <div className="flex-1 flex flex-col min-h-0 bg-slate-900/50">
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800/50 bg-slate-900 flex-shrink-0">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t.layers}</h3>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-hide">
          {sortedLayers.map((layer, index) => (
            <div
              key={layer.id}
              draggable
              onDragStart={(e) => { setDraggedIndex(index); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => { e.preventDefault(); setDragOverIndex(index); }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedIndex !== null && draggedIndex !== index) {
                  const newSorted = [...sortedLayers];
                  const [removed] = newSorted.splice(draggedIndex, 1);
                  newSorted.splice(index, 0, removed);
                  onReorderLayers([...newSorted].reverse());
                }
                setDraggedIndex(null); setDragOverIndex(null);
              }}
              onDragEnd={() => { setDraggedIndex(null); setDragOverIndex(null); }}
              onClick={() => onSelectLayer(layer.id)}
              className={`group relative flex items-center gap-2.5 p-2 rounded-md cursor-pointer transition-all ${
                project.selectedLayerId === layer.id ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-slate-800 text-slate-400'
              } ${draggedIndex === index ? 'opacity-40' : ''} ${dragOverIndex === index && draggedIndex !== index ? 'border-t-2 border-blue-400' : ''}`}
            >
              <div className="cursor-grab p-0.5 opacity-0 group-hover:opacity-100" onMouseDown={preventDragInterference}><GripVertical className="w-3 h-3"/></div>
              <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                {layer.type === 'text' ? (
                   <TextIcon className="w-3 h-3" /> 
                ) : layer.type === 'image' ? (
                   <ImageIcon className="w-3 h-3" /> 
                ) : (
                   <div className="w-3.5 h-3.5 flex items-center justify-center overflow-hidden">
                     {layer.content.toLowerCase().includes('<svg') ? (
                        <div className="w-full h-full" dangerouslySetInnerHTML={{__html: layer.content}} />
                     ) : (
                        <svg viewBox="0 0 100 100" className="w-full h-full" dangerouslySetInnerHTML={{__html: layer.content}} />
                     )}
                   </div>
                )}
              </div>
              <div className="flex-1 min-w-0" onDoubleClick={() => startRename(layer.id, layer.name)}>
                {editingId === layer.id ? (
                  <input autoFocus className="bg-slate-800 w-full px-1 py-0.5 rounded text-[11px] text-white" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={() => commitRename(layer.id)} onKeyDown={(e) => e.key === 'Enter' && commitRename(layer.id)} />
                ) : (
                  <span className="block text-[11px] truncate font-medium">{layer.name}</span>
                )}
              </div>
              <div className={`flex gap-0.5 ${project.selectedLayerId === layer.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                 <button type="button" onClick={(e) => { e.stopPropagation(); onUpdateLayer(layer.id, { visible: !layer.visible }); }} className="p-0.5 hover:text-white transition-colors">
                   {layer.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                 </button>
                 <button type="button" onClick={(e) => { e.stopPropagation(); onUpdateLayer(layer.id, { locked: !layer.locked }); }} className="p-0.5 hover:text-white transition-colors">
                   {layer.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                 </button>
                 <button type="button" onClick={(e) => handleDelete(e, layer.id)} className="p-0.5 text-slate-400 hover:text-red-400 transition-colors">
                    <Trash2 className="w-3 h-3" />
                 </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LayersPanel;
