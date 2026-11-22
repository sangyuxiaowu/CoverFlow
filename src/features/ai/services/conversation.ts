import OpenAI from 'openai';
import { openAiAuthOptions, readResponse } from 'sang-ai-kit/responses';
import { normalizeUsage, prepareResponseInput } from 'sang-ai-kit/conversation-utils';
import { runToolLoop } from 'sang-ai-kit/tool-loop';
import type { Response, ResponseFunctionCallOutputItemList } from 'openai/resources/responses/responses';
import type { AiConfig, AiRequestConfig, ChatImageRef, RequestUsage, ResponseItem, ToolEvent, WorkspaceBridge } from '../types.ts';
import { generateId } from '../../../utils/helpers.ts';
import { TOOL_DEFINITIONS, VISION_TOOL_DEFINITIONS } from '../tools/definitions.ts';
import { coverFlowImageDefinition, createImageToolExtensions } from '../tools/imageTools.ts';
import { createBuiltInTools } from 'sang-ai-kit/built-in-tools';
import { executeTool } from '../tools/execute.ts';
import { record } from '../tools/validation.ts';
import { DEFAULT_MAX_TOOL_ROUNDS, normalizeEndpoint, reasoningPayload, validateRequestConfig } from './config.ts';
import { estimateToolInput } from './usage.ts';
import { normalizeSkills } from './skills.ts';
import { normalizeAiFeatures } from 'sang-ai-kit/features';

export { readResponse } from 'sang-ai-kit/responses';
export { normalizeUsage, sanitizeResponseItems } from 'sang-ai-kit/conversation-utils';

interface ConversationOptions {
  config: AiRequestConfig;
  input: ResponseItem[];
  bridge: WorkspaceBridge;
  signal: AbortSignal;
  onText: (text: string) => void;
  onReasoning?: (text: string, itemId?: string) => void;
  onTool: (event: ToolEvent) => void;
  onUsage?: (request: RequestUsage) => void;
  onHistory?: (input: ResponseItem[]) => void;
  loadImage?: (imageId: string) => Promise<Blob | null>;
  saveImage?: (blob: Blob, name: string) => Promise<ChatImageRef>;
  onImage?: (image: ChatImageRef) => void;
  onLimit?: () => void;
  getImageConfig?: () => AiConfig;
  shouldYield?: () => boolean;
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

export async function runConversation(options: ConversationOptions): Promise<string> {
  const { config, bridge, signal, onText, onTool } = options;
  validateRequestConfig(config);
  const baseURL = normalizeEndpoint(config.endpoint);
  const client = new OpenAI({ baseURL, ...openAiAuthOptions(config.apiKey), dangerouslyAllowBrowser: true, maxRetries: 0 });
  const input = structuredClone(options.input);
  const features = normalizeAiFeatures(config.features);
  const skills = features.skills ? normalizeSkills(config.skills) : [];
  const toolImages: ChatImageRef[] = [];
  const onImage = (image: ChatImageRef) => { toolImages.push(image); options.onImage?.(image); };
  const imageExtensions = createImageToolExtensions(bridge, options.loadImage);
  const builtIn = createBuiltInTools({
    config: { ...(options.getImageConfig?.() ?? { endpoints: [], activeSelection: { endpointId: '', modelId: '' } }),
      systemPrompt: config.systemPrompt, imageToolPrompt: '', skills, localFonts: config.localFonts, maxImageFailures: config.maxImageFailures },
    features: { ...features, imageGeneration: features.imageGeneration && Boolean(config.imageToolsEnabled) },
    loadImage: options.loadImage, saveImage: options.saveImage, onImage, imageExtensions
  });
  builtIn.tools = builtIn.tools.map(tool => {
    if (tool.name !== 'generate_image') return tool;
    const definition = coverFlowImageDefinition(tool);
    return { ...definition, execute: (args, signal) => {
      if (args.referenceImageId !== undefined || args.referenceImageIds !== undefined) throw new Error('Use references for all reference images.');
      return tool.execute(args, signal);
    } };
  });
  const tools = [
    ...TOOL_DEFINITIONS,
    ...(config.supportsVision ? VISION_TOOL_DEFINITIONS : []),
    ...builtIn.tools.map(({ execute, ...definition }) => ({ type: 'function' as const, function: definition }))
  ];
  let previewCount = 0;
  let failedNavigation: { name: string; callId: string } | undefined;
  const maxToolRounds = config.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  return runToolLoop<ResponseItem, Extract<Response['output'][number], { type: 'function_call' }>>({
    input, signal, maxRounds: maxToolRounds, onText, onHistory: options.onHistory, onLimit: options.onLimit, shouldYield: options.shouldYield,
    cancelledMessage: '操作已取消。',
    limitMessage: '已达到本轮工具调用上限。已完成的修改已保留，请检查画布后继续。',
    assistantMessage: content => ({ role: 'assistant', content }),
    request: async input => {
    const requestController = new AbortController();
    const abortRequest = () => requestController.abort(signal.reason);
    signal.addEventListener('abort', abortRequest, { once: true });
    const timeout = setTimeout(() => requestController.abort(new Error('AI request timed out after 120 seconds.')), 120000);
    let response: Response;
    let reported = false;
    let interrupted = false;
    let streamedText = '';
    const startTime = Date.now();
    const request = { id: generateId(), endpoint: baseURL, model: config.model, createdAt: startTime, inputEstimate: estimateToolInput(input, builtIn.instructions, tools) };
    try {
      const stream = await client.responses.create({
        model: config.model, instructions: builtIn.instructions, input: await prepareResponseInput(input, Boolean(config.supportsVision), options.loadImage),
        tools: tools.map(tool => ({ type: 'function' as const, ...tool.function, strict: false })),
        stream: true, store: false, max_output_tokens: config.maxTokens,
        ...reasoningPayload(config),
        ...(new URL(baseURL).hostname === 'api.openai.com' ? { include: ['reasoning.encrypted_content' as const] } : {})
      }, { signal: requestController.signal });
      response = await readResponse(stream, chunk => {
        streamedText += chunk;
        onText(chunk);
      }, requestController.signal, options.onReasoning, items => {
        if (!options.shouldYield?.()) return undefined;
        interrupted = true;
        return { status: 'completed', output: items } as Response;
      });
      const completedAt = Date.now();
      const durationMs = Math.max(1, completedAt - startTime);
      options.onUsage?.({ ...request, completedAt, durationMs, responseId: response.id, status: interrupted ? 'aborted' : response.status === 'incomplete' ? 'incomplete' : response.status === 'failed' ? 'failed' : 'completed', usage: normalizeUsage(response.usage) });
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
    const calls = response.output.filter(item => item.type === 'function_call');
    const output = response.output.filter(item => item.type === 'message' || item.type === 'reasoning' || item.type === 'function_call');
    failedNavigation = undefined;
    return { content: responseText(response) || streamedText, streamedText, calls, output, unsupportedOutput: output.length !== response.output.length };
    },
    execute: async (call, cancelled) => {
      const startedAt = Date.now();
      const started = performance.now();
      onTool({ id: call.call_id, name: call.name, arguments: call.arguments, status: 'running', startedAt });
      let result: string;
      let output: string | ResponseFunctionCallOutputItemList;
      let imageRef: ChatImageRef | undefined;
      let status: 'success' | 'error' = 'success';
      let navigation = call.name === 'create_project' || call.name === 'manage_projects' || call.name === 'manage_pages';
      toolImages.length = 0;
      try {
        signal.throwIfAborted();
        if (cancelled) throw new Error('User cancelled. Do not retry this operation without new approval.');
        if (failedNavigation) throw new Error(`Skipped: ${failedNavigation.name} (${failedNavigation.callId}) failed earlier in this tool batch. No operation was performed. Read the current context before continuing.`);
        if (!tools.some(tool => tool.function.name === call.name)) throw new Error('Unknown tool.');
        const args = record(JSON.parse(call.arguments));
        navigation = call.name === 'create_project'
          || (call.name === 'manage_pages' && args.action !== 'list' && args.action !== 'update')
          || (call.name === 'manage_projects' && args.action !== 'rename' && args.action !== 'duplicate' && args.action !== 'save');
        const sharedTool = builtIn.tools.find(tool => tool.name === call.name);
        const value = sharedTool ? await sharedTool.execute(args, signal)
          : await executeTool(call.name, args, bridge, signal, Boolean(config.supportsVision));
        if (call.name === 'get_canvas_preview' && value instanceof Blob) {
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
        status = 'error';
        if (navigation && !failedNavigation) failedNavigation = { name: call.name, callId: call.call_id };
        result = JSON.stringify(signal.aborted ? {
          error: 'Operation interrupted.', ...conversationAbortDetails(signal),
          retryPolicy: 'Do not automatically retry in this turn. A new explicit user request may retry.'
        } : { error: error instanceof Error ? error.message : 'Tool failed.' });
        output = result;
      }
      imageRef ??= toolImages[0];
      onTool({ id: call.call_id, name: call.name, arguments: call.arguments, status, startedAt, durationMs: Math.max(0, performance.now() - started), result, ...(imageRef ? { image: imageRef } : {}) });
      return { output: { type: 'function_call_output', call_id: call.call_id, output }, cancelled: status === 'error' && result.includes('User cancelled') };
    }
  });
}