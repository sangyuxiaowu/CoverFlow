import { useEffect, useState } from 'react';
import type { ToolEvent } from '../types.ts';

export function formatToolDuration(durationMs: number, english: boolean): string {
  const seconds = Math.floor(Math.max(0, durationMs) / 1000);
  if (seconds < 60) return english ? `${seconds}s` : `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  return english ? `${minutes}m ${remainder}s` : `${minutes}分${remainder}秒`;
}

export default function ToolDuration({ tool, english }: { tool: ToolEvent; english: boolean }) {
  const [now, setNow] = useState(Date.now);
  const running = tool.status === 'running';
  useEffect(() => {
    if (!running || tool.startedAt === undefined) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, tool.startedAt]);

  const duration = running
    ? tool.startedAt === undefined ? undefined : Math.max(0, now - tool.startedAt)
    : tool.durationMs;
  if (duration === undefined || (tool.name !== 'generate_image' && (!running || duration < 3000))) return null;
  return (
    <span className="cf-ai-tool-duration" title={english ? 'Total tool elapsed time' : '工具总耗时'}>
      {formatToolDuration(duration, english)}
    </span>
  );
}