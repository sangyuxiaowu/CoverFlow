import OpenAI from 'openai';
import type { Response, ResponseStreamEvent } from 'openai/resources/responses/responses';
import type { AiRequestConfig, RequestUsage, ResponseItem, TokenUsage, ToolEvent, WorkspaceBridge } from '../types.ts';
import { TOOL_DEFINITIONS } from '../tools/definitions.ts';
import { executeTool } from '../tools/execute.ts';
import { record } from '../tools/validation.ts';
import { normalizeEndpoint, reasoningPayload, validateRequestConfig } from './config.ts';
import { estimateInput } from './usage.ts';

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

export async function runConversation(options: ConversationOptions): Promise<string> {
  const { config, bridge, signal, onText, onTool } = options;
  validateRequestConfig(config);
  const baseURL = normalizeEndpoint(config.endpoint);
  const client = new OpenAI({ baseURL, apiKey: config.apiKey || 'local', dangerouslyAllowBrowser: true, maxRetries: 0 });
  const input = structuredClone(options.input);
  for (let round = 0; round < 12; round++) {
    signal.throwIfAborted();
    const requestController = new AbortController();
    const abortRequest = () => requestController.abort(signal.reason);
    signal.addEventListener('abort', abortRequest, { once: true });
    const timeout = setTimeout(() => requestController.abort(new Error('AI request timed out after 120 seconds.')), 120000);
    let response: Response;
    let reported = false;
    const startTime = Date.now();
    const request = { id: crypto.randomUUID(), endpoint: baseURL, model: config.model, createdAt: startTime, inputEstimate: estimateInput(input, config.systemPrompt) };
    try {
      const stream = await client.responses.create({
        model: config.model, instructions: config.systemPrompt, input,
        tools: TOOL_DEFINITIONS.map(tool => ({ type: 'function' as const, ...tool.function, strict: false })),
        stream: true, store: false, max_output_tokens: config.maxTokens,
        ...reasoningPayload(config),
        ...(new URL(baseURL).hostname === 'api.openai.com' ? { include: ['reasoning.encrypted_content' as const] } : {})
      }, { signal: requestController.signal });
      response = await readResponse(stream, onText, requestController.signal, options.onReasoning);
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
    const calls = response.output.filter(item => item.type === 'function_call');
    if (!content && !calls.length) throw new Error('Empty model response.');
    if (calls.length > 30 || calls.some(call => !call.call_id || !call.name)) throw new Error('Invalid or too many tool calls.');
    const output = response.output.filter(item => item.type === 'message' || item.type === 'reasoning' || item.type === 'function_call');
    if (output.length !== response.output.length) throw new Error('Unsupported model output item.');
    input.push(...output);
    let cancelled = false;
    for (const call of calls) {
      onTool({ id: call.call_id, name: call.name, status: 'running' });
      let result: string;
      let status: 'success' | 'error' = 'success';
      try {
        signal.throwIfAborted();
        if (cancelled) throw new Error('User cancelled. Do not retry this operation without new approval.');
        if (!TOOL_DEFINITIONS.some(tool => tool.function.name === call.name)) throw new Error('Unknown tool.');
        result = JSON.stringify(await executeTool(call.name, record(JSON.parse(call.arguments)), bridge, signal));
      } catch (error) {
        status = 'error';
        result = JSON.stringify({ error: signal.aborted ? 'Operation interrupted. Do not retry without explicit user approval.' : error instanceof Error ? error.message : 'Tool failed.' });
      }
      input.push({ type: 'function_call_output', call_id: call.call_id, output: result });
      onTool({ id: call.call_id, name: call.name, status, result });
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
  input.push(limit);
  options.onHistory?.(structuredClone(input));
  return limit.content;
}