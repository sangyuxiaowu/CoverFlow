import type { ProjectState } from '../../types.ts';
import type { ResponseInputItem } from 'openai/resources/responses/responses';

export type ResponseItem = ResponseInputItem;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

export interface RequestUsage {
  id: string;
  entryId?: string;
  endpoint: string;
  model: string;
  createdAt: number;
  completedAt?: number;
  durationMs?: number;
  status: 'completed' | 'incomplete' | 'failed' | 'aborted';
  inputEstimate?: number;
  responseId?: string;
  usage?: TokenUsage;
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AiModelConfig {
  id: string;
  label: string;
  modelId: string;
  maxTokens: number;
  contextWindow: number;
  thinkingAvailable: boolean;
  supportsVision: boolean;
  supportedReasoningEfforts: ReasoningEffort[];
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  defaultThinkingEnabled?: boolean;
  defaultReasoningEffort?: ReasoningEffort;
  temperature?: number;
}

export interface AiEndpointConfig {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
  models: AiModelConfig[];
}

export interface AiConfig {
  endpoints: AiEndpointConfig[];
  activeSelection: { endpointId: string; modelId: string };
  systemPrompt: string;
  quickSnippets?: string[];
}

export interface AiRequestConfig {
  endpoint: string;
  model: string;
  apiKey: string;
  maxTokens: number;
  systemPrompt: string;
  contextWindow?: number;
  thinkingAvailable?: boolean;
  supportsVision?: boolean;
  supportedReasoningEfforts?: ReasoningEffort[];
  thinkingEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
}

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface WorkspaceBridge {
  getProject: () => ProjectState | null;
  getCanvasPreview?: () => Promise<Blob>;
  getLayerPreview?: (layerId: string) => Promise<Blob>;
  getSelection: () => string[];
  commit: (project: ProjectState) => Promise<void>;
  manageProjects: (args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
}

export interface ToolEvent {
  id: string;
  name: string;
  arguments: string;
  status: 'running' | 'success' | 'error';
  result?: string;
  image?: ChatImageRef;
}

export type AssistantActivityEvent =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'tool'; toolId: string };

export interface ChatImageRef {
  id: string;
  name: string;
  type: 'image/webp';
  size: number;
}

export interface ChatImageUpload {
  image: ChatImageRef;
  blob: Blob;
}

export interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  activity?: AssistantActivityEvent[];
  continuable?: boolean;
  reasoning?: string;
  tools?: ToolEvent[];
  error?: boolean;
  usage?: TokenUsage;
  durationMs?: number;
  images?: ChatImageRef[];
  projectSnapshot?: ProjectState | null;
  previousResponseItems?: ResponseItem[];
}

export interface ChatSession {
  id: string;
  title: string;
  projectId?: string;
  createdAt: number;
  updatedAt: number;
  entries: ChatEntry[];
  responseItems: ResponseItem[];
  requests: RequestUsage[];
}

export interface ChatUiState {
  activeSessionId?: string;
  floatingRect?: { x: number; y: number; width: number; height: number };
}

export interface ExecutionError {
  message: string;
  prompt: string;
  entryId?: string;
}
