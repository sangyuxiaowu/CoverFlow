import { ChartNoAxesCombined } from 'lucide-react';
import type { AiConfig, ChatSession } from '../types.ts';
import { toRequestConfig } from '../services/config.ts';
import { sessionUsage } from '../services/usage.ts';

interface Props { session?: ChatSession; config: AiConfig; prompt: string; busy: boolean; english: boolean }

export default function TokenUsageBar({ session, config, prompt, busy, english }: Props) {
  const requestConfig = toRequestConfig(config);
  const usage = sessionUsage(session, requestConfig, session?.responseItems || [], prompt);
  const format = (value?: number) => value === undefined ? '--' : value.toLocaleString(english ? 'en-US' : 'zh-CN');
  const label = (zh: string, en: string) => english ? en : zh;
  return <section className={`cf-ai-usage ${usage.budgetExceeded ? 'cf-ai-usage-warning' : ''}`} aria-label={label('Token 用量', 'Token Usage')}>
    <details>
      <summary><ChartNoAxesCombined size={14} /><span>{label('上下文估算', 'Estimated Context')}</span><span>{format(usage.contextTokens)} / {format(requestConfig.contextWindow)} · {usage.percent.toFixed(1)}%</span></summary>
      <dl>
        <dt>{label('上次输入实测', 'Last Measured Input')}</dt><dd>{format(usage.lastInputTokens)}</dd>
        <dt>{label('预留输出', 'Reserved Output')}</dt><dd>{format(usage.reservedOutput)}</dd>
        <dt>{label('本次操作', 'Current Turn')}</dt><dd>{format(usage.current?.totalTokens)}</dd>
        <dt>{label('会话累计', 'Session Total')}</dt><dd>{format(usage.total?.totalTokens)}</dd>
        <dt>{label('输入 / 输出', 'Input / Output')}</dt><dd>{format(usage.total?.inputTokens)} / {format(usage.total?.outputTokens)}</dd>
        <dt>{label('缓存命中', 'Cached Input')}</dt><dd>{format(usage.total?.cachedTokens)}</dd>
        <dt>{label('思考 Token', 'Reasoning Tokens')}</dt><dd>{format(usage.total?.reasoningTokens)}</dd>
        <dt>{label('请求次数', 'Requests')}</dt><dd>{format(usage.requestCount)}</dd>
      </dl>
    </details>
    <progress max={100} value={Math.min(100, usage.percent)} aria-label={label('上下文占用估算', 'Estimated Context Occupancy')} />
    {(usage.budgetExceeded || usage.incomplete || busy) && <div className="cf-ai-usage-status">{usage.budgetExceeded ? label('上下文预算不足', 'Context Budget Exceeded') : busy ? label('用量待结算', 'Usage Pending') : label('用量统计不完整', 'Usage Incomplete')}</div>}
  </section>;
}