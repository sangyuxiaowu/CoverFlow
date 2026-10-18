import type { AiRequestConfig, ChatSession, ImagePromptConfig, RequestUsage, ResponseItem, TokenUsage } from '../types.ts';
import { normalizeEndpoint } from './config.ts';
import { imageToolDefinitions, TOOL_DEFINITIONS, VISION_TOOL_DEFINITIONS } from '../tools/definitions.ts';

export function estimateInput(input: ResponseItem[], instructions: string, supportsVision = false, imageToolsEnabled = false, imageModels?: ImagePromptConfig[]): number {
  const tools = [...TOOL_DEFINITIONS, ...(supportsVision ? VISION_TOOL_DEFINITIONS : []), ...(imageToolsEnabled ? imageToolDefinitions(imageModels) : [])];
  const bytes = new TextEncoder().encode(JSON.stringify({ input, instructions, tools }));
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

export interface ContextBreakdown {
  systemAndTools: number;
  canvasAndToolData: number;
  historyMessages: number;
  currentTurnEstimate: number;
  contextTokens: number;
  contextWindow: number;
  reservedOutput: number;
  remainingTokens: number;
  safetyLevel: 'safe' | 'warning' | 'danger';
}

export interface TurnPerformance {
  turnDurationMs?: number;
  turnTokensPerSec?: number;
  avgTokensPerSec?: number;
  totalDurationMs?: number;
}

export function sessionUsage(session: ChatSession | undefined, config: AiRequestConfig, input: ResponseItem[], prompt: string) {
  const requests = session?.requests || [];
  const lastEntry = session ? [...session.entries].reverse().find(entry => entry.role === 'assistant') : undefined;
  const current = requests.filter(request => request.entryId === lastEntry?.id);
  const matching = [...requests].reverse().find(request => request.usage && request.endpoint === normalizeEndpoint(config.endpoint) && request.model === config.model);
  const projectedInput: ResponseItem[] = prompt.trim() ? [...input, { role: 'user', content: prompt.trim() }] : input;
  const estimate = estimateInput(projectedInput, config.systemPrompt, config.supportsVision, config.imageToolsEnabled, config.imageToolModels);
  const contextTokens = matching?.usage && matching.inputEstimate !== undefined
    ? Math.max(0, matching.usage.inputTokens + estimate - matching.inputEstimate)
    : estimate;

  const contextWindow = config.contextWindow || 128000;
  const reservedOutput = config.maxTokens;
  const percent = (contextTokens / contextWindow) * 100;
  const remainingTokens = Math.max(0, contextWindow - contextTokens - reservedOutput);

  // 1. 系统指令与工具定义基础开销
  const systemAndTools = estimateInput([], config.systemPrompt, config.supportsVision, config.imageToolsEnabled, config.imageToolModels);

  // 2. 画布与工具调用数据 (图层属性、设计快照与工具输出)
  const toolDataItems = projectedInput.filter(item => 'type' in item && (item.type === 'function_call' || item.type === 'function_call_output'));
  const canvasAndToolData = Math.ceil(new TextEncoder().encode(JSON.stringify(toolDataItems)).length / 3);

  // 3. 历史对话记录
  const messageItems = projectedInput.filter(item => !('type' in item && (item.type === 'function_call' || item.type === 'function_call_output')));
  const historyItems = prompt.trim() ? messageItems.slice(0, -1) : messageItems;
  const historyMessages = Math.ceil(new TextEncoder().encode(JSON.stringify(historyItems)).length / 3);

  // 4. 当前本轮输入预估
  const currentTurnEstimate = prompt.trim() ? Math.ceil(new TextEncoder().encode(prompt.trim()).length / 3) : 0;

  // 5. 性能指标 (单轮耗时、单轮速率、会话均速)
  const currentCompleted = current.filter(r => r.status === 'completed' && r.durationMs !== undefined && r.durationMs > 0);
  const turnDurationMs = currentCompleted.reduce((acc, r) => acc + (r.durationMs || 0), 0) || lastEntry?.durationMs;
  const currentTotal = sumUsage(current);
  const turnTokensPerSec = turnDurationMs && turnDurationMs > 0 && currentTotal?.outputTokens
    ? Math.round((currentTotal.outputTokens / (turnDurationMs / 1000)) * 10) / 10
    : undefined;

  const allCompletedWithDuration = requests.filter(r => r.status === 'completed' && r.durationMs !== undefined && r.durationMs > 0 && r.usage);
  const totalDurationMs = allCompletedWithDuration.reduce((acc, r) => acc + (r.durationMs || 0), 0);
  const totalCompletedOutput = allCompletedWithDuration.reduce((acc, r) => acc + (r.usage?.outputTokens || 0), 0);
  const avgTokensPerSec = totalDurationMs > 0 && totalCompletedOutput > 0
    ? Math.round((totalCompletedOutput / (totalDurationMs / 1000)) * 10) / 10
    : undefined;

  const budgetExceeded = contextTokens + reservedOutput > contextWindow;
  const safetyLevel: 'safe' | 'warning' | 'danger' =
    budgetExceeded || percent > 85 ? 'danger'
    : percent > 60 ? 'warning'
    : 'safe';

  return {
    total: sumUsage(requests),
    current: currentTotal,
    lastInputTokens: matching?.usage?.inputTokens,
    contextTokens,
    reservedOutput,
    percent,
    budgetExceeded,
    incomplete: Boolean((session?.entries.length && !requests.length) || requests.some(request => !request.usage)),
    requestCount: requests.length,
    breakdown: {
      systemAndTools,
      canvasAndToolData,
      historyMessages,
      currentTurnEstimate,
      contextTokens,
      contextWindow,
      reservedOutput,
      remainingTokens,
      safetyLevel
    },
    performance: {
      turnDurationMs,
      turnTokensPerSec,
      avgTokensPerSec,
      totalDurationMs
    }
  };
}