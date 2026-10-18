export type ModelId = 'u2netp' | 'birefnet';

export interface RemovalModel {
  id: ModelId;
  name: string;
  size: number;
  inputSize: number;
  url: string;
}

export const MODELS: readonly RemovalModel[] = [
  {
    id: 'u2netp', name: 'U2NetP', size: 4574861, inputSize: 320,
    url: 'https://www.modelscope.cn/models/budaoshou/U2NetP-ONNX/resolve/master/u2netp.onnx?view=false'
  },
  {
    id: 'birefnet', name: 'BiRefNet FP16', size: 489666272, inputSize: 1024,
    url: 'https://www.modelscope.cn/models/onnx-community/BiRefNet-ONNX/resolve/master/onnx/model_fp16.onnx?view=false'
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