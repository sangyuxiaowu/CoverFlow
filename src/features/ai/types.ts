import type { ProjectState } from '../../types.ts';
import type { ResponseInputItem } from 'openai/resources/responses/responses';
import type { ImagePromptConfig } from 'sang-ai-kit/image-types';
import type { LocalFontSelection } from 'sang-ai-kit/fonts';
import type { AiFeatures } from 'sang-ai-kit/features';
import type {
  AiConfig as SharedAiConfig, AiEndpointConfig as SharedAiEndpointConfig, AiModelConfig as SharedAiModelConfig,
  AiSkillConfig, AssistantSession, ChatEntry as SharedChatEntry, ReasoningEffort, RequestUsage
} from 'sang-ai-kit';
export type { ImageAdapterId, ImageModelConfig, ImagePromptConfig, ImageQuality } from 'sang-ai-kit/image-types';
export type {
  AiSkillConfig, AssistantActivityEvent, ImageUpload as ChatImageUpload, ReasoningEffort, RequestUsage,
  SessionImage as ChatImageRef, TokenUsage, ToolEvent
} from 'sang-ai-kit';

export type ResponseItem = ResponseInputItem;

export interface AiModelConfig extends SharedAiModelConfig {
  temperature?: number;
}

export interface AiEndpointConfig extends SharedAiEndpointConfig {
  models: AiModelConfig[];
}

export interface AiConfig extends SharedAiConfig {
  endpoints: AiEndpointConfig[];
}

export interface AiRequestConfig {
  imageToolsEnabled?: boolean;
  imageToolModels?: ImagePromptConfig[];
  skills?: AiSkillConfig[];
  localFonts?: LocalFontSelection[];
  features?: Partial<AiFeatures>;
  endpoint: string;
  model: string;
  apiKey: string;
  maxTokens: number;
  systemPrompt: string;
  maxToolRounds?: number;
  maxImageFailures?: number;
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
  getAssetFolder?: () => Promise<FileSystemDirectoryHandle | null>;
  getSelection: () => string[];
  commit: (project: ProjectState) => Promise<void>;
  manageProjects: (args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
  confirm?: (message: string, signal: AbortSignal) => Promise<boolean>;
}

export interface ChatEntry extends SharedChatEntry {
  error?: boolean;
}

export interface ChatSession extends AssistantSession {
  projectId?: string;
  createdAt: number;
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
