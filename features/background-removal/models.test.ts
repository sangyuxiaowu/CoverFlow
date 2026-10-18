import { describe, expect, it } from 'vitest';
import { getModel, MODELS, validateModel } from './models.ts';

describe('background-removal model registry', () => {
  it('keeps both verified external downloads outside application assets', () => {
    expect(MODELS.map(model => model.size)).toEqual([4574861, 489666272]);
    for (const model of MODELS) {
      expect(new URL(model.url).pathname).toContain('/resolve/master/');
    }
    expect(getModel('u2netp').inputSize).toBe(320);
    expect(getModel('birefnet').inputSize).toBe(1024);
    expect(() => getModel('other')).toThrow('Unknown');
  });

  it('rejects HTML downloads and incomplete files before loading inference', async () => {
    await expect(validateModel('u2netp', new Blob(['<html>error</html>']))).rejects.toThrow('size');
    await expect(validateModel('u2netp', new Blob(['<html>', ' '.repeat(2048)]))).rejects.toThrow('web page');
    await expect(validateModel('u2netp', new Blob([new Uint8Array(5000)]))).resolves.toBeUndefined();
  });
});