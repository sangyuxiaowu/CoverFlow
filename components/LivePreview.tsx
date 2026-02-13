import React, { useLayoutEffect, useRef, useState } from 'react';
import { BackgroundConfig, ProjectState } from '../types.ts';
import { buildBackgroundStyles } from '../utils/backgroundStyles.ts';

// 实时缩放预览组件。
const LivePreview: React.FC<{
  project: ProjectState;
  previewRef?: React.RefObject<HTMLDivElement>;
}> = ({ project, previewRef }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [isReady, setIsReady] = useState(false);

  // 根据容器变化自适应缩放比例
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const updateScale = () => {
      if (!containerRef.current) return;
      const { width: cw, height: ch } = containerRef.current.getBoundingClientRect();
      const sw = (cw - 40) / project.canvasConfig.width;
      const sh = (ch - 40) / project.canvasConfig.height;
      const nextScale = Math.min(sw, sh);
      setScale((prev) => (Math.abs(prev - nextScale) < 0.0001 ? prev : nextScale));
      setIsReady(true);
    };
    setIsReady(false);
    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [project.canvasConfig]);

  const getBackgroundStyles = (bg: BackgroundConfig): React.CSSProperties =>
    buildBackgroundStyles(bg);

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center bg-[#0c0c0e] overflow-hidden relative">
      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="preview-skeleton"
            style={{
              width: '70%',
              aspectRatio: `${project.canvasConfig.width} / ${project.canvasConfig.height}`
            }}
          />
        </div>
      )}
      <div
        ref={previewRef}
        style={{
          width: project.canvasConfig.width,
          height: project.canvasConfig.height,
          transform: `scale(${scale})`,
          ...getBackgroundStyles(project.background),
          boxShadow: '0 15px 45px rgba(0,0,0,0.6)',
          flexShrink: 0,
          position: 'relative',
          overflow: 'hidden',
          opacity: isReady ? 1 : 0,
          transition: 'opacity 120ms ease-out'
        }}
      >
        {project.layers
          .filter((l) => l.visible && l.type !== 'group')
          .sort((a, b) => a.zIndex - b.zIndex)
          .map((layer) => {
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
              lineHeight: 1.1,
              pointerEvents: 'none',
              padding: '0 0.5rem'
            };

            if (layer.type === 'text' && layer.writingMode === 'vertical') {
              textStyle.writingMode = 'vertical-rl';
              textStyle.textOrientation = 'upright';
              textStyle.padding = '0.5rem 0';
            }

            if (layer.type === 'text' && layer.textGradient?.enabled) {
              textStyle.backgroundImage = `linear-gradient(${layer.textGradient.angle}deg, ${layer.textGradient.from}, ${layer.textGradient.to})`;
              textStyle.WebkitBackgroundClip = 'text';
              textStyle.WebkitTextFillColor = 'transparent';
              textStyle.color = 'transparent';
            } else {
              textStyle.color = layer.color || '#ffffff';
            }

            return (
              <div
                key={layer.id}
                className="absolute"
                style={{
                  left: layer.x,
                  top: layer.y,
                  width: layer.width,
                  height: layer.height,
                  transform: `rotate(${layer.rotation}deg)`,
                  zIndex: layer.zIndex,
                  pointerEvents: 'none'
                }}
              >
                {layer.type === 'text' ? (
                  <div className="w-full h-full" style={textStyle}>
                    {layer.content}
                  </div>
                ) : layer.type === 'image' ? (
                  <img
                    src={layer.content}
                    alt="layer"
                    className="w-full h-full object-cover"
                    style={{ opacity: layer.opacity }}
                  />
                ) : layer.type === 'svg' ? (
                  <div
                    className="w-full h-full"
                    style={{ opacity: layer.opacity }}
                    dangerouslySetInnerHTML={{ __html: layer.content }}
                  />
                ) : null}
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default LivePreview;
