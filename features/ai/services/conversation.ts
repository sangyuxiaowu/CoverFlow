import OpenAI from 'openai';
import type { Response, ResponseFunctionCallOutputItemList, ResponseStreamEvent } from 'openai/resources/responses/responses';
import type { AiConfig, AiRequestConfig, ChatImageRef, RequestUsage, ResponseItem, TokenUsage, ToolEvent, WorkspaceBridge } from '../types.ts';
import { imageToolDefinitions, IMAGE_TOOL_DEFINITIONS, TOOL_DEFINITIONS, VISION_TOOL_DEFINITIONS } from '../tools/definitions.ts';
import { executeImageTool } from '../tools/imageTools.ts';
import { executeTool } from '../tools/execute.ts';
import { record } from '../tools/validation.ts';
import { normalizeEndpoint, reasoningPayload, validateRequestConfig } from './config.ts';
import { estimateInput } from './usage.ts';
import { blobToDataUrl } from './imageAttachments.ts';

interface ConversationOptions {
  config: AiRequestConfig;
  input: ResponseItem[];
  bridge: WorkspaceBridge;
  signal: AbortSignal;
  onText: (text: string) => void;
  onReasoning?: (text: string) => void;
  onTool: (event: ToolEvent) => void;
  onUsage?: (request: RequestUsage) => void;
  onHistory?: (input: ResponseItem[]) => void;
  loadImage?: (imageId: string) => Promise<Blob | null>;
  saveImage?: (blob: Blob, name: string) => Promise<ChatImageRef>;
  onImage?: (image: ChatImageRef) => void;
  onLimit?: () => void;
  getImageConfig?: () => AiConfig;
}

export type ConversationAbortSource = 'user_stop' | 'panel_closed' | 'storage_changed' | 'assistant_disposed';

export class ConversationAbortError extends Error {
  constructor(readonly source: ConversationAbortSource) {
    const reasons: Record<ConversationAbortSource, string> = {
      user_stop: 'The user clicked Stop.',
      panel_closed: 'The AI assistant panel was closed.',
      storage_changed: 'The chat storage location changed.',
      assistant_disposed: 'The AI assistant was unmounted or reloaded.'
    };
    super(reasons[source]);
    this.name = 'AbortError';
  }
}

export function conversationAbortDetails(signal: AbortSignal) {
  return {
    abortSource: signal.reason instanceof ConversationAbortError ? signal.reason.source : 'unknown',
    reason: signal.reason instanceof Error ? signal.reason.message : typeof signal.reason === 'string' ? signal.reason : 'No interruption reason was recorded.'
  };
}

export function normalizeUsage(usage: Response['usage'] | null): TokenUsage | undefined {
  if (!usage || ![usage.input_tokens, usage.output_tokens, usage.total_tokens].every(value => Number.isInteger(value) && value >= 0)) return undefined;
  const cached = usage.input_tokens_details?.cached_tokens;
  const reasoning = usage.output_tokens_details?.reasoning_tokens;
  return {
    inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.total_tokens,
    ...(Number.isInteger(cached) && cached >= 0 ? { cachedTokens: cached } : {}),
    ...(Number.isInteger(reasoning) && reasoning >= 0 ? { reasoningTokens: reasoning } : {})
  };
}

export async function readResponse(events: AsyncIterable<ResponseStreamEvent>, onText: (text: string) => void, signal: AbortSignal, onReasoning?: (text: string) => void): Promise<Response> {
  for await (const event of events) {
    signal.throwIfAborted();
    if (event.type === 'response.output_text.delta') onText(event.delta);
    if (event.type === 'response.reasoning_text.delta' || event.type === 'response.reasoning_summary_text.delta') onReasoning?.(event.delta);
    if (event.type === 'error') throw new Error(event.message || 'AI stream returned an error.');
    if (event.type === 'response.completed' || event.type === 'response.incomplete' || event.type === 'response.failed') return event.response;
  }
  throw new Error('AI stream disconnected before completion.');
}

function responseText(response: Response): string {
  const texts: string[] = [];
  for (const item of response.output) {
    if (item.type === 'message') for (const part of item.content) {
      if (part.type === 'output_text') texts.push(part.text);
      if (part.type === 'refusal') texts.push(part.refusal);
    }
  }
  return texts.join('');
}

export function sanitizeResponseItems(items: ResponseItem[]): ResponseItem[] {
  const result: ResponseItem[] = [];
  const pendingCalls = new Set<string>();

  for (const item of items) {
    if ('type' in item && item.type === 'function_call' && item.call_id) {
      pendingCalls.add(item.call_id);
      result.push(item);
    } else if ('type' in item && item.type === 'function_call_output' && item.call_id) {
      pendingCalls.delete(item.call_id);
      result.push(item);
    } else {
      result.push(item);
    }
  }

  if (pendingCalls.size > 0) {
    return result.filter(item => !('type' in item && item.type === 'function_call' && item.call_id && pendingCalls.has(item.call_id)));
  }
  return result;
}

async function hydrateImageReferences(items: ResponseItem[], loadImage?: (imageId: string) => Promise<Blob | null>): Promise<ResponseItem[]> {
  const result = structuredClone(items) as unknown as Record<string, unknown>[];
  if (!loadImage) return result as unknown as ResponseItem[];
  const hydrateParts = async (parts: unknown[]) => Promise.all(parts.map(async part => {
    if (!part || typeof part !== 'object') return part;
    const image = part as { type?: string; image_url?: string | null };
    if (image.type !== 'input_image' || !image.image_url?.startsWith('attachment://')) return part;
    const blob = await loadImage(image.image_url.slice('attachment://'.length));
    if (!blob) throw new Error('A referenced chat image is missing.');
    return { ...image, image_url: await blobToDataUrl(blob) };
  }));
  for (const item of result) {
    if (Array.isArray(item.content)) item.content = await hydrateParts(item.content);
    if (item.type === 'function_call_output' && Array.isArray(item.output)) item.output = await hydrateParts(item.output);
  }
  return result as unknown as ResponseItem[];
}

export async function runConversation(options: ConversationOptions): Promise<string> {
  const { config, bridge, signal, onText, onTool } = options;
  validateRequestConfig(config);
  if (!config.supportsVision && JSON.stringify(options.input).includes('attachment://')) throw new Error('The selected model is not configured for image input.');
  const baseURL = normalizeEndpoint(config.endpoint);
  const client = new OpenAI({ baseURL, apiKey: config.apiKey || 'local', dangerouslyAllowBrowser: true, maxRetries: 0 });
  const input = structuredClone(options.input);
  const tools = [...TOOL_DEFINITIONS, ...(config.supportsVision ? VISION_TOOL_DEFINITIONS : []), ...(config.imageToolsEnabled && options.getImageConfig && options.loadImage && options.saveImage ? imageToolDefinitions(config.imageToolModels) : [])];
  let previewCount = 0;
  let generationFailed = false;
  for (let round = 0; round < 24; round++) {
    signal.throwIfAborted();
    const requestController = new AbortController();
    const abortRequest = () => requestController.abort(signal.reason);
    signal.addEventListener('abort', abortRequest, { once: true });
    const timeout = setTimeout(() => requestController.abort(new Error('AI request timed out after 120 seconds.')), 120000);
    let response: Response;
    let reported = false;
    let streamedText = '';
    const startTime = Date.now();
    const request = { id: crypto.randomUUID(), endpoint: baseURL, model: config.model, createdAt: startTime, inputEstimate: estimateInput(input, config.systemPrompt, config.supportsVision, tools.some(tool => tool.function.name === 'generate_image'), config.imageToolModels) };
    try {
      const stream = await client.responses.create({
        model: config.model, instructions: config.systemPrompt, input: await hydrateImageReferences(input, options.loadImage),
        tools: tools.map(tool => ({ type: 'function' as const, ...tool.function, strict: false })),
        stream: true, store: false, max_output_tokens: config.maxTokens,
        ...reasoningPayload(config),
        ...(new URL(baseURL).hostname === 'api.openai.com' ? { include: ['reasoning.encrypted_content' as const] } : {})
      }, { signal: requestController.signal });
      response = await readResponse(stream, chunk => {
        streamedText += chunk;
        onText(chunk);
      }, requestController.signal, options.onReasoning);
      const completedAt = Date.now();
      const durationMs = Math.max(1, completedAt - startTime);
      options.onUsage?.({ ...request, completedAt, durationMs, responseId: response.id, status: response.status === 'incomplete' ? 'incomplete' : response.status === 'failed' ? 'failed' : 'completed', usage: normalizeUsage(response.usage) });
      reported = true;
      if (response.status === 'incomplete') throw new Error(`Response incomplete: ${response.incomplete_details?.reason || 'unknown'}. Increase output tokens or start a new session.`);
      if (response.status === 'failed' || response.error) throw new Error(response.error?.message || 'AI response failed.');
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abortRequest);
      if (!reported) {
        const completedAt = Date.now();
        const durationMs = Math.max(1, completedAt - startTime);
        options.onUsage?.({ ...request, completedAt, durationMs, status: signal.aborted ? 'aborted' : 'failed' });
      }
    }
    const content = responseText(response);
    if (content && !streamedText) onText(content);
    const calls = response.output.filter(item => item.type === 'function_call');
    if (!content && !calls.length) throw new Error('Empty model response.');
    if (calls.length > 30 || calls.some(call => !call.call_id || !call.name)) throw new Error('Invalid or too many tool calls.');
    const output = response.output.filter(item => item.type === 'message' || item.type === 'reasoning' || item.type === 'function_call');
    if (output.length !== response.output.length) throw new Error('Unsupported model output item.');
    input.push(...output);
    let cancelled = false;
    for (const call of calls) {
      const startedAt = Date.now();
      const started = performance.now();
      onTool({ id: call.call_id, name: call.name, arguments: call.arguments, status: 'running', startedAt });
      let result: string;
      let output: string | ResponseFunctionCallOutputItemList;
      let imageRef: ChatImageRef | undefined;
      let status: 'success' | 'error' = 'success';
      try {
        signal.throwIfAborted();
        if (cancelled) throw new Error('User cancelled. Do not retry this operation without new approval.');
        if (!tools.some(tool => tool.function.name === call.name)) throw new Error('Unknown tool.');
        const args = record(JSON.parse(call.arguments));
        const isImageTool = IMAGE_TOOL_DEFINITIONS.some(tool => tool.function.name === call.name);
        if (call.name === 'generate_image' && generationFailed) throw new Error('A generation already failed in this turn. Ask the user before trying again.');
        const generated = isImageTool ? await executeImageTool(call.name, args, {
          getConfig: options.getImageConfig!,
          defaultModelConfigId: config.imageToolModels?.length === 1 ? config.imageToolModels[0].id : undefined,
          loadImage: options.loadImage!, saveImage: options.saveImage!, onImage: image => options.onImage?.(image), bridge
        }, signal) : undefined;
        const value = generated ? generated.value : await executeTool(call.name, args, bridge, signal, Boolean(config.supportsVision));
        if (call.name === 'remove_background' && value && typeof value === 'object' && 'success' in value && value.success === false) status = 'error';
        if (generated) {
          imageRef = generated.image;
          result = JSON.stringify(value);
          output = result;
        } else if (call.name === 'get_canvas_preview' && value instanceof Blob) {
          if (!options.saveImage) throw new Error('Image storage is unavailable.');
          imageRef = await options.saveImage(value, `canvas-preview-${++previewCount}.webp`);
          options.onImage?.(imageRef);
          output = [{ type: 'input_image', image_url: `attachment://${imageRef.id}` }];
          result = JSON.stringify({ imageId: imageRef.id, image: imageRef.name, widthLimit: 600, format: 'webp' });
          output.push({ type: 'input_text', text: result });
        } else if (call.name === 'get_selected_layers' && value && typeof value === 'object' && 'kind' in value && value.kind === 'selected_layers') {
          const selected = value as unknown as { projectId: string; layers: unknown[]; images: { layerId: string; name: string; blob: Blob }[] };
          result = JSON.stringify({ projectId: selected.projectId, layers: selected.layers });
          const imageParts: { type: 'input_image'; image_url: string }[] = [];
          for (const image of selected.images) {
            if (!options.saveImage) throw new Error('Image storage is unavailable.');
            const ref = await options.saveImage(image.blob, `layer-${image.layerId}.webp`);
            imageRef ??= ref;
            options.onImage?.(ref);
            imageParts.push({ type: 'input_image', image_url: `attachment://${ref.id}` });
          }
          output = imageParts.length ? [{ type: 'input_text', text: result }, ...imageParts] : result;
        } else {
          result = JSON.stringify(value);
          output = result;
        }
      } catch (error) {
        if (call.name === 'generate_image') generationFailed = true;
        status = 'error';
        result = JSON.stringify(signal.aborted ? {
          error: 'Operation interrupted.', ...conversationAbortDetails(signal),
          retryPolicy: 'Do not automatically retry in this turn. A new explicit user request may retry.'
        } : { error: error instanceof Error ? error.message : 'Tool failed.' });
        output = result;
      }
      input.push({ type: 'function_call_output', call_id: call.call_id, output });
      onTool({ id: call.call_id, name: call.name, arguments: call.arguments, status, startedAt, durationMs: Math.max(0, performance.now() - started), result, ...(imageRef ? { image: imageRef } : {}) });
      if (status === 'error' && result.includes('User cancelled')) cancelled = true;
    }
    if (cancelled) {
      input.push({ role: 'assistant', content: '操作已取消。' });
    }
    options.onHistory?.(structuredClone(input));
    signal.throwIfAborted();
    if (cancelled) return '操作已取消。';
    if (!calls.length) return content;
  }
  const limit = { role: 'assistant' as const, content: '已达到本轮工具调用上限。已完成的修改已保留，请检查画布后继续。' };
  options.onLimit?.();
  input.push(limit);
  options.onHistory?.(structuredClone(input));
  return limit.content;
}