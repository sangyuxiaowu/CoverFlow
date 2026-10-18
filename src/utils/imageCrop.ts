import { type Area } from 'react-easy-crop';

// 生成裁切后的 PNG 数据 URL。
export const getCroppedImage = async (
  imageSrc: string,
  pixelCrop: Area,
  rotation: number,
  flip: { horizontal: boolean; vertical: boolean },
  outputSize: { width: number; height: number }
) => {
  const image = await createImage(imageSrc);
  const rotRad = getRadianAngle(rotation);
  const { width: bboxWidth, height: bboxHeight } = rotateSize(image.width, image.height, rotation);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context not available');

  canvas.width = bboxWidth;
  canvas.height = bboxHeight;

  ctx.translate(bboxWidth / 2, bboxHeight / 2);
  ctx.rotate(rotRad);
  ctx.scale(flip.horizontal ? -1 : 1, flip.vertical ? -1 : 1);
  ctx.translate(-image.width / 2, -image.height / 2);
  ctx.drawImage(image, 0, 0);

  const croppedCanvas = document.createElement('canvas');
  const croppedCtx = croppedCanvas.getContext('2d');
  if (!croppedCtx) throw new Error('Canvas context not available');

  croppedCanvas.width = outputSize.width;
  croppedCanvas.height = outputSize.height;

  croppedCtx.drawImage(
    canvas,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outputSize.width,
    outputSize.height
  );

  return croppedCanvas.toDataURL('image/png');
};

const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (err) => reject(err));
    image.setAttribute('crossOrigin', 'anonymous');
    image.src = url;
  });

const getRadianAngle = (degreeValue: number) => (degreeValue * Math.PI) / 180;

const rotateSize = (width: number, height: number, rotation: number) => {
  const rotRad = getRadianAngle(rotation);
  return {
    width: Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
    height: Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height)
  };
};
