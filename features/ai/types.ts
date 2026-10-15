import type { ProjectState } from '../../types.ts';

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';
export type ReasoningProtocol = 'none' | 'openai' | 'deepseek';

export interface AiModelConfig {
  id: string;
  label: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  reasoningProtocol: ReasoningProtocol;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
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
}

export interface AiRequestConfig {
  endpoint: string;
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  reasoningProtocol?: ReasoningProtocol;
  thinkingEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface WorkspaceBridge {
  getProject: () => ProjectState | null;
  getSelection: () => string[];
  commit: (project: ProjectState) => Promise<void>;
  manageProjects: (args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
}

export interface ToolEvent {
  id: string;
  name: string;
  status: 'running' | 'success' | 'error';
  result?: string;
}

export interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  tools?: ToolEvent[];
  error?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  projectId?: string;
  createdAt: number;
  updatedAt: number;
  entries: ChatEntry[];
  messages: ChatMessage[];
}

export interface ChatUiState {
  activeSessionId?: string;
  floatingRect?: { x: number; y: number; width: number; height: number };
}