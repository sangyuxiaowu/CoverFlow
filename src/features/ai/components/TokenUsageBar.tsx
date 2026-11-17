import TokenUsageBarView from 'sang-ai-kit/token-usage';
import type { AiConfig, ChatSession } from '../types.ts';
import { resolveSelection, toRequestConfig } from '../services/config.ts';
import { sessionUsage } from '../services/usage.ts';

interface Props {
  session?: ChatSession;
  config: AiConfig;
  prompt: string;
  busy: boolean;
  english: boolean;
}

export default function TokenUsageBar({ session, config, prompt, busy, english }: Props) {
  const usage = sessionUsage(session, toRequestConfig(config), session?.responseItems || [], prompt);
  return <TokenUsageBarView usage={usage} model={resolveSelection(config).model} busy={busy} english={english} />;
}