import TokenUsageBarView from 'sang-ai-kit/token-usage';
import type { AssistantSession } from 'sang-ai-kit';
import type { AiConfig, ResponseItem } from '../types.ts';
import { resolveSelection, toRequestConfig } from '../services/config.ts';
import { sessionUsage } from '../services/usage.ts';

interface Props {
  session?: AssistantSession;
  config: AiConfig;
  prompt: string;
  busy: boolean;
  english: boolean;
}

export default function TokenUsageBar({ session, config, prompt, busy, english }: Props) {
  const history = session?.responseItems ?? [];
  if (!history.every(item => item !== null && typeof item === 'object' && !Array.isArray(item))) throw new Error('Invalid conversation history.');
  const usage = sessionUsage(session, toRequestConfig(config), history as ResponseItem[], prompt);
  return <TokenUsageBarView usage={usage} model={resolveSelection(config).model} busy={busy} english={english} />;
}