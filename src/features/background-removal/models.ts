export type ModelId = 'u2netp' | 'birefnet' | 'modnet';
export type ModelPrecision = 'fp16' | 'fp32';

export interface ModelVariant {
  precision: ModelPrecision;
  size: number;
  url: string;
}

export interface RemovalModel {
  id: ModelId;
  name: string;
  size: number;
  inputSize: number;
  url: string;
  variants?: readonly ModelVariant[];
  sourceUrl?: string;
  forceCpu?: boolean;
}

const birefnetVariants: readonly ModelVariant[] = [
  { precision: 'fp16', size: 98484532,
    url: 'https://www.modelscope.cn/models/sangsq/birefnet-lite-512/resolve/master/model_fp16.onnx?view=false' },
  { precision: 'fp32', size: 191877254,
    url: 'https://www.modelscope.cn/models/sangsq/birefnet-lite-512/resolve/master/model.onnx?view=false' }
];

const modnetVariants: readonly ModelVariant[] = [
  { precision: 'fp32', size: 25888640,
    url: 'https://www.modelscope.cn/models/onnx-community/modnet-webnn/resolve/master/onnx/model.onnx?view=false' },
  { precision: 'fp16', size: 12984781,
    url: 'https://www.modelscope.cn/models/onnx-community/modnet-webnn/resolve/master/onnx/model_fp16.onnx?view=false' }
];

export const MODELS: readonly RemovalModel[] = [
  {
    id: 'u2netp', name: 'U2NetP', size: 4574861, inputSize: 320,
    url: 'https://www.modelscope.cn/models/budaoshou/U2NetP-ONNX/resolve/master/u2netp.onnx?view=false'
  },
  {
    id: 'birefnet', name: 'BiRefNet Lite 512', size: birefnetVariants[0].size, inputSize: 512,
    url: birefnetVariants[0].url, variants: birefnetVariants,
    sourceUrl: 'https://www.modelscope.cn/models/sangsq/birefnet-lite-512'
  },
  {
    id: 'modnet', name: 'MODNet', size: modnetVariants[0].size, inputSize: 512, forceCpu: true,
    url: modnetVariants[0].url, variants: modnetVariants,
    sourceUrl: 'https://www.modelscope.cn/models/onnx-community/modnet-webnn'
  }
];

export function getModel(id: string): RemovalModel {
  const model = MODELS.find(item => item.id === id);
  if (!model) throw new Error('Unknown background-removal model');
  return model;
}

export async function validateModel(id: ModelId, blob: Blob): Promise<void> {
  getModel(id);
  if (blob.size < 1024 || blob.size > 1024 * 1024 * 1024) throw new Error('Invalid model size (1 KB-1 GB)');
  const header = (await blob.slice(0, 256).text()).trimStart();
  if (/^(?:<!doctype|<html|<\?xml|\{|version https:\/\/git-lfs)/i.test(header)) {
    throw new Error('Expected ONNX binary, received a web page or metadata');
  }
}