
import React, { useState, useEffect } from 'react';
import { CATEGORIZED_ASSETS, PRESET_COLORS, PRESET_GRADIENTS } from '../constants.ts';
import { BackgroundConfig, Layer } from '../types.ts';
import { translations, Language } from '../translations.ts';
import { Box, Palette, Search, Plus, Image as ImageIcon, PaintBucket, Grid, Trash2, Save, Upload, Sliders, X, Check, AlertCircle } from 'lucide-react';

interface SidebarProps {
  lang: Language;
  onAddLayer: (layer: Partial<Layer>) => void;
  onUpdateBackground: (bg: Partial<BackgroundConfig>) => void;
  background: BackgroundConfig;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ lang, onAddLayer, onUpdateBackground, background, activeTab, setActiveTab }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);
  const t = translations[lang];

  const [savedPresets, setSavedPresets] = useState<BackgroundConfig[]>(() => {
    try {
      const saved = localStorage.getItem('coverflow_bg_presets_v3');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  useEffect(() => {
    localStorage.setItem('coverflow_bg_presets_v3', JSON.stringify(savedPresets));
  }, [savedPresets]);

  const saveCurrentPreset = () => {
    setSavedPresets(prev => [JSON.parse(JSON.stringify(background)), ...prev]);
  };

  const confirmDeletePreset = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setDeletingIndex(index);
  };

  const executeDeletePreset = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setSavedPresets(prev => prev.filter((_, i) => i !== index));
    setDeletingIndex(null);
  };

  const handleTypeChange = (newType: 'color' | 'gradient' | 'image') => {
    let newValue = background.value;
    
    const hexMatch = newValue.match(/#[a-fA-F0-9]{3,6}/gi) || [];
    const isGradient = newValue.includes('gradient');
    const isImage = newValue.startsWith('http') || newValue.startsWith('data:');

    if (newType === 'color') {
      if (isGradient && hexMatch.length > 0) {
        newValue = hexMatch[0];
      } else if (isImage || !newValue.startsWith('#')) {
        newValue = '#1e293b'; 
      }
    } else if (newType === 'gradient') {
      if (!isGradient) {
        const start = hexMatch.length > 0 ? hexMatch[0] : '#3b82f6';
        const end = hexMatch.length > 1 ? hexMatch[1] : (start.toLowerCase() === '#ffffff' ? '#000000' : '#8b5cf6');
        newValue = `linear-gradient(135deg, ${start} 0%, ${end} 100%)`;
      }
    } else if (newType === 'image') {
       if (!isImage) {
         newValue = ''; 
       }
    }
    
    onUpdateBackground({ type: newType, value: newValue });
  };

  const getPreviewStyles = (bg: BackgroundConfig): React.CSSProperties => {
    const styles: React.CSSProperties = {};
    let baseBackground = '';
    if (bg.type === 'color') {
      styles.backgroundColor = bg.value;
    } else if (bg.type === 'gradient') {
      baseBackground = bg.value;
    } else if (bg.type === 'image') {
      baseBackground = `url(${bg.value})`;
      styles.backgroundSize = 'cover';
      styles.backgroundPosition = 'center';
    }

    let patternImage = '';
    let patternSize = '';
    if (bg.overlayType !== 'none') {
      const rgba = bg.overlayColor.startsWith('#') 
        ? `${bg.overlayColor}${Math.round(bg.overlayOpacity * 255).toString(16).padStart(2, '0')}` 
        : bg.overlayColor;
      const scale = bg.overlayScale || 20;
      if (bg.overlayType === 'dots') patternImage = `radial-gradient(${rgba} 2px, transparent 2px)`;
      else if (bg.overlayType === 'grid') patternImage = `linear-gradient(${rgba} 1px, transparent 1px), linear-gradient(90deg, ${rgba} 1px, transparent 1px)`;
      else if (bg.overlayType === 'stripes') patternImage = `repeating-linear-gradient(45deg, ${rgba}, ${rgba} 2px, transparent 2px, transparent ${scale/2}px)`;
      patternSize = `${scale/5}px ${scale/5}px`;
    }

    const backgroundImages: string[] = [];
    const backgroundSizes: string[] = [];
    if (patternImage) { backgroundImages.push(patternImage); backgroundSizes.push(patternSize); }
    if (baseBackground) { backgroundImages.push(baseBackground); backgroundSizes.push(bg.type === 'image' ? 'cover' : '100% 100%'); }

    if (backgroundImages.length > 0) {
      styles.backgroundImage = backgroundImages.join(', ');
      styles.backgroundSize = backgroundSizes.join(', ');
    }
    return styles;
  };

  const renderResources = () => (
    <div className="space-y-6">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
        <input
          type="text"
          placeholder={t.searchPlaceholder}
          className="w-full bg-slate-800 border border-slate-700 rounded-md py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-200"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-1 gap-6">
        {CATEGORIZED_ASSETS.map((cat) => (
          <div key={cat.category}>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              {lang === 'zh' ? (cat.categoryZh || cat.category) : cat.category}
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {cat.items.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase())).map((item) => (
                <button
                  key={item.name}
                  onClick={() => onAddLayer({ 
                    name: item.name, 
                    type: 'svg', 
                    content: item.content,
                    color: '#3b82f6'
                  })}
                  className="bg-slate-800 border border-slate-700 p-2 rounded hover:border-blue-500 transition-colors group flex flex-col items-center"
                >
                  <div className="w-full h-12 flex items-center justify-center mb-1">
                    <svg viewBox="0 0 100 100" className="w-full h-full text-slate-400 group-hover:text-blue-400 transition-colors" dangerouslySetInnerHTML={{ __html: item.content }} />
                  </div>
                  <span className="text-[10px] text-slate-400 truncate w-full text-center">{item.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderBackgroundSettings = () => {
    return (
      <div className="space-y-8 pb-6">
        <section className="space-y-4">
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">{t.backgroundStyle}</h3>
          <div className="flex bg-slate-800 p-1.5 rounded-xl border border-slate-700 gap-1">
            {[
              { id: 'color', icon: PaintBucket, title: t.bgTypeColor },
              { id: 'gradient', icon: Palette, title: t.bgTypeGradient },
              { id: 'image', icon: ImageIcon, title: t.bgTypeImage }
            ].map(item => (
              <button
                key={item.id}
                title={item.title}
                onClick={() => handleTypeChange(item.id as any)}
                className={`flex-1 flex items-center justify-center py-2.5 px-3 rounded-lg transition-all ${
                  background.type === item.id 
                    ? 'bg-blue-600 text-white shadow-lg' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                }`}
              >
                <item.icon className="w-5 h-5" />
              </button>
            ))}
          </div>

          <div className="space-y-4 pt-2">
            {background.type === 'color' && (
              <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex gap-2">
                  <input 
                    type="color" 
                    value={background.value.startsWith('#') && !background.value.includes('gradient') ? background.value : '#ffffff'} 
                    onChange={(e) => onUpdateBackground({ value: e.target.value })} 
                    className="w-16 h-10 rounded-lg bg-slate-900 border border-slate-700 cursor-pointer overflow-hidden p-0.5 flex-shrink-0" 
                  />
                  <input 
                    type="text" 
                    value={background.value} 
                    onChange={(e) => onUpdateBackground({ value: e.target.value })} 
                    className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-3 text-sm text-slate-200 font-mono focus:ring-1 focus:ring-blue-500 outline-none" 
                    placeholder="#FFFFFF" 
                  />
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {PRESET_COLORS.map(c => (
                    <button key={c} onClick={() => onUpdateBackground({ value: c })} className={`aspect-square rounded-lg border-2 transition-all hover:scale-110 ${background.value === c ? 'border-blue-500 shadow-md' : 'border-transparent'}`} style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
            )}

            {background.type === 'gradient' && (
              <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">{t.startColor}</span>
                    <input type="color" value={(background.value.match(/#[a-fA-F0-9]{3,6}/gi) || [])[0] || '#3b82f6'} onChange={(e) => {
                      const deg = (background.value.match(/(\d+)deg/) || [])[1] || 135;
                      const end = (background.value.match(/#[a-fA-F0-9]{3,6}/gi) || [])[1] || '#8b5cf6';
                      onUpdateBackground({ value: `linear-gradient(${deg}deg, ${e.target.value} 0%, ${end} 100%)` });
                    }} className="w-full h-8 rounded-lg bg-slate-900 border border-slate-700 cursor-pointer" />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">{t.endColor}</span>
                    <input type="color" value={(background.value.match(/#[a-fA-F0-9]{3,6}/gi) || [])[1] || '#8b5cf6'} onChange={(e) => {
                      const deg = (background.value.match(/(\d+)deg/) || [])[1] || 135;
                      const start = (background.value.match(/#[a-fA-F0-9]{3,6}/gi) || [])[0] || '#3b82f6';
                      onUpdateBackground({ value: `linear-gradient(${deg}deg, ${start} 0%, ${e.target.value} 100%)` });
                    }} className="w-full h-8 rounded-lg bg-slate-900 border border-slate-700 cursor-pointer" />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase"><span>{t.angle}</span><span>{(background.value.match(/(\d+)deg/) || [])[1] || '135'}°</span></div>
                  <input type="range" min="0" max="360" value={(background.value.match(/(\d+)deg/) || [])[1] || 135} onChange={(e) => {
                    const colors = background.value.match(/#[a-fA-F0-9]{3,6}/gi) || ['#3b82f6', '#8b5cf6'];
                    onUpdateBackground({ value: `linear-gradient(${e.target.value}deg, ${colors[0]} 0%, ${colors[1]} 100%)` });
                  }} className="w-full accent-blue-600" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {PRESET_GRADIENTS.map(g => (
                    <button key={g} onClick={() => onUpdateBackground({ value: g })} className="h-8 rounded-lg border border-slate-700 transition-all hover:border-slate-500" style={{ background: g }} />
                  ))}
                </div>
              </div>
            )}

            {background.type === 'image' && (
              <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-slate-700 rounded-xl cursor-pointer hover:bg-slate-800 transition-colors group">
                  <Upload className="w-6 h-6 text-slate-500 group-hover:text-blue-500 mb-2" />
                  <span className="text-[10px] text-slate-500 font-bold uppercase">{t.uploadImage}</span>
                  <input type="file" className="hidden" accept="image/*" onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (ev) => onUpdateBackground({ value: ev.target?.result as string });
                      reader.readAsDataURL(file);
                    }
                  }} />
                </label>
                <input type="text" value={background.value.startsWith('http') || background.value.startsWith('data:') ? background.value : ''} onChange={(e) => onUpdateBackground({ value: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:ring-1 focus:ring-blue-500 outline-none" placeholder="https://..." />
              </div>
            )}
          </div>
        </section>

        <section className="space-y-4 pt-4 border-t border-slate-800">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">{t.overlayType}</h3>
            {background.overlayType !== 'none' && (
              <button onClick={() => onUpdateBackground({ overlayType: 'none' })} className="text-[10px] font-bold text-red-400 hover:text-red-300 flex items-center gap-1">
                <X className="w-3 h-3" /> {t.none}
              </button>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { id: 'none', icon: X, label: t.none },
              { id: 'dots', icon: Grid, label: t.dots },
              { id: 'grid', icon: Grid, label: t.grid },
              { id: 'stripes', icon: Sliders, label: t.stripes }
            ].map(item => (
              <button
                key={item.id}
                onClick={() => onUpdateBackground({ overlayType: item.id as any })}
                className={`aspect-square flex flex-col items-center justify-center rounded-xl border-2 transition-all ${
                  background.overlayType === item.id 
                    ? 'bg-blue-600 border-blue-400 text-white shadow-lg' 
                    : 'bg-slate-800 border-slate-700 text-slate-500 hover:border-slate-500 hover:bg-slate-750'
                }`}
                title={item.label}
              >
                <item.icon className="w-5 h-5" />
              </button>
            ))}
          </div>

          {background.overlayType !== 'none' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase">{t.overlayColor}</span>
                <div className="flex gap-2">
                  <input type="color" value={background.overlayColor} onChange={(e) => onUpdateBackground({ overlayColor: e.target.value })} className="w-14 h-10 rounded-lg bg-slate-900 border border-slate-700 p-0.5 cursor-pointer flex-shrink-0" />
                  <input type="text" value={background.overlayColor} onChange={(e) => onUpdateBackground({ overlayColor: e.target.value })} className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono focus:ring-1 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase"><span>{t.opacity}</span><span>{Math.round(background.overlayOpacity * 100)}%</span></div>
                  <input type="range" min="0" max="1" step="0.01" value={background.overlayOpacity} onChange={(e) => onUpdateBackground({ overlayOpacity: parseFloat(e.target.value) })} className="w-full accent-blue-600" />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase"><span>{t.overlayScale}</span><span>{background.overlayScale}px</span></div>
                  <input type="range" min="5" max="100" step="1" value={background.overlayScale} onChange={(e) => onUpdateBackground({ overlayScale: parseInt(e.target.value) })} className="w-full accent-blue-600" />
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    );
  };

  return (
    <div className="w-80 flex bg-slate-900 border-r border-slate-800 flex-shrink-0 relative h-full">
      <div className="w-16 border-r border-slate-800 flex flex-col items-center py-6 gap-6 flex-shrink-0">
        <button 
          title={t.assets}
          onClick={() => setActiveTab('assets')} 
          className={`p-3 rounded-xl transition-all ${activeTab === 'assets' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'}`}
        >
          <Box className="w-6 h-6" />
        </button>
        <button 
          title={t.layout}
          onClick={() => setActiveTab('layout')} 
          className={`p-3 rounded-xl transition-all ${activeTab === 'layout' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'}`}
        >
          <Palette className="w-6 h-6" />
        </button>
      </div>

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <div className="p-6 pb-2 border-b border-slate-800/50">
          <h2 className="text-lg font-bold flex items-center gap-2 text-slate-100 uppercase tracking-tighter">
            {activeTab === 'assets' ? t.assets : t.layout}
          </h2>
        </div>
        
        <div className="flex-shrink-0 overflow-y-auto p-6 scrollbar-hide max-h-[500px]">
          {activeTab === 'assets' ? renderResources() : renderBackgroundSettings()}
        </div>

        {activeTab === 'layout' && (
          <div className="p-6 border-t border-slate-800 bg-slate-900/80 backdrop-blur-md flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.savedPresets}</h3>
              <button onClick={saveCurrentPreset} className="p-1.5 bg-blue-600/10 text-blue-400 hover:bg-blue-600 hover:text-white rounded-lg transition-all active:scale-95 flex items-center gap-1">
                <Save className="w-4 h-4" />
                <span className="text-[10px] font-bold">{t.savePreset}</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto pr-1 scrollbar-hide pb-10">
              {savedPresets.length === 0 ? (
                <div className="h-full min-h-[160px] flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-xl bg-slate-900/40">
                  <p className="text-[10px] text-slate-600 font-bold uppercase tracking-tighter">{t.noSavedPresets}</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {savedPresets.map((preset, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => onUpdateBackground(preset)}
                      className="group relative aspect-video rounded-xl border border-slate-700 cursor-pointer overflow-hidden transition-all hover:border-blue-500 hover:shadow-lg hover:shadow-blue-900/20"
                      style={getPreviewStyles(preset)}
                    >
                      {/* Delete Button - Top Right corner, smaller 'X' */}
                      <button 
                        onClick={(e) => confirmDeletePreset(e, idx)} 
                        className={`absolute top-1 right-1 p-1 bg-red-600/80 text-white rounded-full transition-all hover:bg-red-500 opacity-0 group-hover:opacity-100 ${deletingIndex === idx ? 'hidden' : 'block'}`}
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>

                      {/* Confirmation Overlay - Compact */}
                      {deletingIndex === idx && (
                        <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center animate-in fade-in duration-200 z-10">
                           <span className="text-[8px] font-black text-white uppercase mb-1 tracking-tighter">
                            {lang === 'zh' ? '确定删除？' : 'CONFIRM?'}
                           </span>
                           <div className="flex gap-1.5">
                             <button onClick={(e) => executeDeletePreset(e, idx)} className="p-1 bg-red-600 text-white rounded-md hover:bg-red-500 shadow-lg">
                               <Check className="w-3.5 h-3.5" />
                             </button>
                             <button onClick={(e) => { e.stopPropagation(); setDeletingIndex(null); }} className="p-1 bg-slate-700 text-white rounded-md hover:bg-slate-600">
                               <X className="w-3.5 h-3.5" />
                             </button>
                           </div>
                        </div>
                      )}
                      
                      {/* Badge for type */}
                      <div className="absolute bottom-1 right-1 px-1 py-0.5 bg-black/40 backdrop-blur-md rounded text-[7px] text-slate-300 font-black uppercase tracking-tighter">
                        {preset.type}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
