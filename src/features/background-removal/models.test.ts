import { describe, expect, it } from 'vitest';
import { getModel, MODELS, validateModel } from './models.ts';

describe('background-removal model registry', () => {
  it('keeps both verified external downloads outside application assets', () => {
    expect(MODELS.map(model => model.size)).toEqual([4574861, 98484532]);
    for (const model of MODELS) {
      expect(new URL(model.url).pathname).toMatch(/\/resolve\/(master|main)\//);
    }
    expect(getModel('u2netp').inputSize).toBe(320);
    expect(getModel('birefnet').inputSize).toBe(512);
    expect(getModel('birefnet').name).toBe('BiRefNet Lite 512');
    expect(getModel('birefnet').url).toBe('https://www.modelscope.cn/models/sangsq/birefnet-lite-512/resolve/master/model_fp16.onnx?view=false');
    expect(getModel('birefnet').variants).toEqual([
      { precision: 'fp16', size: 98484532, url: 'https://www.modelscope.cn/models/sangsq/birefnet-lite-512/resolve/master/model_fp16.onnx?view=false' },
      { precision: 'fp32', size: 191877254, url: 'https://www.modelscope.cn/models/sangsq/birefnet-lite-512/resolve/master/model.onnx?view=false' }
    ]);
    expect(() => getModel('other')).toThrow('Unknown');
  });

  it('rejects HTML downloads and incomplete files before loading inference', async () => {
    await expect(validateModel('u2netp', new Blob(['<html>error</html>']))).rejects.toThrow('size');
    await expect(validateModel('u2netp', new Blob(['<html>', ' '.repeat(2048)]))).rejects.toThrow('web page');
    await expect(validateModel('u2netp', new Blob([new Uint8Array(5000)]))).resolves.toBeUndefined();
  });
});