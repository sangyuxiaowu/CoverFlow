// 模块：画布渲染与交互（拖拽、缩放、对齐）
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Layer, ProjectState } from '../types.ts';
import { applySvgAspectRatio } from '../utils/helpers.ts';
import { buildBackgroundStyles } from '../utils/backgroundStyles.ts';
import { translations, Language } from '../translations.ts';
import { RotateCw } from 'lucide-react';

interface Guideline {
  type: 'h' | 'v';
  pos: number;
}

interface CanvasProps {
  lang: Language;
  project: ProjectState;
  onSelectLayer: (id: string | null) => void;
  updateLayer: (id: string, updates: Partial<Layer>, record?: boolean) => void;
  onCommit: () => void;
}

const SNAP_THRESHOLD = 8;

// 画布交互与渲染组件。
const Canvas: React.FC<CanvasProps> = ({ lang, project, onSelectLayer, updateLayer, onCommit }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.8);
  const [guidelines, setGuidelines] = useState<Guideline[]>([]);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const textEditRef = useRef<HTMLTextAreaElement | null>(null);
  const lastEditIdRef = useRef<string | null>(null);
  const t = translations[lang];

  // 鼠标交互状态：用于拖拽、缩放、旋转
  const [interaction, setInteraction] = useState<{
    type: 'move' | 'resize' | 'rotate';
    layerId: string;
    startX: number;
    startY: number;
    initialData: { x: number; y: number; w: number; h: number; rotation: number };
    handle?: string;
  } | null>(null);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setZoom(prev => Math.min(Math.max(0.05, prev - e.deltaY * 0.001), 5));
      }
    };
    const ref = scrollContainerRef.current;
    ref?.addEventListener('wheel', handleWheel, { passive: false });
    return () => ref?.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    if (!editingLayerId) return;
    if (lastEditIdRef.current === editingLayerId) return;
    const layer = project.layers.find(l => l.id === editingLayerId);
    if (!layer || layer.type !== 'text') return;
    lastEditIdRef.current = editingLayerId;
    setEditingValue(prev => (prev === layer.content ? prev : layer.content));
    requestAnimationFrame(() => {
      textEditRef.current?.focus();
      textEditRef.current?.select();
    });
  }, [editingLayerId, project.layers]);

  useEffect(() => {
    if (!editingLayerId) return;
    if (project.selectedLayerId !== editingLayerId) setEditingLayerId(null);
  }, [editingLayerId, project.selectedLayerId]);

  useEffect(() => {
    if (editingLayerId) return;
    lastEditIdRef.current = null;
  }, [editingLayerId]);

  const handleLayerMouseDown = (e: React.MouseEvent, layer: Layer) => {
    if (layer.locked) return;
    e.stopPropagation();
    if (editingLayerId === layer.id) return;
    if (editingLayerId && editingLayerId !== layer.id) setEditingLayerId(null);
    onSelectLayer(layer.id);
    
    setInteraction({
      type: 'move',
      layerId: layer.id,
      startX: e.clientX,
      startY: e.clientY,
      initialData: { x: layer.x, y: layer.y, w: layer.width, h: layer.height, rotation: layer.rotation }
    });
  };

  const handleLayerDoubleClick = (e: React.MouseEvent, layer: Layer) => {
    if (layer.locked || layer.type !== 'text') return;
    e.stopPropagation();
    onSelectLayer(layer.id);
    setEditingLayerId(layer.id);
    setEditingValue(layer.content);
  };

  const handleControlMouseDown = (e: React.MouseEvent, layer: Layer, type: 'resize' | 'rotate', handle?: string) => {
    e.stopPropagation();
    e.preventDefault();
    setInteraction({
      type,
      layerId: layer.id,
      startX: e.clientX,
      startY: e.clientY,
      handle,
      initialData: { x: layer.x, y: layer.y, w: layer.width, h: layer.height, rotation: layer.rotation }
    });
  };

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    if (!interaction) return;

    const { type, startX, startY, initialData, handle } = interaction;
    const dx = (e.clientX - startX) / zoom;
    const dy = (e.clientY - startY) / zoom;

    if (type === 'move') {
      let nextX = initialData.x + dx;
      let nextY = initialData.y + dy;
      
      const activeGuidelines: Guideline[] = [];
      const movingLayer = project.layers.find(l => l.id === interaction.layerId);
      if (!movingLayer) return;

      const halfW = movingLayer.width / 2;
      const halfH = movingLayer.height / 2;

      // 吸附目标：画布边缘与中心
      const targetsX = [0, project.canvasConfig.width / 2, project.canvasConfig.width];
      const targetsY = [0, project.canvasConfig.height / 2, project.canvasConfig.height];

      // 吸附目标：其他图层
      project.layers.forEach(l => {
        if (l.id === movingLayer.id || !l.visible || l.type === 'group') return;
        targetsX.push(l.x, l.x + l.width / 2, l.x + l.width);
        targetsY.push(l.y, l.y + l.height / 2, l.y + l.height);
      });

      // 水平吸附
      let snappedX = false;
      for (const tx of targetsX) {
        // 源点：左、中、右
        const sources = [nextX, nextX + halfW, nextX + movingLayer.width];
        for (let i = 0; i < sources.length; i++) {
          if (Math.abs(sources[i] - tx) < SNAP_THRESHOLD) {
            if (i === 0) nextX = tx;
            if (i === 1) nextX = tx - halfW;
            if (i === 2) nextX = tx - movingLayer.width;
            activeGuidelines.push({ type: 'v', pos: tx });
            snappedX = true;
            break;
          }
        }
        if (snappedX) break;
      }

      // 垂直吸附
      let snappedY = false;
      for (const ty of targetsY) {
        // 源点：上、中、下
        const sources = [nextY, nextY + halfH, nextY + movingLayer.height];
        for (let i = 0; i < sources.length; i++) {
          if (Math.abs(sources[i] - ty) < SNAP_THRESHOLD) {
            if (i === 0) nextY = ty;
            if (i === 1) nextY = ty - halfH;
            if (i === 2) nextY = ty - movingLayer.height;
            activeGuidelines.push({ type: 'h', pos: ty });
            snappedY = true;
            break;
          }
        }
        if (snappedY) break;
      }

      setGuidelines(activeGuidelines);
      updateLayer(interaction.layerId, { x: nextX, y: nextY }, false);
      return;
    }

    // 旋转：以图层中心为圆心计算角度
    if (type === 'rotate') {
      const canvasRect = document.getElementById('export-target')?.getBoundingClientRect();
      if (!canvasRect) return;
      const cx = initialData.x + initialData.w / 2;
      const cy = initialData.y + initialData.h / 2;
      const screenCx = canvasRect.left + (cx * zoom);
      const screenCy = canvasRect.top + (cy * zoom);
      const angle = Math.atan2(e.clientY - screenCy, e.clientX - screenCx) * (180 / Math.PI);
      let newRotation = angle + 90; 
      if (e.shiftKey) newRotation = Math.round(newRotation / 15) * 15;
      updateLayer(interaction.layerId, { rotation: newRotation }, false);
      return;
    }

    // 缩放：转换到图层本地坐标系
    if (type === 'resize' && handle) {
      const rad = initialData.rotation * (Math.PI / 180);
      const cos = Math.cos(-rad);
      const sin = Math.sin(-rad);
      let localDx = dx * cos - dy * sin;
      let localDy = dx * sin + dy * cos;
      const isCorner = ['ne', 'nw', 'se', 'sw'].includes(handle);
      const layer = project.layers.find(l => l.id === interaction.layerId);
      const ratioLocked = e.shiftKey || (layer?.ratioLocked && isCorner);
      
      if (ratioLocked && initialData.w > 0 && initialData.h > 0) {
        const ratio = initialData.w / initialData.h;
        if (handle === 'se' || handle === 'nw') localDy = localDx / ratio;
        else if (handle === 'sw' || handle === 'ne') localDy = -localDx / ratio;
      }

      let dW = 0, dH = 0, dX = 0, dY = 0;
      if (handle.includes('e')) { dW = localDx; }
      if (handle.includes('w')) { dW = -localDx; dX = localDx; }
      if (handle.includes('s')) { dH = localDy; }
      if (handle.includes('n')) { dH = -localDy; dY = localDy; }

      let newW = Math.max(10, initialData.w + dW);
      let newH = Math.max(10, initialData.h + dH);

      // 旋转后中心点位移回推到画布坐标
      const unrotatedCenterXChange = dX + dW / 2;
      const unrotatedCenterYChange = dY + dH / 2;
      const rotatedCenterXChange = unrotatedCenterXChange * Math.cos(rad) - unrotatedCenterYChange * Math.sin(rad);
      const rotatedCenterYChange = unrotatedCenterXChange * Math.sin(rad) + unrotatedCenterYChange * Math.cos(rad);
      const newCenterX = (initialData.x + initialData.w / 2) + rotatedCenterXChange;
      const newCenterY = (initialData.y + initialData.h / 2) + rotatedCenterYChange;

      updateLayer(interaction.layerId, { x: newCenterX - newW / 2, y: newCenterY - newH / 2, width: newW, height: newH }, false);
    }
  }, [interaction, zoom, project.layers, project.canvasConfig, updateLayer]);

  const handleGlobalMouseUp = useCallback(() => {
    if (interaction) {
      onCommit();
      setInteraction(null);
      setGuidelines([]);
    }
  }, [interaction, onCommit]);

  useEffect(() => {
    if (interaction) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('mouseup', handleGlobalMouseUp);
      };
    }
  }, [interaction, handleGlobalMouseMove, handleGlobalMouseUp]);

  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setEditingLayerId(null);
      onSelectLayer(null);
    }
  };

  return (
    <div className="flex-1 relative">
      <div 
        ref={scrollContainerRef}
        className="absolute inset-0 overflow-auto bg-slate-950 canvas-checkerboard"
        onMouseDown={handleBackgroundClick}
      >
        <div 
          className="flex items-center justify-center min-w-full min-h-full p-16 md:p-32"
          onMouseDown={handleBackgroundClick}
        >
          <div 
            style={{
              width: project.canvasConfig.width * zoom,
              height: project.canvasConfig.height * zoom,
              transition: interaction ? 'none' : 'width 0.1s ease-out, height 0.1s ease-out',
              flexShrink: 0
            }}
            className="relative"
          >
            <div 
              id="export-target"
              className="absolute top-0 left-0 bg-white shadow-[0_0_100px_rgba(0,0,0,0.5)] overflow-hidden"
              style={{
                width: project.canvasConfig.width,
                height: project.canvasConfig.height,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                ...buildBackgroundStyles(project.background),
                backfaceVisibility: 'hidden'
              }}
            >
            {project.layers
              .filter(l => l.visible && l.type !== 'group')
              .sort((a, b) => a.zIndex - b.zIndex)
              .map(layer => {
                const align = layer.textAlign || 'center';
                const textStyle: React.CSSProperties = {
                  fontSize: `${layer.fontSize || Math.max(12, layer.height * 0.7)}px`,
                  fontFamily: layer.fontFamily || 'Inter, sans-serif',
                  fontWeight: layer.fontWeight || 'bold',
                  wordBreak: 'break-word',
                  opacity: layer.opacity,
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
                  textAlign: align,
                  padding: '0 1rem',
                  lineHeight: 1.1,
                  pointerEvents: 'none',
                };

                if (layer.type === 'text' && layer.writingMode === 'vertical') {
                  textStyle.writingMode = 'vertical-rl';
                  textStyle.textOrientation = 'upright';
                  textStyle.padding = '1rem 0';
                }

                if (layer.type === 'text' && layer.textGradient?.enabled) {
                  textStyle.backgroundImage = `linear-gradient(${layer.textGradient.angle}deg, ${layer.textGradient.from}, ${layer.textGradient.to})`;
                  textStyle.WebkitBackgroundClip = 'text';
                  textStyle.WebkitTextFillColor = 'transparent';
                  textStyle.backgroundClip = 'text';
                  textStyle.color = 'transparent';
                } else if (layer.type === 'text' || layer.type === 'svg') {
                  textStyle.color = layer.color || '#ffffff';
                }

                return (
                  <div
                    key={layer.id}
                    onMouseDown={(e) => handleLayerMouseDown(e, layer)}
                    onDoubleClick={(e) => handleLayerDoubleClick(e, layer)}
                    className={`absolute select-none group ${project.selectedLayerId === layer.id ? 'z-50' : ''}`}
                    style={{
                      left: layer.x,
                      top: layer.y,
                      width: layer.width,
                      height: layer.height,
                      transform: `rotate(${layer.rotation}deg)`,
                      zIndex: layer.zIndex,
                      cursor: interaction ? 'grabbing' : 'move',
                      willChange: 'transform',
                      backfaceVisibility: 'hidden'
                    }}
                  >
                    {layer.type === 'svg' ? (
                      <div className="w-full h-full pointer-events-none overflow-hidden" style={{ color: layer.color }}>
                        {layer.content.toLowerCase().includes('<svg') ? (
                          <div
                            className="w-full h-full"
                            dangerouslySetInnerHTML={{ __html: applySvgAspectRatio(layer.content, !!layer.ratioLocked) }}
                          />
                        ) : (
                          <svg
                            width="100%"
                            height="100%"
                            viewBox="0 0 100 100"
                            preserveAspectRatio={layer.ratioLocked ? 'xMidYMid meet' : 'none'}
                            dangerouslySetInnerHTML={{ __html: layer.content }}
                          />
                        )}
                      </div>
                    ) : layer.type === 'text' ? (
                      editingLayerId === layer.id ? (
                        <textarea
                          ref={textEditRef}
                          value={editingValue}
                          onChange={(e) => {
                            setEditingValue(e.target.value);
                            updateLayer(layer.id, { content: e.target.value }, false);
                          }}
                          onBlur={() => {
                            setEditingLayerId(null);
                            onCommit();
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              setEditingLayerId(null);
                              onCommit();
                            }
                          }}
                          className="w-full h-full bg-transparent text-center resize-none outline-none border border-blue-500/60 shadow-[0_0_0_1px_rgba(59,130,246,0.4)]"
                          style={{
                            ...textStyle,
                            color: layer.color || '#ffffff',
                            backgroundImage: 'none',
                            WebkitTextFillColor: 'currentColor',
                            pointerEvents: 'auto',
                            display: 'block'
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <div style={textStyle}>
                          {layer.content}
                        </div>
                      )
                    ) : (
                      <img
                        src={layer.content}
                        className={`w-full h-full ${layer.ratioLocked ? 'object-contain' : 'object-fill'} pointer-events-none`}
                        style={{ opacity: layer.opacity }}
                        draggable={false}
                        alt="layer"
                      />
                    )}
                    {project.selectedLayerId === layer.id && !layer.locked && (
                      <>
                        <div className="absolute inset-0 border border-blue-500 pointer-events-none" style={{ willChange: 'transform', backfaceVisibility: 'hidden' }} />
                        <div className="absolute left-1/2 -top-8 -translate-x-1/2 flex flex-col items-center cursor-grab" onMouseDown={(e) => handleControlMouseDown(e, layer, 'rotate')}>
                          <div className="w-5 h-5 bg-white border border-blue-600 rounded-full flex items-center justify-center text-blue-600"><RotateCw className="w-3 h-3" /></div>
                          <div className="w-px h-3 bg-blue-600" />
                        </div>
                        {['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'].map(h => {
                          const isN = h.includes('n');
                          const isS = h.includes('s');
                          const isW = h.includes('w');
                          const isE = h.includes('e');
                          const translateX = isW ? '-50%' : isE ? '50%' : '-50%';
                          const translateY = isN ? '-50%' : isS ? '50%' : '-50%';
                          return (
                            <div
                              key={h}
                              className="absolute w-2.5 h-2.5 bg-white border border-blue-600 rounded-full z-50 pointer-events-auto"
                              onMouseDown={(e) => handleControlMouseDown(e, layer, 'resize', h)}
                              style={{
                                top: isN ? 0 : isS ? '100%' : '50%',
                                left: isW ? 0 : isE ? '100%' : '50%',
                                transform: `translate(${translateX}, ${translateY})`,
                                cursor: `${h}-resize`,
                                backfaceVisibility: 'hidden'
                              }}
                            />
                          );
                        })}
                      </>
                    )}
                  </div>
                );
              })}

            {(() => {
              const selectedGroup = project.layers.find(l => l.id === project.selectedLayerId && l.type === 'group');
              if (!selectedGroup || selectedGroup.locked) return null;
              return (
                <div
                  onMouseDown={(e) => handleLayerMouseDown(e, selectedGroup)}
                  className="absolute select-none"
                  style={{
                    left: selectedGroup.x,
                    top: selectedGroup.y,
                    width: selectedGroup.width,
                    height: selectedGroup.height,
                    transform: `rotate(${selectedGroup.rotation}deg)`,
                    zIndex: 9999,
                    cursor: interaction ? 'grabbing' : 'move'
                  }}
                >
                  <div className="absolute inset-0 border border-blue-400 border-dashed pointer-events-none" />
                  <div className="absolute left-1/2 -top-8 -translate-x-1/2 flex flex-col items-center cursor-grab" onMouseDown={(e) => handleControlMouseDown(e, selectedGroup, 'rotate')}>
                    <div className="w-5 h-5 bg-white border border-blue-600 rounded-full flex items-center justify-center text-blue-600"><RotateCw className="w-3 h-3" /></div>
                    <div className="w-px h-3 bg-blue-600" />
                  </div>
                  {['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'].map(h => {
                    const isN = h.includes('n');
                    const isS = h.includes('s');
                    const isW = h.includes('w');
                    const isE = h.includes('e');
                    const translateX = isW ? '-50%' : isE ? '50%' : '-50%';
                    const translateY = isN ? '-50%' : isS ? '50%' : '-50%';
                    return (
                      <div
                        key={h}
                        className="absolute w-2.5 h-2.5 bg-white border border-blue-600 rounded-full z-50 pointer-events-auto"
                        onMouseDown={(e) => handleControlMouseDown(e, selectedGroup, 'resize', h)}
                        style={{
                          top: isN ? 0 : isS ? '100%' : '50%',
                          left: isW ? 0 : isE ? '100%' : '50%',
                          transform: `translate(${translateX}, ${translateY})`,
                          cursor: `${h}-resize`
                        }}
                      />
                    );
                  })}
                </div>
              );
            })()}
            
            {/* 对齐参考线覆盖层 */}
            {guidelines.map((g, i) => (
              <div
                key={i}
                className="absolute pointer-events-none z-[100]"
                style={{
                  left: g.type === 'v' ? g.pos : 0,
                  top: g.type === 'h' ? g.pos : 0,
                  width: g.type === 'v' ? '1px' : '100%',
                  height: g.type === 'h' ? '1px' : '100%',
                  backgroundColor: '#a855f7',
                  boxShadow: '0 0 2px rgba(168, 85, 247, 0.5)',
                  opacity: 0.8
                }}
              />
            ))}
            </div>
          </div>
        </div>
      </div>
      
      <div className="absolute bottom-3 right-3 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-xl px-3 py-2 flex items-center gap-3 text-[10px] font-bold text-slate-200 shadow-2xl z-50">
        <button onClick={() => setZoom(z => Math.max(0.05, z - 0.1))} className="hover:text-blue-400 font-black w-7 h-7 flex items-center justify-center rounded-md bg-slate-800 border border-slate-700 transition-all active:scale-95">－</button>
        <span className="w-12 text-center font-mono text-xs tracking-tight">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.min(5, z + 0.1))} className="hover:text-blue-400 font-black w-7 h-7 flex items-center justify-center rounded-md bg-slate-800 border border-slate-700 transition-all active:scale-95">＋</button>
        <div className="w-px h-4 bg-slate-700" />
        <button onClick={() => setZoom(0.8)} className="hover:text-blue-400 text-slate-400 transition-colors uppercase tracking-widest text-[9px]">{t.resetZoom}</button>
      </div>
    </div>
  );
};

export default Canvas;
