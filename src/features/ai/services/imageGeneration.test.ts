import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiConfig, ChatImageRef, WorkspaceBridge } from '../types.ts';
import type { ProjectState } from '../../../types.ts';
import { availableImageModels, createImageModel, generateImages, imageCapabilities, IMAGE_MODEL_PRESETS, imageModelToolId, imageRequestUrl, imageTimeoutSeconds, validateImageModel, type ImagePresetId } from 'sang-ai-kit/image-generation';
import { createBuiltInTools, imageToolDefinitions as sharedImageDefinitions } from 'sang-ai-kit/built-in-tools';
import { syncProjectPages } from '../../../storage/projectCompatibility.ts';
import { ConversationAbortError, runConversation } from './conversation.ts';
import { DEFAULT_IMAGE_TOOL_PROMPT, defaultConfig, toRequestConfig, validateConfig } from './config.ts';
import { createFileChatStore } from './chatStore.ts';
import { imageMimeType } from 'sang-ai-kit/image-attachments';
import { coverFlowImageDefinition, createImageToolExtensions, IMAGE_TOOL_SCHEMAS } from '../tools/imageTools.ts';

const reference = 'data:image/png;base64,iVBORw0KGgo=';
interface ImageToolContext {
  bridge: WorkspaceBridge;
  loadImage: (id: string) => Promise<Blob | null>;
  saveImage: (blob: Blob, name: string) => Promise<ChatImageRef>;
  onImage: (image: ChatImageRef) => void;
}
const imageToolDefinitions = (models: Parameters<typeof sharedImageDefinitions>[0]) => sharedImageDefinitions(models).map(definition => ({ type: 'function', function: definition }));
async function executeImageTool(name: string, args: Record<string, unknown>, context: ImageToolContext & { getConfig: () => AiConfig }, signal: AbortSignal) {
  const tool = createBuiltInTools({ ...context, config: { ...context.getConfig(), systemPrompt: '' } }).tools.find(tool => tool.name === name);
  if (!tool) throw new Error('Unknown shared tool.');
  return { value: await tool.execute(args, signal) };
}
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
    expect(properties.prompt.description).toBe('生图提示词');
    expect(properties.prompt.description).not.toContain('2026-07-14');
    expect(properties.prompt.description).not.toContain('270 秒');
    const unknown = imageToolDefinitions([{ ...second, version: '', releasedAt: '' }])[0].function.parameters.properties as Record<string, { description: string }>;
    expect(unknown.prompt.description).toBe('生图提示词');
    expect(unknown.prompt.description).not.toContain('版本：未提供');
    expect(unknown.prompt.description).not.toContain('600 秒');
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
    expect(properties.prompt.description).toBe('生图提示词');
    expect(properties.prompt.description).not.toContain('[主体]');
    expect(properties.prompt.description).not.toContain('[改变要求]');
    expect(properties).not.toHaveProperty('modelConfigId');
    expect(properties).not.toHaveProperty('ratio');
    expect(parameters.required).toEqual(['prompt']);
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
  project = syncProjectPages(project);
  const images = new Map<string, Blob>();
  const refs: ChatImageRef[] = [];
  const commit = vi.fn(async (next: ProjectState) => { project = next; });
  const bridge: WorkspaceBridge = { getProject: () => project, getSelection: () => [], commit, manageProjects: async () => ({}) };
  const context: ImageToolContext & { getConfig: () => AiConfig } = {
    getConfig: () => config, bridge,
    loadImage: async id => images.get(id) || null,
    saveImage: async (blob, name) => { const ref: ChatImageRef = { id: refs.length ? `generated-image-${refs.length + 1}` : 'generated-image', name, type: imageMimeType(blob.type), size: blob.size }; images.set(ref.id, blob); return ref; },
    onImage: image => refs.push(image)
  };
  return { config, model, images, refs, context, commit, getProject: () => project };
}

describe('image tools and persistence', () => {
  it('propagates the configured reference limit into the exposed schema and runtime', async () => {
    const { context, model, config, images } = toolContext();
    model.maxReferenceImages = 2;
    const profiles = defaultConfig();
    profiles.imageModels = [model];
    profiles.endpoints[0].id = 'endpoint';
    profiles.endpoints[0].endpoint = 'https://example.com/v1';
    const snapshot = toRequestConfig(profiles);
    expect(snapshot.imageToolModels![0].maxReferenceImages).toBe(2);
    const definition = coverFlowImageDefinition(sharedImageDefinitions(snapshot.imageToolModels)[0]);
    expect(definition.parameters.properties).not.toHaveProperty('referenceImageIds');
    const hostDefinition = coverFlowImageDefinition(createBuiltInTools({ config, imageExtensions: createImageToolExtensions(context.bridge, context.loadImage) }).tools.find(tool => tool.name === 'generate_image')!);
    expect((hostDefinition.parameters.properties as Record<string, unknown>).references).toMatchObject({ maxItems: 2 });
    expect(IMAGE_TOOL_SCHEMAS.generate_image!.properties.references.type).toBe('array');
    images.set('upload', new Blob(['upload'], { type: 'image/png' }));
    const tool = createBuiltInTools({ config, imageExtensions: createImageToolExtensions(context.bridge, context.loadImage) }).tools.find(item => item.name === 'generate_image')!;
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(tool.execute({ prompt: 'City', references: ['attachment://upload', 'attachment://upload', 'attachment://upload'] }, new AbortController().signal)).rejects.toThrow('at most 2');
    expect(fetch).not.toHaveBeenCalled();
    model.maxReferenceImages = 0;
    const disabled = coverFlowImageDefinition(createBuiltInTools({ config, imageExtensions: createImageToolExtensions(context.bridge, context.loadImage) }).tools.find(item => item.name === 'generate_image')!);
    expect(disabled.parameters.properties).not.toHaveProperty('references');
  });
  it('reports an expired download without submitting another generation request', async () => {
    const { model, config } = setup('kolors');
    const mock = vi.fn().mockResolvedValueOnce(Response.json({ images: [{ url: 'https://cdn.example.com/image.png?signature=expired' }] })).mockResolvedValueOnce(new Response('', { status: 403 }));
    vi.stubGlobal('fetch', mock);
    await expect(generateImages(config, { modelConfigId: model.id, prompt: 'City' }, new AbortController().signal)).rejects.toThrow('Generated image download failed (HTTP 403)');
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it('rejects colliding short model IDs before saving configuration', () => {
    const profiles = defaultConfig();
    profiles.imageModels = [{ ...createImageModel('agnes'), id: 'abcdefghi-original' }, { ...createImageModel('kolors'), id: 'abcdefghi-other' }];
    expect(() => validateConfig(profiles)).toThrow('short ID');
  });
  for (const [type, encoded, extension] of [
    ['image/jpeg', '/9j/2Q==', 'jpg'],
    ['image/webp', 'UklGRgAAAABXRUJQ', 'webp']
  ] as const) it(`preserves original ${extension} generation bytes and filename`, async () => {
    const canvases = mockCanvas();
    const { context, images, refs, getProject } = toolContext();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: encoded }] })));
    await executeImageTool('generate_image', { prompt: 'City' }, context, new AbortController().signal);
    expect(canvases).toHaveLength(0);
    expect(refs[0].type).toBe(type);
    expect(refs[0].name).toMatch(new RegExp(`\\.${extension}$`));
    expect(new Uint8Array(await images.get('generated-image')!.arrayBuffer())).toEqual(Uint8Array.from(atob(encoded), character => character.charCodeAt(0)));
    expect(getProject().layers).toHaveLength(0);
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
  it('reads the hinted format first and falls back when the hint is stale', async () => {
    const readBinary = vi.fn(async (path: string) => path.endsWith('.webp') ? new Blob(['image'], { type: 'image/webp' }) : null);
    const store = createFileChatStore({ read: async () => null, write: async () => {}, readBinary,
      writeBinary: async () => {}, remove: async () => {}, removeDirectory: async () => {}, list: async () => [] }, 'files');
    expect((await store.loadImage('session', 'image', 'image/webp'))?.type).toBe('image/webp');
    expect(readBinary.mock.calls.map(([path]) => path)).toEqual(['chat/images/session/image.webp']);
    readBinary.mockClear();
    expect((await store.loadImage('session', 'image', 'image/jpeg'))?.type).toBe('image/webp');
    expect(readBinary.mock.calls.map(([path]) => path)).toEqual(['chat/images/session/image.jpg', 'chat/images/session/image.png', 'chat/images/session/image.webp']);
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
        ? [{ type: 'function_call', call_id: `call-${round}`, name: 'generate_image', arguments: JSON.stringify({ prompt: 'City' }) }]
        : [{ type: 'message', id: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Generation failed', annotations: [] }] }];
      return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'response', status: 'completed', output } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }));
    await runConversation({ config: { ...toRequestConfig(profiles), maxImageFailures, supportsVision: false }, input: [], bridge: context.bridge, signal: new AbortController().signal, onText: () => {}, onTool: () => {}, getImageConfig: () => config, loadImage: context.loadImage, saveImage: context.saveImage });
    expect(imageRequests).toBe(maxImageFailures ?? 3);
    expect(JSON.stringify(requests[0].tools)).toContain('generate_image');
    expect(JSON.stringify(requests[0].tools)).not.toContain('apply_image');
    expect(JSON.stringify(requests[0].tools)).not.toContain('list_image_models');
    expect(JSON.stringify(requests[0].tools)).not.toContain(model.description);
    expect(JSON.stringify(requests[0].tools)).not.toContain('[主体]');
    expect(JSON.stringify(requests[0].tools)).not.toContain('[改变要求]');
    expect(JSON.stringify(toRequestConfig(profiles).imageToolModels)).not.toContain('textPromptDescription');
    expect(JSON.stringify(toRequestConfig(profiles).imageToolModels)).not.toContain('referencePromptDescription');
    const outputs = (requests.at(-1)!.input as { type: string; output?: string }[])
      .filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output!));
    expect(outputs.at(-1)).toEqual({ error: 'Image generation failure limit reached in this turn.' });
    for (const output of outputs.slice(0, -1)) expect(output).toEqual({ error: 'Image generation failed (HTTP 503).' });
  });
  it('does not impose a failure budget when the limit is zero', async () => {
    const { model, context, config } = toolContext();
    const profiles = defaultConfig();
    profiles.imageModels = [model];
    profiles.endpoints[0].id = 'endpoint';
    profiles.endpoints[0].endpoint = 'https://example.com/v1';
    let imageRequests = 0;
    let round = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/images/generations')) { imageRequests++; return new Response('', { status: 503 }); }
      const output = ++round <= 4
        ? [{ type: 'function_call', call_id: `zero-${round}`, name: 'generate_image', arguments: JSON.stringify({ prompt: 'City' }) }]
        : [{ type: 'message', id: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done', annotations: [] }] }];
      return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'response', status: 'completed', output } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }));
    await runConversation({ config: { ...toRequestConfig(profiles), maxImageFailures: 0, maxToolRounds: 0 }, input: [], bridge: context.bridge, signal: new AbortController().signal, onText: () => {}, onTool: () => {}, getImageConfig: () => config, loadImage: context.loadImage, saveImage: context.saveImage });
    expect(imageRequests).toBe(4);
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
        ? Array.from({ length: 5 }, (_, index) => ({ type: 'function_call', call_id: `batch-${index}`, name: 'generate_image', arguments: JSON.stringify({ prompt: 'City' }) }))
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
        ? [{ type: 'function_call', call_id: `call-${turn}`, name: 'generate_image', arguments: JSON.stringify({ prompt: 'City' }) }]
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
  it('archives the generated image and places it on the canvas in one tool call', async () => {
    mockCanvas();
    const { context, model, config, getProject, images, refs } = toolContext();
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
        ? [{ type: 'function_call', call_id: 'generate', name: 'generate_image', arguments: JSON.stringify({ prompt: 'City' }) }]
        : [{ type: 'message', id: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Placed', annotations: [] }] }];
      return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'response', status: 'completed', output } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }));
    await runConversation({ config: { ...toRequestConfig(profiles), supportsVision: false }, input: [], bridge: context.bridge, signal: new AbortController().signal, onText: () => {}, onTool: () => {}, getImageConfig: () => config, loadImage: context.loadImage, saveImage: context.saveImage, onImage: context.onImage });
    const result = JSON.parse(requests[1].input.at(-1)!.output!);
    expect(result.layerId).toBe(getProject().layers[0].id);
    expect(result.layerId.length).toBeLessThanOrEqual(9);
    expect(getProject().layers).toHaveLength(1);
    expect(getProject().layers[0]).toMatchObject({ imageSource: model.modelId, imageDescription: 'City' });
    expect(images.size).toBe(1);
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toMatch(/^generated-/);
    expect(result.images).toMatchObject([{ id: refs[0].id }]);
    expect(result).not.toHaveProperty('imageId');
    expect(JSON.stringify(requests.map(request => request.input))).not.toContain('base64');
  });
  it('forwards mixed layer and attachment references in order without saving intermediate images', async () => {
    mockCanvas();
    const { context, model, config, getProject, images, refs } = toolContext();
    model.maxReferenceImages = 2;
    images.set('upload', new Blob(['upload'], { type: 'image/png' }));
    getProject().layers.push({ id: 'source', type: 'image', name: 'Source', content: reference,
      x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 });
    const profiles = defaultConfig();
    profiles.imageModels = [model];
    profiles.endpoints[0].id = 'endpoint';
    profiles.endpoints[0].endpoint = 'https://example.com/v1';
    const originalFetch = globalThis.fetch;
    let generationBody: { extra_body: { image: string[] } } | undefined;
    let round = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, options: RequestInit) => {
      if (String(url).startsWith('data:')) return originalFetch(url, options);
      if (String(url).endsWith('/images/generations')) {
        generationBody = JSON.parse(options.body as string);
        return Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] });
      }
      const output = ++round === 1
        ? [{ type: 'function_call', call_id: 'generate', name: 'generate_image', arguments: JSON.stringify({ prompt: 'City', references: ['source', 'attachment://upload'] }) }]
        : [{ type: 'message', id: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done', annotations: [] }] }];
      return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'response', status: 'completed', output } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }));
    await runConversation({ config: { ...toRequestConfig(profiles), supportsVision: false }, input: [], bridge: context.bridge, signal: new AbortController().signal,
      onText: () => {}, onTool: () => {}, getImageConfig: () => config, loadImage: context.loadImage, saveImage: context.saveImage, onImage: context.onImage });
    expect(generationBody?.extra_body.image).toEqual([reference, 'data:image/png;base64,dXBsb2Fk']);
    expect(getProject().layers).toHaveLength(2);
    expect(images.size).toBe(2);
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toMatch(/^generated-/);
  });
  it('saves a recovery image after failed canvas commit and prevents automatic regeneration', async () => {
    mockCanvas();
    const { context, model, config, commit, refs } = toolContext();
    const profiles = defaultConfig();
    profiles.imageModels = [model];
    profiles.endpoints[0].id = 'endpoint';
    profiles.endpoints[0].endpoint = 'https://example.com/v1';
    commit.mockRejectedValueOnce(new Error('Disk full'));
    let round = 0, imageRequests = 0;
    const results: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/images/generations')) {
        imageRequests++;
        return Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] });
      }
      const output = ++round <= 2
        ? [{ type: 'function_call', call_id: `generate-${round}`, name: 'generate_image', arguments: JSON.stringify({ prompt: 'City' }) }]
        : [{ type: 'message', id: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Failed', annotations: [] }] }];
      return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'response', status: 'completed', output } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }));
    await runConversation({ config: { ...toRequestConfig(profiles), supportsVision: false }, input: [], bridge: context.bridge, signal: new AbortController().signal,
      onText: () => {}, onTool: event => { if (event.status === 'error') results.push(event.result!); },
      getImageConfig: () => config, loadImage: context.loadImage, saveImage: context.saveImage, onImage: context.onImage });
    expect(imageRequests).toBe(1);
    expect(commit).toHaveBeenCalledOnce();
    expect(refs).toHaveLength(1);
    expect(results[0]).toContain('may already be applied');
    expect(results[0]).toContain(`Recovery image IDs: ${refs[0].id}`);
    expect(results[1]).toContain('Do not retry');
  });
  it.each(['layer', 'attachment'] as const)('removes background from %s directly onto the canvas without intermediate session images', async source => {
    mockCanvas();
    const { context, config, getProject, images, refs } = toolContext();
    const originalFetch = globalThis.fetch;
    const sourceBlob = new Blob([Uint8Array.from(atob('iVBORw0KGgo='), c => c.charCodeAt(0))], { type: 'image/png' });
    if (source === 'layer') getProject().layers.push({ id: 'source', type: 'image', name: 'Source', content: reference,
      x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1, visible: true, locked: false, opacity: 1 });
    else images.set('attachment', sourceBlob);
    let workerImage: Blob | undefined;
    class TestWorker {
      onmessage?: (event: { data: { blob: Blob } }) => void;
      terminate() {}
      postMessage(message: { image: Blob }) {
        workerImage = message.image;
        queueMicrotask(() => this.onmessage?.({ data: { blob: sourceBlob } }));
      }
    }
    vi.stubGlobal('Worker', TestWorker);
    let round = 0;
    let result: { layerId: string; backgroundRemoved: boolean } | undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, options: RequestInit) => {
      if (String(url).startsWith('data:')) return originalFetch(url, options);
      const request = JSON.parse(options.body as string);
      if (++round === 2) result = JSON.parse(request.input.at(-1).output);
      const output = round === 1
        ? [{ type: 'function_call', call_id: 'remove', name: 'remove_background', arguments: JSON.stringify({
          modelId: 'color', colorOptions: { tolerance: 0, feather: 0, contiguous: false },
          ...(source === 'layer' ? { layerId: 'source' } : { imageId: 'attachment' })
        }) }]
        : [{ type: 'message', id: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done', annotations: [] }] }];
      return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'response', status: 'completed', output } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }));
    await runConversation({ config: { ...toRequestConfig(defaultConfig()), endpoint: 'https://example.com/v1', supportsVision: false }, input: [], bridge: context.bridge,
      signal: new AbortController().signal, onText: () => {}, onTool: () => {}, getImageConfig: () => config,
      loadImage: context.loadImage, saveImage: context.saveImage, onImage: context.onImage });
    expect(await workerImage!.arrayBuffer()).toEqual(await sourceBlob.arrayBuffer());
    expect(result?.backgroundRemoved).toBe(true);
    expect(getProject().layers.find(layer => layer.id === result?.layerId)?.backgroundRemoved).toBe(true);
    if (source === 'layer') expect(getProject().layers.find(layer => layer.id === 'source')?.visible).toBe(false);
    expect(images.size).toBe(source === 'attachment' ? 1 : 0);
    expect(refs).toHaveLength(0);
  });
});