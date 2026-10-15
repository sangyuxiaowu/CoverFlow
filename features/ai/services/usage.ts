import type { AiRequestConfig, ChatSession, RequestUsage, ResponseItem, TokenUsage } from '../types.ts';
import { normalizeEndpoint } from './config.ts';
import { TOOL_DEFINITIONS } from '../tools/definitions.ts';

export function estimateInput(input: ResponseItem[], instructions: string): number {
  const bytes = new TextEncoder().encode(JSON.stringify({ input, instructions, tools: TOOL_DEFINITIONS }));
  return Math.ceil(bytes.length / 3);
}

export function sumUsage(requests: RequestUsage[]): TokenUsage | undefined {
  const known = requests.filter(request => request.usage);
  if (!known.length) return undefined;
  return known.reduce<TokenUsage>((total, request) => {
    const usage = request.usage!;
    return {
      inputTokens: total.inputTokens + usage.inputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      totalTokens: total.totalTokens + usage.totalTokens,
      ...(usage.cachedTokens !== undefined || total.cachedTokens !== undefined ? { cachedTokens: (total.cachedTokens || 0) + (usage.cachedTokens || 0) } : {}),
      ...(usage.reasoningTokens !== undefined || total.reasoningTokens !== undefined ? { reasoningTokens: (total.reasoningTokens || 0) + (usage.reasoningTokens || 0) } : {})
    };
  }, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
}

export function sessionUsage(session: ChatSession | undefined, config: AiRequestConfig, input: ResponseItem[], prompt: string) {
  const requests = session?.requests || [];
  const lastEntry = session ? [...session.entries].reverse().find(entry => entry.role === 'assistant') : undefined;
  const current = requests.filter(request => request.entryId === lastEntry?.id);
  const matching = [...requests].reverse().find(request => request.usage && request.endpoint === normalizeEndpoint(config.endpoint) && request.model === config.model);
  const projectedInput: ResponseItem[] = prompt.trim() ? [...input, { role: 'user', content: prompt.trim() }] : input;
  const estimate = estimateInput(projectedInput, config.systemPrompt);
  const contextTokens = matching?.usage && matching.inputEstimate !== undefined
    ? Math.max(0, matching.usage.inputTokens + estimate - matching.inputEstimate)
    : estimate;
  return {
    total: sumUsage(requests), current: sumUsage(current), lastInputTokens: matching?.usage?.inputTokens,
    contextTokens, reservedOutput: config.maxTokens,
    percent: contextTokens / (config.contextWindow || 128000) * 100,
    budgetExceeded: contextTokens + config.maxTokens > (config.contextWindow || 128000),
    incomplete: Boolean((session?.entries.length && !requests.length) || requests.some(request => !request.usage)),
    requestCount: requests.length
  };
}