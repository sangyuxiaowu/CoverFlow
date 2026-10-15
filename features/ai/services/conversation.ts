import type { AiRequestConfig, ChatMessage, ToolCall, ToolEvent, WorkspaceBridge } from '../types.ts';
import { TOOL_DEFINITIONS } from '../tools/definitions.ts';
import { executeTool } from '../tools/execute.ts';
import { record } from '../tools/validation.ts';
import { reasoningPayload, validateRequestConfig } from './config.ts';

interface ConversationOptions {
  config: AiRequestConfig;
  messages: ChatMessage[];
  bridge: WorkspaceBridge;
  signal: AbortSignal;
  onText: (text: string) => void;
  onReasoning?: (text: string) => void;
  onTool: (event: ToolEvent) => void;
}

export async function readCompletion(response: Response, onText: (text: string) => void, signal: AbortSignal, onReasoning?: (text: string) => void): Promise<ChatMessage> {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const payload = await response.json();
    const message = payload.choices?.[0]?.message as ChatMessage | undefined;
    if (!message || (typeof message.content !== 'string' && !message.tool_calls?.length)) throw new Error('Invalid model response.');
    if (payload.choices[0].finish_reason === 'length') throw new Error('Response truncated. Increase max tokens.');
    onText(message.content || '');
    if (message.reasoning_content) onReasoning?.(message.reasoning_content);
    return { ...message, role: 'assistant' };
  }
  if (!response.body) throw new Error('Empty response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map<number, ToolCall>();
  let content = '';
  let reasoning = '';
  let buffer = '';
  let done = false;
  let finished = false;
  const processEvent = (event: string) => {
    const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data.trim() === '[DONE]') { done = true; return; }
    const payload = JSON.parse(data);
    if (payload.error) throw new Error('AI stream returned an error.');
    const choice = payload.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason === 'length') throw new Error('Response truncated. Increase max tokens.');
    if (choice.finish_reason) finished = true;
    const delta = choice.delta || {};
    if (typeof delta.content === 'string') { content += delta.content; onText(delta.content); }
    const reasoningChunk = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoningChunk === 'string') { reasoning += reasoningChunk; onReasoning?.(reasoningChunk); }
    for (const fragment of delta.tool_calls || []) {
      if (!Number.isInteger(fragment.index)) throw new Error('Invalid tool call index.');
      const call = calls.get(fragment.index) || { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
      if (fragment.id) call.id = fragment.id;
      if (fragment.function?.name) call.function.name += fragment.function.name;
      if (fragment.function?.arguments) call.function.arguments += fragment.function.arguments;
      calls.set(fragment.index, call);
    }
  };
  try {
    while (!done) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        processEvent(event);
      }
      if (chunk.done) {
        if (buffer.trim()) processEvent(buffer);
        if (!done && !finished) throw new Error('AI stream disconnected before completion.');
        break;
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const toolCalls = [...calls.entries()].sort(([left], [right]) => left - right).map(([, call]) => call);
  if (toolCalls.some(call => !call.id || !call.function.name)) throw new Error('Incomplete tool call.');
  if (!content && !toolCalls.length) throw new Error('Empty model response.');
  return { role: 'assistant', content: content || null, ...(reasoning ? { reasoning_content: reasoning } : {}), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
}

export async function runConversation(options: ConversationOptions): Promise<ChatMessage[]> {
  const { config, bridge, signal, onText, onTool } = options;
  validateRequestConfig(config);
  const messages = structuredClone(options.messages);
  for (let round = 0; round < 12; round++) {
    signal.throwIfAborted();
    const requestController = new AbortController();
    const abortRequest = () => requestController.abort(signal.reason);
    signal.addEventListener('abort', abortRequest, { once: true });
    const timeout = setTimeout(() => requestController.abort(new Error('AI request timed out after 120 seconds.')), 120000);
    let message: ChatMessage;
    try {
      const response = await fetch(config.endpoint, {
        method: 'POST', signal: requestController.signal,
        headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
        body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: config.systemPrompt }, ...messages], tools: TOOL_DEFINITIONS, stream: true, ...(config.reasoningProtocol === 'openai' ? { max_completion_tokens: config.maxTokens } : { temperature: config.temperature, max_tokens: config.maxTokens }), ...reasoningPayload(config) })
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`AI HTTP ${response.status}. Check the endpoint, key and model.`);
      }
      message = await readCompletion(response, onText, requestController.signal, options.onReasoning);
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', abortRequest); }
    messages.push(message);
    if (!message.tool_calls?.length) return messages;
    if (message.tool_calls.length > 30) throw new Error('Too many tool calls in a response.');
    for (const call of message.tool_calls) {
      signal.throwIfAborted();
      onTool({ id: call.id, name: call.function.name, status: 'running' });
      let result: string;
      let status: 'success' | 'error' = 'success';
      try {
        if (!TOOL_DEFINITIONS.some(tool => tool.function.name === call.function.name)) throw new Error('Unknown tool.');
        result = JSON.stringify(await executeTool(call.function.name, record(JSON.parse(call.function.arguments)), bridge, signal));
      } catch (error) {
        signal.throwIfAborted();
        status = 'error';
        result = JSON.stringify({ error: error instanceof Error ? error.message : 'Tool failed.' });
      }
      messages.push({ role: 'tool', content: result, tool_call_id: call.id });
      onTool({ id: call.id, name: call.function.name, status, result });
      if (status === 'error' && result.includes('User cancelled')) return [...messages, { role: 'assistant', content: '操作已取消。' }];
    }
  }
  return [...messages, { role: 'assistant', content: '已达到本轮工具调用上限。已完成的修改已保留，请检查画布后继续。' }];
}