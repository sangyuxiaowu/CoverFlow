
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Layer, ProjectState } from '../types.ts';
import { translations, Language } from '../translations.ts';
import { RotateCw } from 'lucide-react';

interface CanvasProps {
  lang: Language;
  project: ProjectState;
  onSelectLayer: (id: string | null) => void;
  updateLayer: (id: string, updates: Partial<Layer>, record?: boolean) => void;
  onCommit: () => void;
}

const Canvas: React.FC<CanvasProps> = ({ lang, project, onSelectLayer, updateLayer, onCommit }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.8);
  const t = translations[lang];

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

  const handleLayerMouseDown = (e: React.MouseEvent, layer: Layer) => {
    if (layer.locked) return;
    e.stopPropagation();
    onSelectLayer(layer.id);
    
    setInteraction({
      type: 'move',
      layerId: layer.id,
      startX: e.clientX,
      startY: e.clientY,
      initialData: { x: layer.x, y: layer.y, w: layer.width, h: layer.height, rotation: layer.rotation }
    });
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
      updateLayer(interaction.layerId, { x: initialData.x + dx, y: initialData.y + dy }, false);
      return;
    }

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

      const unrotatedCenterXChange = dX + dW / 2;
      const unrotatedCenterYChange = dY + dH / 2;
      const rotatedCenterXChange = unrotatedCenterXChange * Math.cos(rad) - unrotatedCenterYChange * Math.sin(rad);
      const rotatedCenterYChange = unrotatedCenterXChange * Math.sin(rad) + unrotatedCenterYChange * Math.cos(rad);
      const newCenterX = (initialData.x + initialData.w / 2) + rotatedCenterXChange;
      const newCenterY = (initialData.y + initialData.h / 2) + rotatedCenterYChange;

      updateLayer(interaction.layerId, { x: newCenterX - newW / 2, y: newCenterY - newH / 2, width: newW, height: newH }, false);
    }
  }, [interaction, zoom, project.layers, updateLayer]);

  const handleGlobalMouseUp = useCallback(() => {
    if (interaction) {
      onCommit();
      setInteraction(null);
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
    // If clicking directly on the scroll container or the centering wrapper, deselect.
    if (e.target === e.currentTarget) {
      onSelectLayer(null);
    }
  };

  const getBackgroundStyles = (): React.CSSProperties => {
    const bg = project.background;
    const styles: React.CSSProperties = {};
    
    // 1. Determine base layers (Color, Gradient, or Image)
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

    // 2. Overlay Pattern (Grid/Dots/Stripes)
    let patternImage = '';
    let patternSize = '';
    if (bg.overlayType !== 'none') {
      const rgba = bg.overlayType === 'dots' || bg.overlayType === 'grid' || bg.overlayType === 'stripes'
        ? (bg.overlayColor.startsWith('#') 
          ? `${bg.overlayColor}${Math.round(bg.overlayOpacity * 255).toString(16).padStart(2, '0')}` 
          : bg.overlayColor)
        : '';
      const scale = bg.overlayScale || 20;

      if (bg.overlayType === 'dots') {
        patternImage = `radial-gradient(${rgba} 2px, transparent 2px)`;
      } else if (bg.overlayType === 'grid') {
        patternImage = `linear-gradient(${rgba} 1px, transparent 1px), linear-gradient(90deg, ${rgba} 1px, transparent 1px)`;
      } else if (bg.overlayType === 'stripes') {
        patternImage = `repeating-linear-gradient(45deg, ${rgba}, ${rgba} 2px, transparent 2px, transparent ${scale/2}px)`;
      }
      patternSize = `${scale}px ${scale}px`;
    }

    // 3. Stack background images
    const backgroundImages: string[] = [];
    const backgroundSizes: string[] = [];
    
    if (patternImage) {
      backgroundImages.push(patternImage);
      backgroundSizes.push(patternSize);
    }
    
    if (baseBackground) {
      backgroundImages.push(baseBackground);
      backgroundSizes.push(bg.type === 'image' ? 'cover' : '100% 100%');
    }

    if (backgroundImages.length > 0) {
      styles.backgroundImage = backgroundImages.join(', ');
      styles.backgroundSize = backgroundSizes.join(', ');
    }

    return styles;
  };

  return (
    <div 
      ref={scrollContainerRef}
      className="flex-1 overflow-auto bg-slate-950 canvas-checkerboard relative w-full h-full"
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
              ...getBackgroundStyles()
            }}
          >
            {project.layers
              .filter(l => l.visible)
              .sort((a, b) => a.zIndex - b.zIndex)
              .map(layer => (
                <div
                  key={layer.id}
                  onMouseDown={(e) => handleLayerMouseDown(e, layer)}
                  className={`absolute select-none group ${project.selectedLayerId === layer.id ? 'z-50' : ''}`}
                  style={{
                    left: layer.x,
                    top: layer.y,
                    width: layer.width,
                    height: layer.height,
                    transform: `rotate(${layer.rotation}deg)`,
                    opacity: layer.opacity,
                    zIndex: layer.zIndex,
                    cursor: interaction ? 'grabbing' : 'move'
                  }}
                >
                  {layer.type === 'svg' ? (
                    <div className="w-full h-full pointer-events-none overflow-hidden" style={{ color: layer.color }}>
                      {layer.content.toLowerCase().includes('<svg') ? <div className="w-full h-full" dangerouslySetInnerHTML={{ __html: layer.content }} /> : <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" dangerouslySetInnerHTML={{ __html: layer.content }} />}
                    </div>
                  ) : layer.type === 'text' ? (
                    <div className="w-full h-full flex items-center justify-center text-center font-bold break-words px-4 leading-tight pointer-events-none" style={{ color: layer.color, fontSize: `${layer.fontSize || Math.max(12, layer.height * 0.7)}px`, wordBreak: 'break-word' }}>
                      {layer.content}
                    </div>
                  ) : (
                    <img src={layer.content} className="w-full h-full object-contain pointer-events-none" draggable={false} alt="layer" />
                  )}
                  {project.selectedLayerId === layer.id && !layer.locked && (
                    <>
                      <div className="absolute inset-0 border border-blue-500 pointer-events-none" />
                      <div className="absolute left-1/2 -top-8 -translate-x-1/2 flex flex-col items-center cursor-grab" onMouseDown={(e) => handleControlMouseDown(e, layer, 'rotate')}>
                        <div className="w-5 h-5 bg-white border border-blue-600 rounded-full flex items-center justify-center text-blue-600"><RotateCw className="w-3 h-3" /></div>
                        <div className="w-px h-3 bg-blue-600" />
                      </div>
                      {['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'].map(h => (
                        <div key={h} className={`absolute w-2.5 h-2.5 bg-white border border-blue-600 rounded-full z-50 pointer-events-auto cursor-${h}-resize ${h.includes('n') ? 'top-0' : h.includes('s') ? 'bottom-0' : 'top-1/2'} ${h.includes('w') ? 'left-0' : h.includes('e') ? 'right-0' : 'left-1/2'} -translate-x-1/2 -translate-y-1/2`} onMouseDown={(e) => handleControlMouseDown(e, layer, 'resize', h)} />
                      ))}
                    </>
                  )}
                </div>
              ))}
          </div>
        </div>
      </div>
      
      <div className="fixed bottom-6 right-6 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-2xl px-5 py-3 flex items-center gap-5 text-xs font-bold text-slate-200 shadow-2xl z-50">
        <button onClick={() => setZoom(z => Math.max(0.05, z - 0.1))} className="hover:text-blue-400 font-black w-8 h-8 flex items-center justify-center rounded-lg bg-slate-800 border border-slate-700 transition-all active:scale-95">－</button>
        <span className="w-16 text-center font-mono text-sm tracking-tight">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.min(5, z + 0.1))} className="hover:text-blue-400 font-black w-8 h-8 flex items-center justify-center rounded-lg bg-slate-800 border border-slate-700 transition-all active:scale-95">＋</button>
        <div className="w-px h-6 bg-slate-700 mx-1" />
        <button onClick={() => setZoom(0.8)} className="hover:text-blue-400 text-slate-400 transition-colors uppercase tracking-widest">{t.resetZoom}</button>
      </div>
    </div>
  );
};

export default Canvas;
