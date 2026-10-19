import React from 'react';
import { Layer } from '../types.ts';
import {
  buildFlipTransform,
  buildImageFilterCss,
  hasActiveImageCrop,
  normalizeImageCrop,
} from '../utils/imageLayer.ts';

interface ImageLayerContentProps {
  layer: Layer;
}

const ImageLayerContent: React.FC<ImageLayerContentProps> = ({ layer }) => {
  const filterCss = buildImageFilterCss(layer.imageFilters);
  const flipTransform = buildFlipTransform(layer.flipX, layer.flipY);
  const isCropped = hasActiveImageCrop(layer.imageCrop);

  if (isCropped) {
    const crop = normalizeImageCrop(layer.imageCrop);
    return (
      <div
        className="w-full h-full overflow-hidden relative pointer-events-none"
        style={{ opacity: layer.opacity }}
      >
        <img
          src={layer.content}
          alt={layer.name || 'layer'}
          draggable={false}
          className="absolute pointer-events-none select-none"
          style={{
            left: `${(-crop.x / crop.width) * 100}%`,
            top: `${(-crop.y / crop.height) * 100}%`,
            width: `${(100 / crop.width) * 100}%`,
            height: `${(100 / crop.height) * 100}%`,
            maxWidth: 'none',
            maxHeight: 'none',
            transform: flipTransform,
            filter: filterCss,
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="w-full h-full overflow-hidden pointer-events-none"
      style={{ opacity: layer.opacity }}
    >
      <img
        src={layer.content}
        alt={layer.name || 'layer'}
        draggable={false}
        className={`w-full h-full ${layer.ratioLocked ? 'object-contain' : 'object-fill'} pointer-events-none select-none`}
        style={{
          transform: flipTransform,
          filter: filterCss,
        }}
      />
    </div>
  );
};

export default ImageLayerContent;
