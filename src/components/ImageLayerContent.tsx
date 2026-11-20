import React from 'react';
import { Layer } from '../types.ts';
import { resolveImageSource } from '../storage/imageAssets.ts';
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
  const source = resolveImageSource(layer.content);

  if (isCropped) {
    const crop = normalizeImageCrop(layer.imageCrop);
    return (
      <div
        className="w-full h-full overflow-hidden relative pointer-events-none"
        style={{ opacity: layer.opacity }}
      >
        <img
          src={source}
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
        src={source}
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

export default React.memo(ImageLayerContent, (previous, next) => {
  const left = previous.layer;
  const right = next.layer;
  return left.content === right.content && left.name === right.name && left.opacity === right.opacity &&
    left.imageFilters === right.imageFilters && left.imageCrop === right.imageCrop &&
    left.flipX === right.flipX && left.flipY === right.flipY && left.ratioLocked === right.ratioLocked;
});
