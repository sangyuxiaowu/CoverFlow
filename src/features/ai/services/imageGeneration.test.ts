import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiConfig, ChatImageRef, WorkspaceBridge } from '../types.ts';
import type { ProjectState } from '../../../types.ts';
import { availableImageModels, createImageModel, generateImages, imageCapabilities, IMAGE_MODEL_PRESETS, imageModelToolId, imageRequestUrl, imageTimeoutSeconds, validateImageModel, type ImagePresetId } from '../image-generation/index.ts';
import { imageToolDefinitions } from '../tools/definitions.ts';
import { executeImageTool, type ImageToolContext } from '../tools/imageTools.ts';
import { executeTool } from '../tools/execute.ts';
import { ConversationAbortError, runConversation } from './conversation.ts';
import { DEFAULT_IMAGE_TOOL_PROMPT, defaultConfig, toRequestConfig, validateConfig } from './config.ts';
import { createFileChatStore } from './chatStore.ts';
import { imageMimeType } from './imageAttachments.ts';

const reference = 'data:image/png;base64,iVBORw0KGgo=';
function setup(adapter: ImagePresetId) {
  const model = { ...createImageModel(adapter), endpointId: 'endpoint', enabled: true };
  const config = { endpoints: [{ id: 'endpoint', endpoint: 'https://example.com/v1', apiKey: 'secret' }], imageModels: [model] } as AiConfig;
  return { model, config };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('image generation adapters', () => {
  for (const [preset, seconds] of [['kolors', 180], ['agnes', 180], ['gpt-image-2.5-sunburst', 600], ['gpt-image-2.5-flare', 300], ['gpt-image-2', 600]] as const) {
    it(`${preset}: uses its own default timeout and honors per-model overrides`, async () => {
      const { model, config } = setup(preset);
      expect(model.timeoutSeconds).toBe(seconds);
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json(model.adapter === 'kolors' ? { images: [{ b64_json: 'iVBORw0KGgo=' }] } : { data: [{ b64_json: 'iVBORw0KGgo=' }] })));
      model.timeoutSeconds = undefined;
      await generateImages(config, { modelConfigId: model.id, prompt: 'City' }, new AbortController().signal);
      expect(timeout).toHaveBeenLastCalledWith(seconds * 1000);
      model.timeoutSeconds = 240;
      await generateImages(config, { modelConfigId: model.id, prompt: 'City' }, new AbortController().signal);
      expect(timeout).toHaveBeenLastCalledWith(240000);
      expect(imageTimeoutSeconds({ ...model, modelId: 'custom-model', timeoutSeconds: undefined })).toBe(180);
    });
  }
  it('keeps supplied release information without guessing unknown dates and validates metadata', () => {
    const { model, config } = setup('agnes');
    for (const preset of IMAGE_MODEL_PRESETS) expect(createImageModel(preset.id)).toMatchObject({ version: preset.version, releasedAt: preset.releasedAt });
    for (const releasedAt of ['2026-02-30', '2026-13-01', '2026-1-1', 'yesterday']) expect(() => validateImageModel({ ...model, releasedAt }, config)).toThrow('release date');
    expect(() => validateImageModel({ ...model, version: 'x'.repeat(101) }, config)).toThrow('version');
    expect(() => validateImageModel({ ...model, releasedAt: '', version: '' }, config)).not.toThrow();
    expect(() => validateImageModel({ ...model, releasedAt: '2024-02-29' }, config)).not.toThrow();
  });
  it('exposes editable version, release date and effective timeout to discovery and actual request schemas', async () => {
    const { context, config, model } = toolContext();
    Object.assign(model, { version: '2.5 Flash custom', releasedAt: '2026-07-14', timeoutSeconds: 270 });
    const second = { ...createImageModel('gpt-image-2.5-sunburst'), releasedAt: '', enabled: true, endpointId: 'endpoint', timeoutSeconds: undefined };
    config.imageModels!.push(second);
    const discovery = await executeImageTool('list_image_models', {}, context, new AbortController().signal);
    expect(discovery.value).toMatchObject({ models: [
      { version: '2.5 Flash custom', releasedAt: '2026-07-14', timeoutSeconds: 270 },
      { version: '2.5 Sunburst', releasedAt: null, timeoutSeconds: 600 }
    ] });
    expect(JSON.stringify(discovery.value)).not.toContain('secret');
    const profiles = defaultConfig();
    profiles.imageModels = [{ ...model, endpointId: profiles.endpoints[0].id }];
    const request = toRequestConfig(profiles);
    expect(request.imageToolModels![0]).toMatchObject({ version: model.version, releasedAt: model.releasedAt, timeoutSeconds: 270 });
    const properties = imageToolDefinitions(request.imageToolModels)[0].function.parameters.properties as Record<string, { description: string }>;
    expect(properties.prompt.description).toContain('2.5 Flash custom');
    expect(properties.prompt.description).toContain('2026-07-14');
    expect(properties.prompt.description).toContain('270 秒');
    const unknown = imageToolDefinitions([{ ...second, version: '', releasedAt: '' }])[0].function.parameters.properties as Record<string, { description: string }>;
    expect(unknown.prompt.description).toContain('版本：未提供；发布日期：未提供');
    expect(unknown.prompt.description).toContain('600 秒');
    expect(model.version).toBe('2.5 Flash custom');
    const mock = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] }));
    vi.stubGlobal('fetch', mock);
    await generateImages(config, { modelConfigId: model.id, prompt: 'City' }, new AbortController().signal);
    const payload = JSON.parse(mock.mock.calls[0][1].body);
    for (const field of ['version', 'releasedAt', 'timeoutSeconds']) expect(payload).not.toHaveProperty(field);
  });
  it('creates short model identifiers using the existing application convention', () => {
    expect(createImageModel('agnes').id).toMatch(/^[a-z0-9]{1,9}$/);
  });
  it('uses model descriptions for specialized guidance without duplicating shared prompt templates', () => {
    const first = createImageModel('kolors');
    const second = createImageModel('agnes');
    expect(first).not.toHaveProperty('textPromptDescription');
    expect(first).not.toHaveProperty('referencePromptDescription');
    first.description = 'Kolors custom model requirements';
    second.description = 'Agnes custom model requirements';
    const multiple = imageToolDefinitions([first, second]);
    const definition = multiple.find(tool => tool.function.name === 'generate_image')!;
    const prompt = (definition.function.parameters.properties as Record<string, { description: string }>).prompt.description;
    expect(prompt).toBe('生图提示词');
    expect(JSON.stringify(multiple)).not.toContain(first.description);
    expect(JSON.stringify(multiple)).not.toContain(second.description);
    const single = imageToolDefinitions([first]);
    expect(single.map(tool => tool.function.name)).toEqual(['generate_image']);
    const parameters = single.find(tool => tool.function.name === 'generate_image')!.function.parameters;
    const properties = parameters.properties as Record<string, Record<string, unknown>>;
    expect(properties.prompt.description).toContain(first.description);
    expect(properties.prompt.description).not.toContain('[主体]');
    expect(properties.prompt.description).not.toContain('[改变要求]');
    expect(properties).not.toHaveProperty('modelConfigId');
    expect(properties).not.toHaveProperty('ratio');
    expect(parameters.required).toEqual(['projectId', 'prompt']);
    expect(DEFAULT_IMAGE_TOOL_PROMPT).toContain('[主体]');
    expect(DEFAULT_IMAGE_TOOL_PROMPT).toContain('[改变要求]');
  });
  it('resolves root and versioned bases without duplicate v1', () => {
    expect(imageRequestUrl('https://example.com')).toBe('https://example.com/v1/images/generations');
    expect(imageRequestUrl('https://example.com/v1/')).toBe('https://example.com/v1/images/generations');
    expect(imageRequestUrl('https://example.com/proxy/v1')).toBe('https://example.com/proxy/v1/images/generations');
  });
  for (const adapter of ['kolors', 'agnes'] as const) it(`${adapter}: downloads signed temporary URLs without changing their query or forwarding API credentials`, async () => {
    const { model, config } = setup(adapter);
    const url = 'https://cdn.example.com/result.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=test%2F20261017%2Fregion%2Fs3%2Faws4_request&X-Amz-Security-Token=token%2Bvalue%3D&X-Amz-Expires=3600&X-Amz-Signature=example';
    const original = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
    const mock = vi.fn().mockResolvedValueOnce(Response.json(adapter === 'kolors' ? { images: [{ url }] } : { data: [{ url }] })).mockResolvedValueOnce(new Response(original));
    vi.stubGlobal('fetch', mock);
    const [result] = await generateImages(config, { modelConfigId: model.id, prompt: 'City' }, new AbortController().signal);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls[1][0].href).toBe(url);
    expect(mock.mock.calls[1][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(mock.mock.calls[1][1].headers).toBeUndefined();
    expect(result.type).toBe('image/png');
    expect(await result.arrayBuffer()).toEqual(await original.arrayBuffer());
    expect(() => imageRequestUrl('https://example.com/v1?api_key=secret')).toThrow('query parameters');
    expect(() => imageRequestUrl('https://example.com/v1', url)).toThrow('query parameters');
  });
  for (const url of ['javascript:alert(1)', 'http://cdn.example.com/image.png?signature=test', 'https://user:password@cdn.example.com/image.png?signature=test', 'https://cdn.example.com/image.png?signature=test#fragment']) {
    it('rejects unsafe result URL protocols, embedded credentials and fragments before download', async () => {
      const { model, config } = setup('kolors');
      const mock = vi.fn().mockResolvedValueOnce(Response.json({ images: [{ url }] }));
      vi.stubGlobal('fetch', mock);
      await expect(generateImages(config, { modelConfigId: model.id, prompt: 'City' }, new AbortController().signal)).rejects.toThrow();
      expect(mock).toHaveBeenCalledTimes(1);
    });
  }
  for (const adapter of ['kolors', 'agnes'] as const) for (const withReference of [false, true]) {
    it(`${adapter}: ${withReference ? 'single reference' : 'text to image'}`, async () => {
      const { model, config } = setup(adapter);
      const mock = vi.fn().mockResolvedValueOnce(Response.json(adapter === 'kolors' ? { images: [{ url: 'https://cdn.example.com/result.png' }] } : { data: [{ b64_json: 'iVBORw0KGgo=' }] })).mockResolvedValueOnce(new Response(new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' })));
      vi.stubGlobal('fetch', mock);
      const [blob] = await generateImages(config, { modelConfigId: model.id, prompt: 'A city' }, new AbortController().signal, withReference ? reference : undefined);
      expect(blob.type).toBe('image/png');
      const [url, request] = mock.mock.calls[0];
      expect(url).toBe('https://example.com/v1/images/generations');
      expect(request.headers.Authorization).toBe('Bearer secret');
      const body = JSON.parse(request.body);
      expect(body).toEqual(adapter === 'kolors'
        ? { model: model.modelId, prompt: 'A city', image_size: '1024x1024', num_inference_steps: 20, guidance_scale: 7.5, ...(withReference ? { image: reference } : {}) }
        : { model: model.modelId, prompt: 'A city', size: '1K', ratio: '1:1', ...(withReference ? { extra_body: { image: [reference], response_format: 'b64_json' } } : { return_base64: true }) });
      if (adapter === 'kolors') {
        expect(request.headers['X-Enable-Watermark']).toBe('0');
        expect(mock.mock.calls[1][1].headers).toBeUndefined();
      }
    });
  }
  for (const [mime, encoded] of [
    ['image/png', 'iVBORw0KGgo='], ['image/jpeg', '/9j/2Q=='], ['image/webp', 'UklGRgAAAABXRUJQ']
  ] as const) for (const reported of ['application/octet-stream', '', 'image/png', 'image/jpeg; charset=utf-8']) {
    it(`recognizes ${mime} bytes when the download reports ${reported || 'no Content-Type'}`, async () => {
      const { model, config } = setup('kolors');
      const original = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      const mock = vi.fn().mockResolvedValueOnce(Response.json({ images: [{ url: 'https://cdn.example.com/result.png?signature=test' }] })).mockResolvedValueOnce(new Response(new Blob([original], { type: reported })));
      vi.stubGlobal('fetch', mock);
      const [image] = await generateImages(config, { modelConfigId: model.id, prompt: 'City' }, new AbortController().signal);
      expect(image.type).toBe(mime);
      expect(new Uint8Array(await image.arrayBuffer())).toEqual(original);
      expect(mock).toHaveBeenCalledTimes(2);
    });
  }
  for (const [content, type] of [['<Error>ExpiredToken</Error>', 'application/xml'], ['<html>Forbidden</html>', 'image/png'], ['not an image', 'application/octet-stream']]) {
    it('rejects non-image download bodies even when the server advertises an image MIME', async () => {
      const { model, config } = setup('kolors');
      const mock = vi.fn().mockResolvedValueOnce(Response.json({ images: [{ url: 'https://cdn.example.com/result.png?signature=test' }] })).mockResolvedValueOnce(new Response(new Blob([content], { type })));
      vi.stubGlobal('fetch', mock);
      await expect(generateImages(config, { modelConfigId: model.id, prompt: 'City' }, new AbortController().signal)).rejects.toThrow('not PNG, JPEG or WebP');
      expect(mock).toHaveBeenCalledTimes(2);
    });
  }
  it('distinguishes empty image downloads from oversized images', async () => {
    const { model, config } = setup('kolors');
    for (const [blob, message] of [[new Blob([]), 'empty'], [new Blob([new Uint8Array(25 * 1024 * 1024 + 1)]), 'exceeds 25 MB']] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ images: [{ url: 'https://cdn.example.com/result.png' }] })).mockResolvedValueOnce(new Response(blob)));
      await expect(generateImages(config, { modelConfigId: model.id, prompt: 'City' }, new AbortController().signal)).rejects.toThrow(message);
    }
  });
  it('omits ratio with Agnes exact dimensions', async () => {
    const { model, config } = setup('agnes');
    const mock = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] }));
    vi.stubGlobal('fetch', mock);
    await generateImages(config, { modelConfigId: model.id, prompt: 'City', size: '1024x768' }, new AbortController().signal);
    expect(JSON.parse(mock.mock.calls[0][1].body)).not.toHaveProperty('ratio');
  });
  it('excludes and refuses disabled models before any network request', async () => {
    const { model, config } = setup('kolors');
    model.enabled = false;
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    expect(availableImageModels(config)).toEqual([]);
    await expect(generateImages(config, { modelConfigId: model.id, prompt: 'City' }, new AbortController().signal)).rejects.toThrow('disabled');
    expect(mock).not.toHaveBeenCalled();
  });
  it('rejects unsupported sizes and cross-origin credential reuse', () => {
    const { model, config } = setup('kolors');
    expect(() => validateImageModel({ ...model, size: '4K' }, config)).toThrow('size');
    expect(() => validateImageModel({ ...model, requestUrl: 'https://other.com/v1/images/generations' }, config)).toThrow('origin');
  });
  it('does not retry a failed paid request', async () => {
    const { model, config } = setup('agnes');
    const mock = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', mock);
    await expect(generateImages(config, { modelConfigId: model.id, prompt: 'City' }, new AbortController().signal)).rejects.toThrow('Image generation failed (HTTP 503).');
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('keeps waiting after 60 seconds and accepts a later image response', async () => {
    vi.useFakeTimers();
    const { model, config } = setup('agnes');
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), milliseconds);
      return controller.signal;
    });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] })), 65000))));
    let settled = false;
    const pending = generateImages(config, { modelConfigId: model.id, prompt: 'City' }, new AbortController().signal).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(61000);
    expect(settled).toBe(false);
    expect(timeout).toHaveBeenCalledWith(180000);
    await vi.advanceTimersByTimeAsync(4000);
    expect((await pending)[0].type).toBe('image/png');
  });
  it('uses the model timeout and supports user cancellation while waiting', async () => {
    const { model, config } = setup('agnes');
    model.timeoutSeconds = 300;
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))));
    const controller = new AbortController();
    const pending = generateImages(config, { modelConfigId: model.id, prompt: 'City' }, controller.signal);
    controller.abort(new DOMException('User stopped', 'AbortError'));
    await expect(pending).rejects.toThrow('User stopped');
    expect(timeout).toHaveBeenCalledWith(300000);
    expect(() => validateImageModel({ ...model, timeoutSeconds: 59 }, config)).toThrow('60 and 600');
  });
  it('aborts exactly at the configured generation timeout without retrying', async () => {
    vi.useFakeTimers();
    const { model, config } = setup('agnes');
    model.timeoutSeconds = 90;
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Generation timed out', 'TimeoutError')), milliseconds);
      return controller.signal;
    });
    const mock = vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })));
    vi.stubGlobal('fetch', mock);
    let settled = false;
    const pending = generateImages(config, { modelConfigId: model.id, prompt: 'City' }, new AbortController().signal);
    const rejected = expect(pending.finally(() => { settled = true; })).rejects.toThrow('Generation timed out');
    await vi.advanceTimersByTimeAsync(89999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe('GPT-Image adapters', () => {
  const presets = ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2'] as const;
  for (const preset of presets) for (const withReference of [false, true]) {
    it(`${preset}: ${withReference ? 'multipart reference' : 'JSON generation'}`, async () => {
      const { model, config } = setup(preset);
      model.requestUrl = 'https://example.com/proxy/v1/images/generations';
      const mock = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] }));
      vi.stubGlobal('fetch', mock);
      const [image] = await generateImages(config, { modelConfigId: model.id, prompt: ' Watercolor city ', size: '1536x864', quality: 'medium', n: 1 }, new AbortController().signal, withReference ? reference : undefined);
      expect(image.type).toBe('image/png');
      expect(mock).toHaveBeenCalledTimes(1);
      const [url, request] = mock.mock.calls[0];
      expect(url).toBe(`https://example.com/proxy/v1/images/${withReference ? 'edits' : 'generations'}`);
      expect(request.headers.Authorization).toBe('Bearer secret');
      const expected = { model: preset, prompt: 'Watercolor city', size: '1536x864', quality: 'medium', n: 1, output_format: 'png' };
      if (!withReference) {
        expect(request.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(request.body)).toEqual(expected);
        expect(JSON.parse(request.body)).not.toHaveProperty('response_format');
      } else {
        expect(request.body).toBeInstanceOf(FormData);
        expect(request.headers).not.toHaveProperty('Content-Type');
        const body = request.body as FormData;
        for (const [key, value] of Object.entries(expected)) expect(body.get(key)).toBe(String(value));
        expect(body.has('mask')).toBe(false);
        expect(body.has('ratio')).toBe(false);
        const uploaded = body.get('image') as File;
        expect(uploaded.name).toBe('reference.png');
        expect(uploaded.type).toBe('image/png');
        expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(Uint8Array.from(atob('iVBORw0KGgo='), character => character.charCodeAt(0)));
      }
    });
  }
  for (const size of ['1024x1024', '1536x864', '864x1536', '2560x1440', '3840x2160', '2160x3840', '768x2304', '2304x768', '640x1024']) {
    it(`accepts supported custom dimensions ${size}`, () => {
      const { model, config } = setup('gpt-image-2');
      expect(() => validateImageModel({ ...model, size }, config)).not.toThrow();
    });
  }
  for (const size of ['1K', '1025x1024', '512x512', '3856x2048', '3840x3840', '512x2048', '2048x512', '1024x1000', '0x1024']) {
    it(`rejects unsupported custom dimensions ${size} before sending`, async () => {
      const { model, config } = setup('gpt-image-2');
      const mock = vi.fn();
      vi.stubGlobal('fetch', mock);
      await expect(generateImages(config, { modelConfigId: model.id, prompt: 'City', size }, new AbortController().signal)).rejects.toThrow('size requires');
      expect(mock).not.toHaveBeenCalled();
    });
  }
  it('uses model-specific quality limits consistently in validation, discovery and tool schemas', async () => {
    const { context, config } = toolContext();
    config.imageModels = presets.map(preset => ({ ...createImageModel(preset), endpointId: 'endpoint', enabled: true }));
    for (const model of config.imageModels) {
      const qualities = model.modelId === 'gpt-image-2' ? ['low', 'medium', 'high'] : ['low', 'medium', 'high', 'xhigh', 'max', 'auto'];
      expect(imageCapabilities(model).qualities).toEqual(qualities);
      const definition = imageToolDefinitions([model])[0];
      const properties = definition.function.parameters.properties as Record<string, Record<string, unknown>>;
      expect(properties.quality.enum).toEqual(qualities);
      expect(properties).not.toHaveProperty('ratio');
      if (model.modelId === 'gpt-image-2') {
        expect(() => validateImageModel({ ...model, quality: 'max' }, config)).toThrow('quality');
        expect(() => validateImageModel({ ...model, quality: 'auto' }, config)).toThrow('quality');
      }
      else expect(() => validateImageModel({ ...model, quality: 'max' }, config)).not.toThrow();
    }
    const listed = await executeImageTool('list_image_models', {}, context, new AbortController().signal);
    expect(listed.value).toMatchObject({ models: config.imageModels.map(model => ({ id: model.id, qualities: imageCapabilities(model).qualities, defaultQuality: 'high', maxImages: 10 })) });
    const profiles = defaultConfig();
    profiles.imageModels = config.imageModels.map(model => ({ ...model, endpointId: profiles.endpoints[0].id }));
    const request = toRequestConfig(profiles);
    expect(request.imageToolModels![0]).toMatchObject({ modelId: presets[0], quality: 'high', n: 1 });
    expect(JSON.stringify(imageToolDefinitions(request.imageToolModels))).toContain('quality');
  });
  it('resolves generation and edit URLs for root, versioned bases and explicit overrides', () => {
    expect(imageRequestUrl('https://example.com', '', 'edits')).toBe('https://example.com/v1/images/edits');
    expect(imageRequestUrl('https://example.com/proxy/v1/', '', 'edits')).toBe('https://example.com/proxy/v1/images/edits');
    expect(imageRequestUrl('https://example.com', 'https://example.com/v1/images/edits')).toBe('https://example.com/v1/images/generations');
    expect(() => imageRequestUrl('https://example.com', 'https://example.com/custom', 'edits')).toThrow('ending');
  });
  it('rejects unsupported counts, quality and ratios before any paid request', async () => {
    const { model, config } = setup('gpt-image-2');
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    for (const options of [{ n: 0 }, { n: 11 }, { n: 1.5 }, { quality: 'auto' as const }, { ratio: '16:9' }]) {
      await expect(generateImages(config, { modelConfigId: model.id, prompt: 'City', ...options }, new AbortController().signal)).rejects.toThrow();
    }
    expect(mock).not.toHaveBeenCalled();
    const kolors = setup('kolors');
    await expect(generateImages(kolors.config, { modelConfigId: kolors.model.id, prompt: 'City', n: 2 }, new AbortController().signal)).rejects.toThrow('not supported');
    await expect(generateImages(kolors.config, { modelConfigId: kolors.model.id, prompt: 'City', quality: 'high' }, new AbortController().signal)).rejects.toThrow('not supported');
    expect(mock).not.toHaveBeenCalled();
  });
  it('downloads all returned results without exposing credentials to signed result URLs', async () => {
    const { model, config } = setup('gpt-image-2.5-flare');
    model.n = 2;
    const mock = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }, { url: 'https://cdn.example.com/result.png?signature=original' }] }))
      .mockResolvedValueOnce(new Response(new Blob([Uint8Array.from(atob('iVBORw0KGgo='), character => character.charCodeAt(0))])));
    vi.stubGlobal('fetch', mock);
    const images = await generateImages(config, { modelConfigId: model.id, prompt: 'City' }, new AbortController().signal);
    expect(images).toHaveLength(2);
    expect(images.map(image => image.type)).toEqual(['image/png', 'image/png']);
    expect(JSON.parse(mock.mock.calls[0][1].body).n).toBe(2);
    expect(mock.mock.calls[1][0].href).toBe('https://cdn.example.com/result.png?signature=original');
    expect(mock.mock.calls[1][1].headers).toBeUndefined();
  });
  it('does not automatically retry failed or malformed GPT-Image responses', async () => {
    const { model, config } = setup('gpt-image-2');
    for (const response of [new Response('', { status: 503 }), Response.json({ data: [] }), Response.json({ data: [{}] })]) {
      const mock = vi.fn().mockResolvedValueOnce(response);
      vi.stubGlobal('fetch', mock);
      await expect(generateImages(config, { modelConfigId: model.id, prompt: 'City' }, new AbortController().signal)).rejects.toThrow();
      expect(mock).toHaveBeenCalledTimes(1);
    }
  });
});

function mockCanvas(output = new Blob(['webp'], { type: 'image/webp' })) {
  const canvases: { width: number; height: number }[] = [];
  class MockCanvas {
    width = 0;
    height = 0;
    getContext() { return { drawImage: () => {} }; }
    toBlob(callback: (blob: Blob) => void) { callback(output); }
  }
  vi.stubGlobal('HTMLCanvasElement', MockCanvas);
  vi.stubGlobal('document', { createElement: () => { const canvas = new MockCanvas(); canvases.push(canvas); return canvas; } });
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2048, height: 1536, close: () => {} }));
  return canvases;
}

function toolContext() {
  const { config, model } = setup('agnes');
  let project = { id: 'project', title: 'Test', layers: [], canvasConfig: { width: 1200, height: 630 }, background: { type: 'color', value: '#fff' } } as unknown as ProjectState;
  const images = new Map<string, Blob>();
  const refs: ChatImageRef[] = [];
  const commit = vi.fn(async (next: ProjectState) => { project = next; });
  const bridge: WorkspaceBridge = { getProject: () => project, getSelection: () => [], commit, manageProjects: async () => ({}) };
  const context: ImageToolContext = {
    getConfig: () => config, bridge,
    loadImage: async id => images.get(id) || null,
    saveImage: async (blob, name) => { const ref: ChatImageRef = { id: refs.length ? `generated-image-${refs.length + 1}` : 'generated-image', name, type: imageMimeType(blob.type), size: blob.size }; images.set(ref.id, blob); return ref; },
    onImage: image => refs.push(image)
  };
  return { config, model, images, refs, context, commit, getProject: () => project };
}

describe('image tools and persistence', () => {
  it('saves and places every GPT-Image result and returns all image and layer IDs', async () => {
    mockCanvas();
    const { context, model, images, refs, getProject, commit } = toolContext();
    Object.assign(model, createImageModel('gpt-image-2.5-sunburst'), { endpointId: 'endpoint', enabled: true, n: 2 });
    const mock = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }, { b64_json: 'iVBORw0KGgo=' }] }));
    vi.stubGlobal('fetch', mock);
    const result = await executeImageTool('generate_image', { projectId: 'project', prompt: 'City', quality: 'max' }, context, new AbortController().signal);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mock.mock.calls[0][1].body)).toMatchObject({ n: 2, quality: 'max' });
    expect(images.size).toBe(2);
    expect(refs).toHaveLength(2);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(getProject().layers).toHaveLength(2);
    expect(result.value).toMatchObject({ projectId: 'project', images: getProject().layers.map((layer, index) => ({ layerId: layer.id, imageId: refs[index].id })) });
    expect(JSON.stringify(result.value)).not.toContain('base64');
  });
  it('keeps every generated image saved if multi-image placement fails', async () => {
    mockCanvas();
    const { context, model, images, refs, commit } = toolContext();
    Object.assign(model, createImageModel('gpt-image-2'), { endpointId: 'endpoint', enabled: true, n: 2 });
    commit.mockRejectedValueOnce(new Error('Storage unavailable'));
    const mock = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }, { b64_json: 'iVBORw0KGgo=' }] }));
    vi.stubGlobal('fetch', mock);
    await expect(executeImageTool('generate_image', { projectId: 'project', prompt: 'City' }, context, new AbortController().signal)).rejects.toThrow('was generated and saved, but placement failed');
    expect(images.size).toBe(2);
    expect(refs).toHaveLength(2);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('downloads a signed Kolors result and persists image bytes instead of the expiring URL', async () => {
    mockCanvas();
    const { context, model, images, refs, getProject } = toolContext();
    Object.assign(model, createImageModel('kolors'), { endpointId: 'endpoint', enabled: true });
    const url = 'https://cdn.example.com/temporary/result.png?X-Amz-Expires=3600&X-Amz-Signature=example';
    const original = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
    const mock = vi.fn().mockResolvedValueOnce(Response.json({ images: [{ url }] })).mockResolvedValueOnce(new Response(original));
    vi.stubGlobal('fetch', mock);
    const generated = await executeImageTool('generate_image', { projectId: 'project', prompt: 'City' }, context, new AbortController().signal);
    const stored = images.get('generated-image')!;
    expect(await stored.arrayBuffer()).toEqual(await original.arrayBuffer());
    expect(refs[0].type).toBe('image/png');
    expect(getProject().layers[0].content).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(JSON.stringify({ project: getProject(), refs, result: generated.value })).not.toContain('X-Amz-');
    expect(JSON.stringify(generated.value)).not.toContain(url);
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it('reports an expired download without submitting another generation request', async () => {
    const { model, config } = setup('kolors');
    const mock = vi.fn().mockResolvedValueOnce(Response.json({ images: [{ url: 'https://cdn.example.com/image.png?signature=expired' }] })).mockResolvedValueOnce(new Response('', { status: 403 }));
    vi.stubGlobal('fetch', mock);
    await expect(generateImages(config, { modelConfigId: model.id, prompt: 'City' }, new AbortController().signal)).rejects.toThrow('Generated image download failed (HTTP 403)');
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it('does not expose the removed session image list tool', async () => {
    const { context } = toolContext();
    expect(JSON.stringify(imageToolDefinitions([]))).not.toContain('list_session_images');
    await expect(executeImageTool('list_session_images', {}, context, new AbortController().signal)).rejects.toThrow('Unsupported');
  });
  it('lists model-specific descriptions without repeating common prompt advice', async () => {
    const { context, model, config } = toolContext();
    model.description = 'first model requirements';
    const single = await executeImageTool('list_image_models', {}, context, new AbortController().signal);
    expect(JSON.stringify(single.value)).toContain(model.description);
    const second = { ...createImageModel('kolors'), enabled: true, endpointId: 'endpoint', description: 'second model requirements' };
    config.imageModels!.push(second);
    const multiple = await executeImageTool('list_image_models', {}, context, new AbortController().signal);
    expect(JSON.stringify(multiple.value)).toContain(model.description);
    expect(JSON.stringify(multiple.value)).toContain(second.description);
    for (const value of [single.value, multiple.value]) {
      expect(JSON.stringify(value)).not.toContain('textPromptDescription');
      expect(JSON.stringify(value)).not.toContain('referencePromptDescription');
      expect(JSON.stringify(value)).not.toContain('[主体]');
      expect(JSON.stringify(value)).not.toContain('[改变要求]');
    }
    expect(JSON.stringify(imageToolDefinitions([model, second]))).not.toContain(model.description);
  });
  it('requires explicit model selection and keeps legacy long configuration IDs behind short aliases', async () => {
    mockCanvas();
    const { context, model, config, getProject } = toolContext();
    model.id = 'legacy-config-id-123456789';
    const other = { ...createImageModel('kolors'), enabled: true, endpointId: 'endpoint' };
    config.imageModels!.push(other);
    const mock = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] }));
    vi.stubGlobal('fetch', mock);
    await expect(executeImageTool('generate_image', { projectId: 'project', prompt: 'City' }, context, new AbortController().signal)).rejects.toThrow('ambiguous');
    expect(mock).not.toHaveBeenCalled();
    const result = await executeImageTool('generate_image', { projectId: 'project', modelConfigId: imageModelToolId(model), prompt: 'City' }, context, new AbortController().signal);
    expect(imageModelToolId(model)).toBe('legacycon');
    expect(JSON.parse(mock.mock.calls[0][1].body).model).toBe('agnes-image-2.5-flash');
    expect(result.value).toMatchObject({ layerId: getProject().layers[0].id });
    expect(model.id).toBe('legacy-config-id-123456789');
  });
  it('rejects colliding short model IDs before saving configuration', () => {
    const profiles = defaultConfig();
    profiles.imageModels = [{ ...createImageModel('agnes'), id: 'abcdefghi-original' }, { ...createImageModel('kolors'), id: 'abcdefghi-other' }];
    expect(() => validateConfig(profiles)).toThrow('short ID');
  });
  it('checks the project before any paid request and does not switch a previously bound model', async () => {
    const { context, model } = toolContext();
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    await expect(executeImageTool('generate_image', { projectId: 'missing', prompt: 'City' }, context, new AbortController().signal)).rejects.toThrow('changed');
    await expect(executeImageTool('generate_image', { projectId: 'project', prompt: 'City' }, { ...context, defaultModelConfigId: 'removed' }, new AbortController().signal)).rejects.toThrow('disabled');
    expect(mock).not.toHaveBeenCalled();
    expect(model.enabled).toBe(true);
  });
  it('retains a generated image if the active project changes before placement', async () => {
    mockCanvas();
    const { context, images, refs, commit, getProject } = toolContext();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      context.bridge.getProject = () => ({ ...getProject(), id: 'another-project' });
      return Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] });
    }));
    await expect(executeImageTool('generate_image', { projectId: 'project', prompt: 'City' }, context, new AbortController().signal)).rejects.toThrow('generated and saved, but placement failed');
    expect(images.has('generated-image')).toBe(true);
    expect(refs).toHaveLength(1);
    expect(commit).not.toHaveBeenCalled();
    expect(getProject().layers).toHaveLength(0);
  });
  it('retains a generated image and reports placement errors instead of suggesting regeneration', async () => {
    mockCanvas();
    const { context, images, commit } = toolContext();
    commit.mockRejectedValueOnce(new Error('Storage unavailable'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] })));
    await expect(executeImageTool('generate_image', { projectId: 'project', prompt: 'City' }, context, new AbortController().signal)).rejects.toThrow('was generated and saved, but placement failed');
    expect(images.has('generated-image')).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it('lists descriptions and capabilities without leaking endpoint credentials', async () => {
    const { context, model } = toolContext();
    const result = await executeImageTool('list_image_models', {}, context, new AbortController().signal);
    expect(result.value).toMatchObject({ models: [{ id: model.id, description: model.description }] });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('https://example.com');
  });
  it('preserves original PNG bytes and MIME without re-encoding or putting pixels into tool output', async () => {
    const canvases = mockCanvas();
    const { model, context, images, refs, getProject } = toolContext();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] })));
    const generated = await executeImageTool('generate_image', { projectId: 'project', prompt: 'A city' }, context, new AbortController().signal);
    expect(canvases).toHaveLength(0);
    expect(generated.value).toMatchObject({ imageId: 'generated-image' });
    expect(JSON.stringify(generated.value)).not.toContain('base64');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ type: 'image/png', size: 8 });
    expect(refs[0].name).toMatch(/\.png$/);
    expect(new Uint8Array(await images.get('generated-image')!.arrayBuffer())).toEqual(Uint8Array.from(atob('iVBORw0KGgo='), character => character.charCodeAt(0)));
    expect(images.size).toBe(1);
    const layer = getProject().layers[0];
    expect(layer).toMatchObject({ type: 'image', x: 180, y: 0, width: 840, height: 630, content: 'data:image/png;base64,iVBORw0KGgo=', imageSource: model.modelId, imageDescription: 'A city' });
    const selected = await executeTool('get_selected_layers', {}, { ...context.bridge, getSelection: () => [layer.id] }, new AbortController().signal) as { layers: { image: { imageSource: string; imageDescription: string } }[]; images: unknown[] };
    expect(selected.layers[0].image).toMatchObject({ imageSource: model.modelId, imageDescription: 'A city' });
    expect(selected.images).toEqual([]);
    expect(layer.id).toMatch(/^[a-z0-9]{1,9}$/);
    expect(generated.value).toMatchObject({ projectId: 'project', layerId: layer.id });
    expect(getProject().layers).toHaveLength(1);
  });
  for (const [type, encoded, extension] of [
    ['image/jpeg', '/9j/2Q==', 'jpg'],
    ['image/webp', 'UklGRgAAAABXRUJQ', 'webp']
  ] as const) it(`preserves original ${extension} generation bytes and filename`, async () => {
    const canvases = mockCanvas();
    const { context, images, refs, getProject } = toolContext();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: encoded }] })));
    await executeImageTool('generate_image', { projectId: 'project', prompt: 'City' }, context, new AbortController().signal);
    expect(canvases).toHaveLength(0);
    expect(refs[0].type).toBe(type);
    expect(refs[0].name).toMatch(new RegExp(`\\.${extension}$`));
    expect(new Uint8Array(await images.get('generated-image')!.arrayBuffer())).toEqual(Uint8Array.from(atob(encoded), character => character.charCodeAt(0)));
    expect(getProject().layers[0].content).toBe(`data:${type};base64,${encoded}`);
  });
  it('places large generated images and uses existing layer tools to make them locked backgrounds', async () => {
    mockCanvas();
    const { context, getProject } = toolContext();
    const encoded = btoa(String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10) + '\0'.repeat(250000));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: encoded }] })));
    await executeImageTool('generate_image', { projectId: 'project', prompt: 'City' }, context, new AbortController().signal);
    expect(getProject().layers[0].content.length).toBeGreaterThan(200000);
    const layerId = getProject().layers[0].id;
    await executeTool('edit_layers', { projectId: 'project', action: 'back', layerIds: [layerId] }, context.bridge, new AbortController().signal);
    await executeTool('edit_layers', { projectId: 'project', action: 'update', layerIds: [layerId], properties: { locked: true } }, context.bridge, new AbortController().signal);
    expect(getProject().layers[0].locked).toBe(true);
    expect(getProject().background.type).toBe('color');
  });
  it('reads a single saved image as a reference and rejects ambiguous or stale inputs', async () => {
    mockCanvas();
    const { model, context, images, commit } = toolContext();
    images.set('reference', new Blob(['image'], { type: 'image/webp' }));
    const mock = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] }));
    vi.stubGlobal('fetch', mock);
    await executeImageTool('generate_image', { projectId: 'project', modelConfigId: model.id, prompt: 'Keep composition', referenceImageId: 'reference' }, context, new AbortController().signal);
    expect(JSON.parse(mock.mock.calls[0][1].body).extra_body.image).toEqual(['data:image/webp;base64,aW1hZ2U=']);
    commit.mockClear();
    await expect(executeImageTool('generate_image', { projectId: 'project', modelConfigId: model.id, prompt: 'Edit', referenceImageId: 'reference', referenceLayerId: 'layer' }, context, new AbortController().signal)).rejects.toThrow('one reference');
    await expect(executeImageTool('generate_image', { projectId: 'old', prompt: 'City' }, context, new AbortController().signal)).rejects.toThrow('changed');
    await expect(executeImageTool('generate_image', { projectId: 'project', prompt: 'City', referenceImageId: 'missing' }, context, new AbortController().signal)).rejects.toThrow('not found');
    expect(commit).not.toHaveBeenCalled();
  });
  it('uses the selected image layer as a reference without requiring a vision model or session image list', async () => {
    mockCanvas();
    const { context, model, getProject } = toolContext();
    const original = {
      id: 'selected-image', type: 'image' as const, name: 'My photo', content: 'data:image/png;base64,iVBORw0KGgo=',
      imageSource: 'upload', imageDescription: 'Street photo', x: 0, y: 0, width: 400, height: 300,
      rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1
    };
    getProject().layers.push(original);
    context.bridge.getSelection = () => [original.id];
    const preview = vi.fn();
    context.bridge.getLayerPreview = preview;
    const selected = await executeTool('get_selected_layers', {}, context.bridge, new AbortController().signal) as { layers: { id: string; image: { imageSource: string; imageDescription: string } }[] };
    expect(selected.layers[0]).toMatchObject({ id: original.id, image: { imageSource: 'upload', imageDescription: 'Street photo' } });
    expect(preview).not.toHaveBeenCalled();
    const mock = vi.fn().mockImplementation(async (url: string) => url.startsWith('data:')
      ? new Response(new Blob(['original'], { type: 'image/png' }))
      : Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] }));
    vi.stubGlobal('fetch', mock);
    await executeImageTool('generate_image', { projectId: 'project', referenceLayerId: selected.layers[0].id, prompt: 'Turn the street into a night scene' }, context, new AbortController().signal);
    expect(JSON.parse(mock.mock.calls[1][1].body).extra_body.image).toEqual(['data:image/webp;base64,d2VicA==']);
    expect(getProject().layers[1]).toMatchObject({ imageSource: model.modelId, imageDescription: 'Turn the street into a night scene' });
    expect(getProject().layers[0]).toEqual(original);
  });
  it('rechecks model enablement immediately before execution', async () => {
    const { context, model } = toolContext();
    await executeImageTool('list_image_models', {}, context, new AbortController().signal);
    model.enabled = false;
    await expect(executeImageTool('generate_image', { projectId: 'project', modelConfigId: model.id, prompt: 'City' }, context, new AbortController().signal)).rejects.toThrow('disabled');
  });
  it('rejects unknown fields, multiple reference arrays and the removed placement tool', async () => {
    const { context, model } = toolContext();
    await expect(executeImageTool('generate_image', { modelConfigId: model.id, prompt: 'City', images: ['a', 'b'] }, context, new AbortController().signal)).rejects.toThrow('parameter');
    await expect(executeImageTool('apply_image', { projectId: 'project', imageId: 'image', target: 'background', width: 100 }, context, new AbortController().signal)).rejects.toThrow('Unsupported');
  });
  it('persists full-size generated image bytes in the existing file chat store', async () => {
    const binary = new Map<string, Blob>();
    const store = createFileChatStore({ read: async () => null, write: async () => {}, readBinary: async path => binary.get(path) || null, writeBinary: async (path, blob) => { binary.set(path, blob); }, remove: async () => {}, removeDirectory: async () => {}, list: async () => [] }, 'files');
    const blob = new Blob([new Uint8Array(250000)], { type: 'image/webp' });
    await store.saveImage('session', 'generated', blob);
    const restored = await store.loadImage('session', 'generated');
    expect(restored?.size).toBe(250000);
    expect(await restored?.arrayBuffer()).toEqual(await blob.arrayBuffer());
    expect(binary.has('chat/images/session/generated.webp')).toBe(true);
  });
  it('preserves PNG, JPEG and WebP file formats across reads and prunes all three extensions', async () => {
    const binary = new Map<string, Blob>();
    const store = createFileChatStore({
      read: async () => null, write: async () => {}, readBinary: async path => binary.get(path) || null,
      writeBinary: async (path, blob) => { binary.set(path, blob); },
      remove: async path => { binary.delete(path); }, removeDirectory: async () => {},
      list: async path => [...binary.keys()].filter(key => key.startsWith(`${path}/`)).map(key => key.slice(path.length + 1))
    }, 'files');
    for (const [type, extension] of [['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp']]) {
      const original = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type });
      await store.saveImage('current', extension, original);
      const restored = await store.loadImage('current', extension);
      expect(restored?.type).toBe(type);
      expect(await restored?.arrayBuffer()).toEqual(await original.arrayBuffer());
      expect(binary.has(`chat/images/current/${extension}.${extension}`)).toBe(true);
      expect(await store.loadImage('other', extension)).toBeNull();
    }
    await store.pruneImages('current', ['png']);
    expect([...binary.keys()]).toEqual(['chat/images/current/png.png']);
    await store.saveImage('current', 'png', new Blob(['JPEG replacement'], { type: 'image/jpeg' }));
    expect((await store.loadImage('current', 'png'))?.type).toBe('image/jpeg');
    expect(binary.has('chat/images/current/png.png')).toBe(false);
    expect(binary.has('chat/images/current/png.jpg')).toBe(true);
  });
  it.each([undefined, 1, 2, 5])('forwards dynamic image tools and enforces failure budget %s', async maxImageFailures => {
    const { model, context, config } = toolContext();
    const profiles = defaultConfig();
    profiles.imageModels = [model];
    profiles.endpoints[0].id = 'endpoint';
    profiles.endpoints[0].endpoint = 'https://example.com/v1';
    model.description = 'Custom model requirements in actual API schema';
    let round = 0;
    let imageRequests = 0;
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, options: RequestInit) => {
      if (String(url).endsWith('/images/generations')) { imageRequests++; return new Response('', { status: 503 }); }
      requests.push(JSON.parse(options.body as string));
      round++;
      const output = round <= (maxImageFailures ?? 3) + 1
        ? [{ type: 'function_call', call_id: `call-${round}`, name: 'generate_image', arguments: JSON.stringify({ projectId: 'project', prompt: 'City' }) }]
        : [{ type: 'message', id: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Generation failed', annotations: [] }] }];
      return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'response', status: 'completed', output } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }));
    await runConversation({ config: { ...toRequestConfig(profiles), maxImageFailures, supportsVision: false }, input: [], bridge: context.bridge, signal: new AbortController().signal, onText: () => {}, onTool: () => {}, getImageConfig: () => config, loadImage: context.loadImage, saveImage: context.saveImage });
    expect(imageRequests).toBe(maxImageFailures ?? 3);
    expect(JSON.stringify(requests[0].tools)).toContain('generate_image');
    expect(JSON.stringify(requests[0].tools)).not.toContain('apply_image');
    expect(JSON.stringify(requests[0].tools)).not.toContain('list_image_models');
    expect(JSON.stringify(requests[0].tools)).toContain(model.description);
    expect(JSON.stringify(requests[0].tools)).not.toContain('[主体]');
    expect(JSON.stringify(requests[0].tools)).not.toContain('[改变要求]');
    expect(JSON.stringify(toRequestConfig(profiles).imageToolModels)).not.toContain('textPromptDescription');
    expect(JSON.stringify(toRequestConfig(profiles).imageToolModels)).not.toContain('referencePromptDescription');
    const outputs = (requests.at(-1)!.input as { type: string; output?: string }[])
      .filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output!));
    expect(outputs.at(-1)).toEqual({ error: 'Image generation failure limit reached in this turn.' });
    for (const output of outputs.slice(0, -1)) expect(output).toEqual({ error: 'Image generation failed (HTTP 503).' });
  });
  it('accumulates failures across successful generations and enforces the budget within one response batch', async () => {
    mockCanvas();
    const { context, model, config, getProject } = toolContext();
    const profiles = defaultConfig();
    profiles.imageModels = [model];
    profiles.endpoints[0].id = 'endpoint';
    profiles.endpoints[0].endpoint = 'https://example.com/v1';
    let imageRequests = 0;
    let rounds = 0;
    const results: { error?: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/images/generations')) {
        imageRequests++;
        return imageRequests === 2 ? Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] }) : new Response('', { status: 503 });
      }
      const output = ++rounds === 1
        ? Array.from({ length: 5 }, (_, index) => ({ type: 'function_call', call_id: `batch-${index}`, name: 'generate_image', arguments: JSON.stringify({ projectId: 'project', prompt: 'City' }) }))
        : [{ type: 'message', id: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done', annotations: [] }] }];
      return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'response', status: 'completed', output } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }));
    await runConversation({ config: { ...toRequestConfig(profiles), maxImageFailures: 2 }, input: [], bridge: context.bridge,
      signal: new AbortController().signal, onText: () => {},
      onTool: event => { if (event.status !== 'running') results.push(JSON.parse(event.result!)); },
      getImageConfig: () => config, loadImage: context.loadImage, saveImage: context.saveImage });
    expect(imageRequests).toBe(3);
    expect(getProject().layers).toHaveLength(1);
    expect(results).toHaveLength(5);
    expect(results[0]).toEqual({ error: 'Image generation failed (HTTP 503).' });
    expect(results[2]).toEqual({ error: 'Image generation failed (HTTP 503).' });
    for (const result of results.slice(3)) expect(result).toEqual({ error: 'Image generation failure limit reached in this turn.' });
  });
  for (const interrupted of [false, true]) it(`allows a new user message to retry after a previous ${interrupted ? 'interruption' : 'provider failure'}`, async () => {
    mockCanvas();
    const { context, model, config, getProject } = toolContext();
    const profiles = defaultConfig();
    profiles.imageModels = [model];
    profiles.endpoints[0].id = 'endpoint';
    profiles.endpoints[0].endpoint = 'https://example.com/v1';
    const controller = new AbortController();
    let history: Parameters<typeof runConversation>[0]['input'] = [];
    let turn = 1;
    let modelRequests = 0;
    let imageRequests = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/images/generations')) {
        imageRequests++;
        if (turn === 1 && interrupted) {
          controller.abort(new ConversationAbortError('panel_closed'));
          throw controller.signal.reason;
        }
        return turn === 1 ? new Response('', { status: 503 }) : Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] });
      }
      const output = modelRequests++ % 2 === 0
        ? [{ type: 'function_call', call_id: `call-${turn}`, name: 'generate_image', arguments: JSON.stringify({ projectId: 'project', prompt: 'City' }) }]
        : [{ type: 'message', id: `message-${turn}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done', annotations: [] }] }];
      return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'response', status: 'completed', output } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }));
    const options = {
      config: { ...toRequestConfig(profiles), supportsVision: false }, bridge: context.bridge,
      onText: () => {}, onTool: () => {}, getImageConfig: () => config, loadImage: context.loadImage, saveImage: context.saveImage,
      onHistory: (input: typeof history) => { history = input; }
    };
    const first = runConversation({ ...options, input: [{ role: 'user', content: 'Generate' }], signal: controller.signal });
    if (interrupted) await expect(first).rejects.toThrow('panel was closed');
    else await first;
    expect(imageRequests).toBe(1);
    expect(getProject().layers).toHaveLength(0);
    turn = 2;
    modelRequests = 0;
    const signal = new AbortController().signal;
    await runConversation({ ...options, input: [...history, { role: 'user', content: '配置问题，再试一下' }], signal });
    expect(imageRequests).toBe(2);
    expect(signal.aborted).toBe(false);
    expect(getProject().layers).toHaveLength(1);
  });
  it('returns the automatically created layer ID to the model in the next Responses round', async () => {
    mockCanvas();
    const { context, model, config, getProject } = toolContext();
    context.bridge.getSelection = () => getProject().selectedLayerId ? [getProject().selectedLayerId!] : [];
    const profiles = defaultConfig();
    profiles.imageModels = [model];
    profiles.endpoints[0].id = 'endpoint';
    profiles.endpoints[0].endpoint = 'https://example.com/v1';
    const requests: { input: { output?: string }[] }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, options: RequestInit) => {
      if (String(url).endsWith('/images/generations')) return Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] });
      requests.push(JSON.parse(options.body as string));
      const output = requests.length === 1
        ? [{ type: 'function_call', call_id: 'generate', name: 'generate_image', arguments: JSON.stringify({ projectId: 'project', prompt: 'City' }) }]
        : requests.length === 2
          ? [{ type: 'function_call', call_id: 'selected-image', name: 'get_selected_layers', arguments: '{}' }]
          : [{ type: 'message', id: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Placed', annotations: [] }] }];
      return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'response', status: 'completed', output } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }));
    await runConversation({ config: { ...toRequestConfig(profiles), supportsVision: false }, input: [], bridge: context.bridge, signal: new AbortController().signal, onText: () => {}, onTool: () => {}, getImageConfig: () => config, loadImage: context.loadImage, saveImage: context.saveImage, onImage: context.onImage });
    const result = JSON.parse(requests[1].input.at(-1)!.output!);
    expect(result.layerId).toBe(getProject().layers[0].id);
    expect(result.layerId.length).toBeLessThanOrEqual(9);
    expect(getProject().layers).toHaveLength(1);
    expect(JSON.parse(requests[2].input.at(-1)!.output!)).toMatchObject({ projectId: 'project', layers: [{ id: result.layerId, image: { imageSource: model.modelId, imageDescription: 'City' } }] });
    expect(JSON.stringify(requests.map(request => request.input))).not.toContain('base64');
  });
});