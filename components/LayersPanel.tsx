
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Layer, ProjectState } from '../types.ts';
import { translations, Language } from '../translations.ts';
import { TEXT_GRADIENT_PRESETS } from '../constants.ts';
import { 
  Eye, EyeOff, Lock, Unlock, Trash2, Hash, RotateCw, Maximize2, 
  Type as TextIcon, Image as ImageIcon, GripVertical, Link as LinkIcon, Link2Off, MoveHorizontal, MoveVertical,
  Palette
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

const LayersPanel: React.FC<LayersPanelProps> = ({ lang, project, onUpdateLayer, onDeleteLayer, onSelectLayer, onReorderLayers, onCommit }) => {
  const selectedLayer = project.layers.find(l => l.id === project.selectedLayerId);
  const t = translations[lang];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const latestSelectedLayerRef = useRef(selectedLayer);
  const onUpdateLayerRef = useRef(onUpdateLayer);
  const scrubbingRef = useRef<{ prop: string, startValue: number, startX: number } | null>(null);

  useEffect(() => {
    latestSelectedLayerRef.current = selectedLayer;
    onUpdateLayerRef.current = onUpdateLayer;
  }, [selectedLayer, onUpdateLayer]);

  const handleScrubMove = useCallback((e: MouseEvent) => {
    if (!scrubbingRef.current || !latestSelectedLayerRef.current) return;
    const delta = (e.clientX - scrubbingRef.current.startX);
    const sensitivity = scrubbingRef.current.prop === 'rotation' ? 0.5 : 1;
    const newValue = scrubbingRef.current.startValue + (delta * sensitivity);
    onUpdateLayerRef.current(latestSelectedLayerRef.current.id, { [scrubbingRef.current.prop]: Math.round(newValue) }, false);
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

  return (
    <div className="w-72 bg-slate-900 border-l border-slate-800 flex flex-col flex-shrink-0 shadow-2xl relative z-20 h-full">
      <div className="h-[55%] flex flex-col border-b border-slate-800">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/50 bg-slate-900 flex-shrink-0">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t.inspector}</h3>
          {selectedLayer && (
            <button 
              type="button"
              onClick={(e) => handleDelete(e, selectedLayer.id)} 
              className="p-1.5 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
              title={t.confirmDelete}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
          {selectedLayer ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label onMouseDown={(e) => handleScrubMouseDown(e, 'x', selectedLayer.x)} className="text-[10px] text-slate-500 uppercase flex items-center gap-1 cursor-ew-resize hover:text-blue-400 select-none"><MoveHorizontal className="w-3 h-3"/> {t.posX}</label>
                <input type="number" value={Math.round(selectedLayer.x)} onChange={(e) => onUpdateLayer(selectedLayer.id, { x: parseInt(e.target.value)||0 })} className="bg-slate-800 rounded px-2 py-1.5 w-full text-xs text-slate-200 border border-slate-700 focus:outline-none" />
              </div>
              <div className="space-y-2">
                <label onMouseDown={(e) => handleScrubMouseDown(e, 'y', selectedLayer.y)} className="text-[10px] text-slate-500 uppercase flex items-center gap-1 cursor-ew-resize hover:text-blue-400 select-none"><MoveVertical className="w-3 h-3"/> {t.posY}</label>
                <input type="number" value={Math.round(selectedLayer.y)} onChange={(e) => onUpdateLayer(selectedLayer.id, { y: parseInt(e.target.value)||0 })} className="bg-slate-800 rounded px-2 py-1.5 w-full text-xs text-slate-200 border border-slate-700 focus:outline-none" />
              </div>
              <div className="space-y-2">
                <label onMouseDown={(e) => handleScrubMouseDown(e, 'width', selectedLayer.width)} className="text-[10px] text-slate-500 uppercase flex items-center gap-1 cursor-ew-resize hover:text-blue-400 select-none"><Maximize2 className="w-3 h-3"/> W</label>
                <input type="number" value={Math.round(selectedLayer.width)} onChange={(e) => onUpdateLayer(selectedLayer.id, { width: parseInt(e.target.value)||0 })} className="bg-slate-800 rounded px-2 py-1.5 w-full text-xs text-slate-200 border border-slate-700 focus:outline-none" />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                   <label onMouseDown={(e) => handleScrubMouseDown(e, 'height', selectedLayer.height)} className="text-[10px] text-slate-500 uppercase flex items-center gap-1 cursor-ew-resize hover:text-blue-400 select-none"><Maximize2 className="w-3 h-3"/> H</label>
                   <button 
                    onClick={() => onUpdateLayer(selectedLayer.id, { ratioLocked: !selectedLayer.ratioLocked }, true)}
                    className={`p-0.5 rounded transition-colors ${selectedLayer.ratioLocked ? 'text-blue-500' : 'text-slate-600'}`}
                    title="Lock Ratio"
                   >
                     {selectedLayer.ratioLocked ? <LinkIcon className="w-3 h-3" /> : <Link2Off className="w-3 h-3" />}
                   </button>
                </div>
                <input type="number" value={Math.round(selectedLayer.height)} onChange={(e) => onUpdateLayer(selectedLayer.id, { height: parseInt(e.target.value)||0 })} className="bg-slate-800 rounded px-2 py-1.5 w-full text-xs text-slate-200 border border-slate-700 focus:outline-none" />
              </div>

              <div className="space-y-2">
                <label onMouseDown={(e) => handleScrubMouseDown(e, 'rotation', selectedLayer.rotation)} className="text-[10px] text-slate-500 uppercase flex items-center gap-1 cursor-ew-resize hover:text-blue-400 select-none"><RotateCw className="w-3 h-3"/> {t.rotation}</label>
                <input type="number" value={selectedLayer.rotation} onChange={(e) => onUpdateLayer(selectedLayer.id, { rotation: parseInt(e.target.value)||0 })} className="bg-slate-800 rounded px-2 py-1.5 w-full text-xs text-slate-200 border border-slate-700 focus:outline-none" />
              </div>
              
              {selectedLayer.type === 'text' && (
                <div className="space-y-2">
                  <label onMouseDown={(e) => handleScrubMouseDown(e, 'fontSize', selectedLayer.fontSize || 48)} className="text-[10px] text-slate-500 uppercase flex items-center gap-1 cursor-ew-resize hover:text-blue-400 select-none"><TextIcon className="w-3 h-3"/> {lang === 'zh' ? '字号' : 'Size'}</label>
                  <input type="number" value={selectedLayer.fontSize || 48} onChange={(e) => onUpdateLayer(selectedLayer.id, { fontSize: parseInt(e.target.value)||0 })} className="bg-slate-800 rounded px-2 py-1.5 w-full text-xs text-slate-200 border border-slate-700 focus:outline-none" />
                </div>
              )}

              <div className="col-span-2 space-y-2">
                 <label className="text-[10px] text-slate-500 uppercase select-none">{t.opacity}</label>
                 <input 
                   type="range" 
                   min="0" 
                   max="1" 
                   step="0.01" 
                   value={selectedLayer.opacity} 
                   onChange={(e) => onUpdateLayer(selectedLayer.id, { opacity: parseFloat(e.target.value) }, false)} 
                   onMouseUp={onCommit}
                   className="w-full accent-blue-600" 
                 />
              </div>

              {/* Text Content - Moved up before color controls */}
              {selectedLayer.type === 'text' && (
                <div className="col-span-2 space-y-2 pt-2 border-t border-slate-800/50">
                  <label className="text-[10px] text-slate-500 uppercase select-none">{t.textContent}</label>
                  <textarea 
                    value={selectedLayer.content} 
                    onChange={(e) => onUpdateLayer(selectedLayer.id, { content: e.target.value })} 
                    className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-xs min-h-[60px] text-slate-200 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
                  />
                </div>
              )}

              {/* Text-Specific: Gradient Toggle and Gradient Controls */}
              {selectedLayer.type === 'text' && (
                <div className="col-span-2 pt-4 border-t border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><Palette className="w-3 h-3" /> {t.textGradient}</h4>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={selectedLayer.textGradient?.enabled || false} onChange={handleToggleGradient} />
                      <div className="w-7 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  {selectedLayer.textGradient?.enabled && (
                    <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-500 uppercase">{t.startColor}</label>
                          <input type="color" value={selectedLayer.textGradient.from} onChange={(e) => handleUpdateTextGradient({ from: e.target.value })} className="w-full h-8 rounded bg-slate-800 border border-slate-700 cursor-pointer" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-500 uppercase">{t.endColor}</label>
                          <input type="color" value={selectedLayer.textGradient.to} onChange={(e) => handleUpdateTextGradient({ to: e.target.value })} className="w-full h-8 rounded bg-slate-800 border border-slate-700 cursor-pointer" />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-[9px] text-slate-500 uppercase"><span>{t.angle}</span><span>{selectedLayer.textGradient.angle}°</span></div>
                        <input type="range" min="0" max="360" value={selectedLayer.textGradient.angle} onChange={(e) => handleUpdateTextGradient({ angle: parseInt(e.target.value) })} onMouseUp={onCommit} className="w-full accent-blue-600" />
                      </div>
                      <div className="pt-2">
                         <label className="text-[9px] text-slate-500 uppercase mb-2 block">{lang === 'zh' ? '渐变预设' : 'Presets'}</label>
                         <div className="grid grid-cols-4 gap-2">
                            {TEXT_GRADIENT_PRESETS.map((p, idx) => (
                              <button 
                                key={idx} 
                                onClick={() => handleUpdateTextGradient({ from: p.from, to: p.to, angle: p.angle })}
                                className="h-6 rounded border border-slate-700 hover:border-blue-500 transition-all hover:scale-105 active:scale-95 shadow-sm"
                                style={{ background: `linear-gradient(${p.angle}deg, ${p.from}, ${p.to})` }}
                              />
                            ))}
                         </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Shared Primary Color Picker: Only show if gradient is NOT enabled for text, OR if it's an SVG layer */}
              {((selectedLayer.type === 'text' && !selectedLayer.textGradient?.enabled) || selectedLayer.type === 'svg') && (
                <div className="col-span-2 space-y-2 pt-4 border-t border-slate-800">
                  <label className="text-[10px] text-slate-500 uppercase select-none">{t.primaryColor}</label>
                  <div className="flex gap-2">
                    <input type="color" value={selectedLayer.color || '#3b82f6'} onChange={(e) => onUpdateLayer(selectedLayer.id, { color: e.target.value })} className="h-8 w-8 bg-transparent cursor-pointer rounded overflow-hidden" />
                    <input type="text" value={selectedLayer.color || '#3b82f6'} onChange={(e) => onUpdateLayer(selectedLayer.id, { color: e.target.value })} className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200" />
                  </div>
                </div>
              )}

            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-600 text-center gap-3">
               <Hash className="w-10 h-10 opacity-20" />
               <p className="text-xs">{t.emptyInspector}</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 bg-slate-900/50">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/50 bg-slate-900 flex-shrink-0">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t.layers}</h3>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-1 scrollbar-hide">
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
              className={`group relative flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-all ${
                project.selectedLayerId === layer.id ? 'bg-blue-600 text-white shadow-lg' : 'hover:bg-slate-800 text-slate-400'
              } ${draggedIndex === index ? 'opacity-40' : ''} ${dragOverIndex === index && draggedIndex !== index ? 'border-t-2 border-blue-400' : ''}`}
            >
              <div className="cursor-grab p-1 opacity-0 group-hover:opacity-100" onMouseDown={preventDragInterference}><GripVertical className="w-3 h-3"/></div>
              <div className="w-6 h-6 flex items-center justify-center">
                {layer.type === 'text' ? (
                   <TextIcon className="w-3 h-3" /> 
                ) : layer.type === 'image' ? (
                   <ImageIcon className="w-3 h-3" /> 
                ) : (
                   <div className="w-3 h-3 flex items-center justify-center overflow-hidden">
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
                  <input autoFocus className="bg-slate-800 w-full px-1 py-0.5 rounded text-xs text-white" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={() => commitRename(layer.id)} onKeyDown={(e) => e.key === 'Enter' && commitRename(layer.id)} />
                ) : (
                  <span className="block text-xs truncate font-medium">{layer.name}</span>
                )}
              </div>
              <div className={`flex gap-1 ${project.selectedLayerId === layer.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                 <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onUpdateLayer(layer.id, { visible: !layer.visible }); }}
                  className="p-1 hover:text-white"
                 >
                   {layer.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                 </button>
                 <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onUpdateLayer(layer.id, { locked: !layer.locked }); }}
                  className="p-1 hover:text-white"
                 >
                   {layer.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                 </button>
                 <button 
                  type="button"
                  onClick={(e) => handleDelete(e, layer.id)} 
                  className="p-1 text-slate-400 hover:text-red-400 bg-slate-900/50 rounded"
                 >
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
